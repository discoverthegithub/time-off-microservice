import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { IsString, IsNumber, Min } from 'class-validator';

export class CreateRequestDto {
  @IsString()
  employeeId: string;

  @IsString()
  locationId: string;

  @IsNumber()
  @Min(1)
  days: number;
}

@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post('time-off')
  async createTimeOffRequest(@Body() dto: CreateRequestDto) {
    return this.requestsService.createRequest(dto.employeeId, dto.locationId, dto.days);
  }
}
