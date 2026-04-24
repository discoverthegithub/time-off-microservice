import { Injectable, ConflictException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Balance } from './entities/balance.entity';

@Injectable()
export class BalancesService {
  constructor(
    @InjectRepository(Balance)
    private readonly balanceRepo: Repository<Balance>,
  ) {}

  async getBalance(employeeId: string, locationId: string): Promise<Balance> {
    let balance = await this.balanceRepo.findOne({
      where: { employee_id: employeeId, location_id: locationId }
    });

    if (!balance) {
      try {
        balance = this.balanceRepo.create({
          id: `${employeeId}-${locationId}`,
          employee_id: employeeId,
          location_id: locationId,
          total_days: 0,
          pending_days: 0
        });
        balance = await this.balanceRepo.save(balance);
      } catch (err) {
        // If another request created it first
        balance = await this.balanceRepo.findOne({
          where: { employee_id: employeeId, location_id: locationId }
        });
        if (!balance) throw err;
      }
    }
    return balance;
  }

  async lockDays(employeeId: string, locationId: string, days: number): Promise<Balance> {
    let retries = 3;
    let balance: Balance;

    while (retries > 0) {
      balance = await this.getBalance(employeeId, locationId);
      
      if (balance.total_days - balance.pending_days < days) {
        throw new ConflictException('Insufficient available balance');
      }

      // Optimistic locking with update
      const result = await this.balanceRepo.update(
        { id: balance.id, version: balance.version },
        {
          pending_days: balance.pending_days + days,
          version: balance.version + 1
        }
      );

      if (result.affected !== 0) {
        return this.getBalance(employeeId, locationId);
      }

      retries--;
      if (retries > 0) {
        // Exponential backoff
        await new Promise(res => setTimeout(res, Math.random() * 50 + 50)); 
      }
    }

    throw new ConflictException('Balance was heavily updated by competing requests. Please try again later.');
  }

  async refundLock(employeeId: string, locationId: string, days: number): Promise<Balance> {
    let retries = 5;
    while (retries > 0) {
      const balance = await this.getBalance(employeeId, locationId);
      const newPendingDays = balance.pending_days - days < 0 ? 0 : balance.pending_days - days;

      const result = await this.balanceRepo.update(
        { id: balance.id, version: balance.version },
        {
          pending_days: newPendingDays,
          version: balance.version + 1
        }
      );

      if (result.affected !== 0) return this.getBalance(employeeId, locationId);

      retries--;
      await new Promise(res => setTimeout(res, 50));
    }
    throw new ConflictException('Failed to refund lock due to high contention.');
  }

  async reconcileLock(employeeId: string, locationId: string, days: number): Promise<Balance> {
    let retries = 5;
    while (retries > 0) {
      const balance = await this.getBalance(employeeId, locationId);
      const newTotalDays = balance.total_days - days;
      const newPendingDays = balance.pending_days - days < 0 ? 0 : balance.pending_days - days;

      const result = await this.balanceRepo.update(
        { id: balance.id, version: balance.version },
        {
          total_days: newTotalDays,
          pending_days: newPendingDays,
          version: balance.version + 1
        }
      );

      if (result.affected !== 0) return this.getBalance(employeeId, locationId);

      retries--;
      await new Promise(res => setTimeout(res, 50));
    }
    throw new ConflictException('Failed to reconcile lock due to high contention.');
  }

  async applyBatchSync(employeeId: string, locationId: string, hcmTotalDays: number) {
    let retries = 5;
    while (retries > 0) {
      const balance = await this.getBalance(employeeId, locationId);
      
      // Solution 3: Intelligent Delta Calculation
      // If HCM balance is 10 and our local balance is 12 (with 2 pending),
      // it means HCM hasn't processed the 2 yet. 
      // If we blindly set total to 10, and pending is 2, user sees 8.
      // Wait, if we keep total at 12 and pending at 2, user sees 10.
      
      // Correct logic:
      // delta = current_total - hcmTotalDays
      // if delta > 0, it means HCM has deducted some days.
      // we should reduce our local pending_days by that delta.
      const delta = Math.max(0, balance.total_days - hcmTotalDays);
      const newPendingDays = Math.max(0, balance.pending_days - delta);

      const result = await this.balanceRepo.update(
         { id: balance.id, version: balance.version },
         {
           total_days: hcmTotalDays,
           pending_days: newPendingDays,
           version: balance.version + 1
         }
      );

      if (result.affected !== 0) return delta;

      retries--;
      await new Promise(res => setTimeout(res, 50));
    }
    throw new ConflictException('Failed to apply batch sync due to high contention.');
  }
}
