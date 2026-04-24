import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { TimeOffRequest, RequestStatus } from './entities/time-off-request.entity';
import { BalancesService } from '../balances/balances.service';
import { HcmService } from '../hcm/hcm.service';
import { randomUUID } from 'crypto';

@Injectable()
export class RequestsService {
  constructor(
    @InjectRepository(TimeOffRequest)
    private readonly requestRepo: Repository<TimeOffRequest>,
    private readonly balancesService: BalancesService,
    private readonly hcmService: HcmService
  ) {}

  async createRequest(employeeId: string, locationId: string, days: number): Promise<TimeOffRequest> {
    // 1. Lock the balance locally (Optimistic Locking to prevent double spend)
    // Throws ConflictException if validation fails or race condition is detected.
    await this.balancesService.lockDays(employeeId, locationId, days);

    // 2. Create local pending request
    let request = this.requestRepo.create({
      id: randomUUID(),
      employee_id: employeeId,
      location_id: locationId,
      days_requested: days,
      status: RequestStatus.PENDING
    });
    request = await this.requestRepo.save(request);

    // 3. Attempt HCM Sync
    const isSuccess = await this.hcmService.syncDeductRequest(employeeId, locationId, days);

    // 4. Resolve lock ONLY if HCM failed immediately
    // If HCM returns 200, we keep it in pending_days until Reconciliation or Batch Sync confirms it.
    if (isSuccess) {
      request.status = RequestStatus.HCM_SYNCED;
    } else {
      request.status = RequestStatus.HCM_FAILED;
      try {
        // Refund the pending days locally
        await this.balancesService.refundLock(employeeId, locationId, days);
      } catch (err) {
        throw new ConflictException('Failed to refund pending days after HCM sync failure');
      }
    }
    await this.requestRepo.save(request);
    return request;
  }

  async finalizeRequestsByDelta(employeeId: string, locationId: string, delta: number): Promise<void> {
    if (delta <= 0) return;

    // Find the oldest HCM_SYNCED or stuck PENDING requests for this user
    const syncedRequests = await this.requestRepo.find({
      where: [
        { employee_id: employeeId, location_id: locationId, status: RequestStatus.HCM_SYNCED },
        { 
          employee_id: employeeId, 
          location_id: locationId, 
          status: RequestStatus.PENDING, 
          created_at: LessThan(new Date(Date.now() - 2 * 60 * 1000)) 
        }
      ],
      order: { created_at: 'ASC' }
    });

    let remainingDelta = delta;
    for (const req of syncedRequests) {
      if (remainingDelta <= 0) break;
      
      if (req.days_requested <= remainingDelta) {
        req.status = RequestStatus.APPROVED;
        await this.requestRepo.save(req);
        remainingDelta -= req.days_requested;
      }
      // If a single request is larger than the delta, we can't finalize it yet
      // unless we support partial finalization (which we don't for simplicity).
    }
  }

  async markRequestFailed(id: string): Promise<void> {
    const request = await this.requestRepo.findOne({ where: { id } });
    if (!request || request.status === RequestStatus.HCM_FAILED) return;

    // Refund the balance lock
    await this.balancesService.refundLock(request.employee_id, request.location_id, request.days_requested);

    // Update status
    request.status = RequestStatus.HCM_FAILED;
    await this.requestRepo.save(request);
  }
}
