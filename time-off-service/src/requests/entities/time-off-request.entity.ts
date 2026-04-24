import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum RequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  HCM_SYNCED = 'HCM_SYNCED',
  HCM_FAILED = 'HCM_FAILED'
}

@Entity()
export class TimeOffRequest {
  @PrimaryColumn()
  id: string;

  @Index()
  @Column()
  employee_id: string;

  @Index()
  @Column()
  location_id: string;

  @Column('int')
  days_requested: number;

  @Index()
  @Column({
    type: 'varchar',
    enum: RequestStatus,
    default: RequestStatus.PENDING
  })
  status: RequestStatus;

  @Index()
  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
