# Technical Requirement Document: Time-Off Microservice

## 1. Objective
Build a defensive Time-Off Microservice for ExampleHR that supports fast user feedback while preserving integrity with HCM as source of truth.

The service must:
- Accept time-off requests against per-employee per-location balances.
- Guard against race conditions and stale writes.
- Remain correct when HCM returns incomplete or misleading outcomes.
- Safely merge asynchronous HCM batch updates without losing in-flight local intent.

## 2. Product Context
- Employee expectation: available balance updates immediately after request creation.
- Manager expectation: approvals are based on consistent, non-oversubscribed balances.
- Integration reality: HCM can change balances independently and may intermittently fail.

## 3. Architecture Summary
- API layer: NestJS REST controllers.
- State layer: SQLite via TypeORM.
- Balance integrity layer: optimistic concurrency with a version column.
- Integration layer: outbound HCM adapter with retry/backoff.
- Recovery layer: reconciliation process that validates eventual HCM state.

## 4. Core Challenges and Implemented Defenses

### 4.1 Double Spend (Race Condition)
Problem:
Two concurrent requests can read the same available balance and both pass validation.

Defense:
Optimistic locking on Balance using version.

Mechanism:
- Read row with current version.
- Update only when id and version match.
- Increment version on successful write.
- Retry bounded times on conflict.

Outcome:
Only one contender succeeds when balance is insufficient for parallel requests.

### 4.2 Silent HCM Failure (200 OK but No Deduction)
Problem:
HCM may acknowledge deduct calls without persisting the deduction.

Defense:
Track requested days in pending_days rather than immediately reducing total_days.

Mechanism:
- Request reserves days locally by increasing pending_days.
- Request status moves to HCM_SYNCED only when HCM call returns success.
- Final approval is deferred until a later HCM balance observation confirms deduction.

Formula:
available_balance = total_days - pending_days

Outcome:
Users see immediate reservation while the system remains resilient to false-positive HCM acknowledgements.

### 4.3 Batch Sync Overwrite Risk
Problem:
Blindly setting total_days to incoming HCM batch value can erase local in-flight reservations.

Defense:
Delta-based merge logic.

Mechanism:
- delta = max(0, local_total_days - incoming_hcm_total)
- pending_days = max(0, pending_days - delta)
- total_days = incoming_hcm_total

Interpretation:
- delta > 0: HCM has processed one or more pending deductions.
- delta = 0: no deduction confirmation yet, or external upward adjustment.

Outcome:
No blind overwrite of local pending intent; available balance remains stable and explainable.

## 5. Data Model

Balance:
- id
- employee_id
- location_id
- total_days
- pending_days
- version

TimeOffRequest:
- id
- employee_id
- location_id
- days_requested
- status: PENDING, HCM_SYNCED, APPROVED, HCM_FAILED, REJECTED
- created_at
- updated_at

## 6. API Contract (REST)
- GET /balances/:employeeId/:locationId
  - Returns total_days_hcm, pending_days, available_balance, version.
- POST /requests/time-off
  - Body: employeeId, locationId, days.
  - Validates input and executes reserve plus sync workflow.
- POST /hcm/sync/batch
  - Body: balances array with employeeId, locationId, balance.
  - Applies delta logic and finalizes eligible requests.

## 7. Alternatives Considered

### 7.1 Pessimistic Locking vs Optimistic Locking
Pessimistic locking was rejected for this implementation because SQLite does not provide robust row-level semantics comparable to enterprise RDBMS engines.

Optimistic locking was selected because:
- It is simple and deterministic for this data shape.
- It avoids long lock hold times.
- It pairs well with bounded retries and conflict-driven user feedback.

### 7.2 Immediate Finalization vs Pending Reservation Model
Immediate finalization on HCM 200 was rejected due to silent-failure risk.

Pending reservation was selected because it separates local intent from external confirmation and supports eventual consistency without overstating available balance.

### 7.3 Blind Replace vs Delta Merge on Batch Sync
Blind replace was rejected because it can regress user-visible balances and lose in-flight state.

Delta merge was selected because it preserves local reservations while incorporating authoritative baseline updates.

### 7.4 Event-Driven Integration vs Polling/Reconciliation
Event-driven processing is a strong production candidate but was not chosen for the take-home scope due to operational complexity and undefined HCM event guarantees.

Reconciliation and batch merge provide a sufficient, auditable eventual-consistency strategy for this assignment.

## 8. Test Strategy and Coverage Intent
The suite validates behavior at integration boundaries using a Chaos Mock HCM server.

Scenarios:
- Happy path lifecycle.
- High-contention race test (single winner, remaining conflicts).
- Explicit HCM 500 behavior with retry/failure handling.
- Silent failure behavior where HCM returns 200 but state does not change.
- Batch overwrite protection via delta merge.
- Reconciliation of stuck requests and status convergence.

## 9. Non-Goals
- Payroll policy modeling beyond day-based balances.
- Partial-day accrual rules.
- Multi-tenant access control.
- Distributed message bus and outbox pattern.

## 10. Submission Artifacts
- This TRD.
- NestJS plus SQLite service implementation.
- Mock HCM server with chaos controls.
- E2E tests and coverage artifacts.
