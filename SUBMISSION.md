# Submission Package - Time-Off Microservice

## Deliverables Included
1. TRD: `TRD.md`
2. Service code: `time-off-service/`
3. Mock HCM server: `time-off-service/test/hcm-mock.server.ts`
4. Tests + coverage artifacts: `time-off-service/coverage/`

## Verification Commands
Run from `time-off-service/`:

```bash
npm install
npm run test:e2e
npm run test:e2e:cov
```

## Expected Validation
- E2E tests: 8/8 passing
- Coverage report generated at:
  - `time-off-service/coverage/lcov-report/index.html`

## Submission Steps
1. Push repository to GitHub.
2. Ensure `TRD.md` is at repository root.
3. Ensure tests and coverage artifacts are present.
4. Share GitHub repo URL and include a screenshot of `coverage/lcov-report/index.html` if requested.
