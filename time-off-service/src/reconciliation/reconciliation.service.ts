import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { TimeOffRequest, RequestStatus } from '../requests/entities/time-off-request.entity';
import { HcmService } from '../hcm/hcm.service';
import { BalancesService } from '../balances/balances.service';

import { RequestsService } from '../requests/requests.service';

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @InjectRepository(TimeOffRequest)
    private readonly requestRepo: Repository<TimeOffRequest>,
    private readonly hcmService: HcmService,
    private readonly balancesService: BalancesService,
    private readonly requestsService: RequestsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCron() {
    this.logger.log('Starting Nightly Reconciliation Job...');
    
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const stuckRequests = await this.requestRepo.find({
      where: [
        { status: RequestStatus.PENDING, created_at: LessThan(twoMinutesAgo) },
        { status: RequestStatus.HCM_SYNCED }
      ]
    });

    const groups = new Map<string, TimeOffRequest[]>();
    for (const req of stuckRequests) {
      const key = `${req.employee_id}:${req.location_id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(req);
    }

    for (const [key, reqs] of groups) {
      const [employeeId, locationId] = key.split(':');
      try {
        await this.reconcileUser(employeeId, locationId, reqs);
      } catch (err) {
        const errorStack = err instanceof Error ? err.stack : String(err);
        this.logger.error(`Failed to reconcile user ${key}`, errorStack);
      }
    }
  }

  async reconcileUser(employeeId: string, locationId: string, reqs: TimeOffRequest[]) {
    this.logger.log(`Reconciling user ${employeeId} at ${locationId}`);
    const actualHcmBalance = await this.hcmService.fetchRealBalance(employeeId, locationId);
    
    if (actualHcmBalance === null) return;

    // Apply baseline sync (Trap 3 logic)
    const delta = await this.balancesService.applyBatchSync(employeeId, locationId, actualHcmBalance);
    
    // Finalize requests covered by the delta
    await this.requestsService.finalizeRequestsByDelta(employeeId, locationId, delta);

    // For remaining stuck requests, mark as FAILED if they are too old
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    for (const req of reqs) {
      const currentReq = await this.requestRepo.findOne({ where: { id: req.id } });
      if (!currentReq) continue;

      if ((currentReq.status === RequestStatus.HCM_SYNCED || currentReq.status === RequestStatus.PENDING) && 
          currentReq.created_at < fiveMinutesAgo) {
        this.logger.warn(`Request ${req.id} stuck too long. Marking FAILED.`);
        await this.requestsService.markRequestFailed(req.id);
      }
    }
  }
}
