import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { startServer, stopServer } from './hcm-mock.server';
import axios from 'axios';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TimeOffRequest, RequestStatus } from '../src/requests/entities/time-off-request.entity';
import { randomUUID } from 'crypto';

const HCM_PORT = Number(process.env.HCM_PORT ?? 3001);
const HCM_BASE_URL = process.env.HCM_BASE_URL ?? `http://localhost:${HCM_PORT}/hcm`;

describe('Time-Off Requests (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DB_PATH = ':memory:';
    process.env.HCM_BASE_URL = HCM_BASE_URL;
    const { AppModule } = require('./../src/app.module');

    // 1. Start the external Mock HCM
    await startServer(HCM_PORT);

    // 2. Initialize Nest Application
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    stopServer();
  });

  beforeEach(async () => {
    // Reset the Chaos mock to deterministic setup for tests
    await axios.post(`${HCM_BASE_URL}/admin/set-chaos`, { mode: 'success' });
  });

  it('Happy Path: Creates a time-off request and deducts successfully', async () => {
    // Mock Setup: employee has 10 days
    await axios.post(`${HCM_BASE_URL}/admin/set-balance`, {
      employeeId: 'emp_happy',
      locationId: 'loc_1',
      balance: 10
    });
    // First, sync this total to our DB via trap 3 logic
    await request(app.getHttpServer())
      .post('/hcm/sync/batch')
      .send({ balances: [{ employeeId: 'emp_happy', locationId: 'loc_1', balance: 10 }] });

    // Deduct 2 days
    const res = await request(app.getHttpServer())
      .post('/requests/time-off')
      .send({ employeeId: 'emp_happy', locationId: 'loc_1', days: 2 })
      .expect(201);
      
    expect(res.body.status).toBe('HCM_SYNCED');

    // Verify balance is 8
    const balRes = await request(app.getHttpServer())
      .get('/balances/emp_happy/loc_1')
      .expect(200);

    expect(balRes.body.total_days_hcm).toBe(10); // Stays 10 until verified
    expect(balRes.body.available_balance).toBe(8); // Available drops immediately
    expect(balRes.body.pending_days).toBe(2); // Recorded as pending
  });

  it('Race Condition Test: 5 concurrent requests, exactly 1 succeeds, 4 fail', async () => {
    await axios.post(`${HCM_BASE_URL}/admin/set-balance`, {
      employeeId: 'emp_race',
      locationId: 'loc_1',
      balance: 1
    });
    await request(app.getHttpServer())
      .post('/hcm/sync/batch')
      .send({ balances: [{ employeeId: 'emp_race', locationId: 'loc_1', balance: 1 }] });

    // Send 5 requests simultaneously
    const requestsConfig = Array(5).fill({ employeeId: 'emp_race', locationId: 'loc_1', days: 1 });
    
    const results = await Promise.all(
      requestsConfig.map(reqData => 
        request(app.getHttpServer())
          .post('/requests/time-off')
          .send(reqData)
      )
    );

    const successCount = results.filter(r => r.status === 201).length;
    const conflictCount = results.filter(r => r.status === 409).length;

    expect(successCount).toBe(1);
    expect(conflictCount).toBe(4); // Only one should acquire the lock
  });

  it('Silent Failure Test: System retains pending days initially (HCM error injected)', async () => {
    // We set HCM to silently fail (returns 200 but no deduction)
    await axios.post(`${HCM_BASE_URL}/admin/set-chaos`, { mode: 'silent-fail' });
    
    await axios.post(`${HCM_BASE_URL}/admin/set-balance`, {
      employeeId: 'emp_silent',
      locationId: 'loc_1',
      balance: 5
    });
    await request(app.getHttpServer())
      .post('/hcm/sync/batch')
      .send({ balances: [{ employeeId: 'emp_silent', locationId: 'loc_1', balance: 5 }] });

    // Attempt deduction. The API should still return success because HCM replied 200.
    const reqRes = await request(app.getHttpServer())
      .post('/requests/time-off')
      .send({ employeeId: 'emp_silent', locationId: 'loc_1', days: 3 })
      .expect(201);

    expect(reqRes.body.status).toBe(RequestStatus.HCM_SYNCED);

    // Local state should keep pending days until a real HCM deduction is observed.
    const balRes = await request(app.getHttpServer())
      .get('/balances/emp_silent/loc_1')
      .expect(200);

    expect(balRes.body.total_days_hcm).toBe(5);
    expect(balRes.body.pending_days).toBe(3);
    expect(balRes.body.available_balance).toBe(2);

    // HCM silent-fail means upstream balance did not change.
    const hcmBalanceRes = await axios.get(`${HCM_BASE_URL}/balance/emp_silent/loc_1`);
    expect(hcmBalanceRes.data.balance).toBe(5);
  });

  it('Trap 3 Batch Sync Test: Ensures pending balances are not overwritten by blind total', async () => {
    await axios.post(`${HCM_BASE_URL}/admin/set-balance`, {
      employeeId: 'emp_batch',
      locationId: 'loc_1',
      balance: 10
    });
    // Initial sync
    await request(app.getHttpServer())
      .post('/hcm/sync/batch')
      .send({ balances: [{ employeeId: 'emp_batch', locationId: 'loc_1', balance: 10 }] });

    // Request 3 days locally
    await request(app.getHttpServer())
      .post('/requests/time-off')
      .send({ employeeId: 'emp_batch', locationId: 'loc_1', days: 3 })
      .expect(201);

    // Verify state: Total 10, Pending 3, Avail 7
    let bal = await request(app.getHttpServer()).get('/balances/emp_batch/loc_1');
    expect(bal.body.available_balance).toBe(7);

    // Simulate HCM sending an OLD batch update (still says 10)
    await request(app.getHttpServer())
      .post('/hcm/sync/batch')
      .send({ balances: [{ employeeId: 'emp_batch', locationId: 'loc_1', balance: 10 }] });

    // Verify Avail STILL 7 (The intelligent delta should preserve the pending deduction)
    bal = await request(app.getHttpServer()).get('/balances/emp_batch/loc_1');
    expect(bal.body.available_balance).toBe(7);
    expect(bal.body.total_days_hcm).toBe(10);
    expect(bal.body.pending_days).toBe(3);

    // Now simulate HCM sending NEW batch update (says 7)
    await request(app.getHttpServer())
      .post('/hcm/sync/batch')
      .send({ balances: [{ employeeId: 'emp_batch', locationId: 'loc_1', balance: 7 }] });

    // Verify Avail STILL 7, but Total is 7 and Pending is 0
    bal = await request(app.getHttpServer()).get('/balances/emp_batch/loc_1');
    expect(bal.body.available_balance).toBe(7);
    expect(bal.body.total_days_hcm).toBe(7);
    expect(bal.body.pending_days).toBe(0);

    // Verify request status changed to APPROVED
    const repo = app.get(getRepositoryToken(TimeOffRequest));
    const reqs = await repo.find({ where: { employee_id: 'emp_batch' } });
    expect(reqs[0].status).toBe(RequestStatus.APPROVED);
  });

  it('Edge Case: Fails to create request due to Insufficient Balance', async () => {
    await axios.post(`${HCM_BASE_URL}/admin/set-balance`, {
      employeeId: 'emp_poor',
      locationId: 'loc_1',
      balance: 1
    });
    // Sync to DB
    await request(app.getHttpServer())
      .post('/hcm/sync/batch')
      .send({ balances: [{ employeeId: 'emp_poor', locationId: 'loc_1', balance: 1 }] });

    // Request 5 days instead of 1
    const res = await request(app.getHttpServer())
      .post('/requests/time-off')
      .send({ employeeId: 'emp_poor', locationId: 'loc_1', days: 5 })
      .expect(409);

    expect(res.body.message).toBe('Insufficient available balance');
  });

  it('Enhancement - Input Validation: Returns 400 for negative days', async () => {
    const res = await request(app.getHttpServer())
      .post('/requests/time-off')
      .send({ employeeId: 'emp_bad', locationId: 'loc_1', days: -5 }) // Invalid days
      .expect(400);

    expect(res.body.message).toEqual(expect.arrayContaining(['days must not be less than 1']));
  });

  it('Enhancement - Reconciliation: Reverts PENDING status to Failed on Trap 2 Silence Error', async () => {
    // Inject a stuck PENDING record older than 2 minutes
    const repo = app.get(getRepositoryToken(TimeOffRequest));
    await repo.save({
      id: randomUUID(),
      employee_id: 'emp_silent_test',
      location_id: 'loc_1',
      days_requested: 2,
      status: RequestStatus.PENDING,
      created_at: new Date(Date.now() - 5 * 60 * 1000) // 5 minutes ago
    });

    const reconciliation = app.get(ReconciliationService);
    await reconciliation.handleCron();

    // Verify it changed to HCM_FAILED because the Mock server doesn't have local deduplication for this random request
    const records = await repo.find({ where: { employee_id: 'emp_silent_test' } });
    const stuckRecord = records.find(r => r.days_requested === 2); 
    
    expect(stuckRecord.status).toBe(RequestStatus.HCM_FAILED);
  });

  it('Concurrent Reconciliation: Multiple requests reconciled correctly', async () => {
    // Set HCM balance to 5
    await axios.post(`${HCM_BASE_URL}/admin/set-balance`, {
      employeeId: 'emp_multi_recon',
      locationId: 'loc_1',
      balance: 5
    });

    // We have 10 in DB, and two HCM_SYNCED requests of 2 and 3 days.
    // Total pending = 5. Total days = 10. Available = 5.
    const repo = app.get(getRepositoryToken(TimeOffRequest));
    await repo.save([
      { id: 'req_1', employee_id: 'emp_multi_recon', location_id: 'loc_1', days_requested: 2, status: RequestStatus.HCM_SYNCED, created_at: new Date() },
      { id: 'req_2', employee_id: 'emp_multi_recon', location_id: 'loc_1', days_requested: 3, status: RequestStatus.HCM_SYNCED, created_at: new Date() }
    ]);

    await request(app.getHttpServer())
       .post('/hcm/sync/batch')
       .send({ balances: [{ employeeId: 'emp_multi_recon', locationId: 'loc_1', balance: 10 }] });

    // Run reconciliation
    const reconciliation = app.get(ReconciliationService);
    await reconciliation.handleCron();

    // After reconciliation, both should be APPROVED, total_days should be 5, pending 0
    const bal = await request(app.getHttpServer()).get('/balances/emp_multi_recon/loc_1');
    expect(bal.body.total_days_hcm).toBe(5);
    expect(bal.body.pending_days).toBe(0);

    const reqs = await repo.find({ where: { employee_id: 'emp_multi_recon' } });
    expect(reqs.find(r => r.id === 'req_1').status).toBe(RequestStatus.APPROVED);
    expect(reqs.find(r => r.id === 'req_2').status).toBe(RequestStatus.APPROVED);
  });
});
