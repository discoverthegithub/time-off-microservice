import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { BalancesModule } from '../balances/balances.module';
import { RequestsModule } from '../requests/requests.module';

@Module({
  imports: [BalancesModule, RequestsModule],
  controllers: [SyncController],
})
export class SyncModule {}
