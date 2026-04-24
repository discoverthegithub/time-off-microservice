import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';
import { TimeOffRequest } from './entities/time-off-request.entity';
import { BalancesModule } from '../balances/balances.module';
import { HcmModule } from '../hcm/hcm.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TimeOffRequest]),
    BalancesModule,
    HcmModule
  ],
  providers: [RequestsService],
  controllers: [RequestsController],
  exports: [RequestsService]
})
export class RequestsModule {}
