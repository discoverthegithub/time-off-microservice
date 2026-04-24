import { Controller, Post, Body, Logger } from '@nestjs/common';
import { BalancesService } from '../balances/balances.service';
import { RequestsService } from '../requests/requests.service';

import { IsString, IsNumber, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class SyncItemDto {
  @IsString()
  employeeId: string;

  @IsString()
  locationId: string;

  @IsNumber()
  balance: number;
}

export class BatchSyncDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncItemDto)
  balances: SyncItemDto[];
}

@Controller('hcm/sync')
export class SyncController {
  private readonly logger = new Logger(SyncController.name);

  constructor(
    private readonly balancesService: BalancesService,
    private readonly requestsService: RequestsService,
  ) {}

  @Post('batch')
  async handleBatchSync(@Body() dto: BatchSyncDto) {
    const results: Array<{ employeeId: string; status: 'SUCCESS' | 'FAILED'; reason?: string }> = [];
    for (const item of dto.balances) {
      try {
        const delta = await this.balancesService.applyBatchSync(item.employeeId, item.locationId, item.balance);
        await this.requestsService.finalizeRequestsByDelta(item.employeeId, item.locationId, delta);
        results.push({ employeeId: item.employeeId, status: 'SUCCESS' });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown batch sync error';
        this.logger.error(`Batch sync failed for ${item.employeeId}: ${message}`);
        results.push({ employeeId: item.employeeId, status: 'FAILED', reason: message });
      }
    }
    return { sync_results: results };
  }
}
