import { Entity, Column, PrimaryColumn, VersionColumn, Index, CreateDateColumn } from 'typeorm';

@Entity()
export class Balance {
  @PrimaryColumn()
  id: string;

  @Index()
  @Column()
  employee_id: string;

  @Index()
  @Column()
  location_id: string;

  @Column('int')
  total_days: number;

  @Column('int', { default: 0 })
  pending_days: number;

  @VersionColumn()
  version: number;

  @Index()
  @CreateDateColumn()
  created_at: Date;
}
