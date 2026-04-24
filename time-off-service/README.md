# Time-Off Microservice

Defensive NestJS microservice for managing time-off requests while integrating with an unreliable external HCM.

## Tech Stack
- NestJS
- SQLite
- TypeORM
- Jest plus Supertest

## 2-Minute Setup

1. Install dependencies

npm install

2. Create local env file (optional but recommended)

PowerShell:

Copy-Item .env.example .env

3. Start mock HCM server (terminal 1)

npm run start:hcm

4. Start API in watch mode (terminal 2)

npm run start:dev

No manual DB setup is required. SQLite file and schema are created automatically by TypeORM synchronize.

Optional environment variables:
- HCM_BASE_URL (default: http://localhost:3001/hcm)
- HCM_PORT (used by mock server, default: 3001)
- DB_PATH (default: time-off.sqlite)

## Run Tests

Run E2E suite

npm run test:e2e

Run unit coverage

npm run test:cov

Run E2E coverage (recommended for take-home evidence)

npm run test:e2e:cov

Coverage report path:

coverage/lcov-report/index.html

## API Summary

- GET /balances/:employeeId/:locationId
  - Returns total_days_hcm, pending_days, available_balance, version.
- POST /requests/time-off
  - Creates a request and reserves days defensively.
- POST /hcm/sync/batch
  - Applies batch updates using delta logic to avoid overwriting local pending state.

## Test Strategy

The test suite is integration-heavy and uses a Chaos Mock HCM server to simulate:
- normal success behavior,
- explicit 500 errors,
- silent failures where response is 200 but deduction is not persisted.

This validates race-condition handling, pending balance integrity, batch merge safety, and reconciliation behavior.

## Useful Files
- TRD: ../TRD.md
- Mock HCM: test/hcm-mock.server.ts
- E2E tests: test/requests.e2e-spec.ts
