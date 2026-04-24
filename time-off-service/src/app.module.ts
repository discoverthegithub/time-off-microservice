import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BalancesModule } from './balances/balances.module';
import { RequestsModule } from './requests/requests.module';
import { HcmModule } from './hcm/hcm.module';
import { SyncModule } from './sync/sync.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { ScheduleModule } from '@nestjs/schedule';
import { Balance } from './balances/entities/balance.entity';
import { TimeOffRequest } from './requests/entities/time-off-request.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: process.env.DB_PATH ?? 'time-off.sqlite',
      entities: [Balance, TimeOffRequest],
      synchronize: true, // Auto-create tables for the take-home test
    }),
    ScheduleModule.forRoot(),
    BalancesModule,
    RequestsModule,
    SyncModule,
    HcmModule,
    ReconciliationModule
  ]
})
export class AppModule {}
