import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BalancesService } from './balances.service';
import { BalancesController } from './balances.controller';
import { Balance } from './entities/balance.entity';
import { TimeOffRequest } from '../requests/entities/time-off-request.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Balance, TimeOffRequest])],
  controllers: [BalancesController],
  providers: [BalancesService],
  exports: [BalancesService]
})
export class BalancesModule {}
