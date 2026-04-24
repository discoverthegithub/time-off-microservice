import { Controller, Get, Param } from '@nestjs/common';
import { BalancesService } from './balances.service';

@Controller('balances')
export class BalancesController {
  constructor(private readonly balancesService: BalancesService) {}

  @Get(':employeeId/:locationId')
  async getBalance(@Param('employeeId') employeeId: string, @Param('locationId') locationId: string) {
    const balance = await this.balancesService.getBalance(employeeId, locationId);
    return {
      total_days_hcm: balance.total_days,
      pending_days: balance.pending_days,
      available_balance: balance.total_days - balance.pending_days,
      version: balance.version
    };
  }
}
