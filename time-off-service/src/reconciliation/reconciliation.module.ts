import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReconciliationService } from './reconciliation.service';
import { HcmModule } from '../hcm/hcm.module';
import { BalancesModule } from '../balances/balances.module';
import { RequestsModule } from '../requests/requests.module';
import { TimeOffRequest } from '../requests/entities/time-off-request.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([TimeOffRequest]),
    HcmModule,
    BalancesModule,
    RequestsModule
  ],
  providers: [ReconciliationService]
})
export class ReconciliationModule {}
