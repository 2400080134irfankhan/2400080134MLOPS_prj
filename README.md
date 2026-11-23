# Fraud Sentinel

Fraud Sentinel is an operational dashboard for real-time payment fraud detection and MLOps observability. It presents a seeded 2,000-record synthetic transaction stream, model risk decisions, pipeline health, drift signals, model registry metadata, alert management, and audit events through a single full-stack WebDev project.

> The transaction dataset is synthetic. It is designed to exercise the product workflow and must not be presented as real banking data.

## What is implemented

The dashboard includes a persistent operations shell with routes for Overview, Transactions, Link Detection, Email Verification, Pipeline, Monitoring, Models, Experiments, Alerts, Audit Logs, and Settings. The overview combines live KPI cards, transaction activity, risk probability bands, fraud by merchant category, system health, and a recent transaction feed. Transactions are searchable, filterable, paginated, and linked to an investigation view containing customer, merchant, device, location, engineered features, risk factors, model output, and processing timeline. Link Detection and Email Verification provide safe, static heuristics for suspicious URLs and sender/message patterns; they never open submitted links, contact senders, or claim mailbox ownership.

The pipeline page can start, pause, and stop a sequential simulator at 1, 5, or 10 transactions per second. Monitoring exposes data-quality counters, model performance, latency, feature drift, and deployment thresholds. The model registry compares Random Forest and Logistic Regression metadata, supports retraining initiation, and records promotion actions. Alerts can be acknowledged or resolved. Alert transitions and settings changes are committed to MySQL together with their audit events.

## Architecture

The project uses the supported Manus WebDev full-stack template:

- React 19, TypeScript, Vite, Tailwind CSS 4, Wouter, and Recharts for the client.
- Express and tRPC 11 for typed server procedures.
- Drizzle/MySQL stores authenticated user records, alert status, audit history and settings.
- A deterministic TypeScript data layer in `server/fraud-data.ts` for the initial synthetic dataset and operational state.

The original brief requested FastAPI and PostgreSQL. This implementation uses the platform-supported server and database runtime instead so it can run in the attached WebDev environment with one Express backend and MySQL. The server procedures retain the same product boundaries: transactions, predictions, pipeline control, monitoring, models, alerts, experiments, audit, settings, and health.

## Local MySQL with Docker Desktop

From the repository root, start Docker Desktop in Linux container mode and run:

```sh
pnpm db:local:init
docker compose -f compose.mysql.yml up -d --wait mysql
pnpm db:migrate
pnpm db:seed
pnpm db:verify
```

The initializer generates separate application and root passwords in the ignored `.env` file and configures `DATABASE_URL` for the `fraud_app` account in the `fraud_sentinel` database. Running it again keeps the same credentials. Keep this file private and retain it while using the database volume. If port 3306 is occupied, set an available `MYSQL_PORT` in `.env` before initialization. Run these commands from a shell without overriding database environment variables.

MySQL listens on the loopback interface. Its dedicated Compose project and named volume are independent of the Python/Kafka stack. Use `docker compose -f compose.mysql.yml stop mysql` to stop it while retaining data. The image uses the initialization passwords only when the volume is new. For an existing volume, coordinate password changes inside MySQL with changes to `.env`.

`pnpm db:migrate` applies the existing journaled MySQL migrations. `pnpm db:verify` checks connectivity and queries the migrated users table through Drizzle. After starting or restarting `pnpm dev`, the database field at `/api/trpc/health` should read `connected`. The simpler `/api/health` endpoint checks the web process only. Development demo login bypasses the users table. Demo-authenticated analysts use the same MySQL-backed alert and audit procedures as OAuth users.

The explicit `pnpm db:seed` command installs `operational-v1` in one MySQL transaction. Version 1 freezes the original relative fixture timestamps at a reference time of 2026-11-22 14:00 UTC. Stream positions are one-based. The existing threshold-change audit fixture carries the seed version and serves as the transaction's unique completion marker. A repeat run leaves subsequent operational changes untouched. Conflicting fixture IDs in an unmarked database cause a rollback; inspect the conflict before retrying. The web server does not seed on startup. Alert, audit and settings procedures use these seeded MySQL tables at runtime.

## Data and scoring

`server/fraud-data.ts` generates 2,000 payment transactions with relationships among velocity, amount deviation, device novelty, merchant novelty, international travel, failed attempts, transaction hour, and distance from home. Fraud probability is derived from those signals. The generator also produces a hidden synthetic ground-truth label so precision and recall are bounded classification metrics rather than decorative numbers.

Risk bands follow the configurable thresholds shown in Settings:

| Band | Default rule |
| --- | --- |
| Low | Probability below `0.30` |
| Medium | Probability from `0.30` through `0.69` |
| High | Probability at or above `0.70` |

The displayed risk factors are feature-derived explanations. They are not SHAP attributions.

The repository also includes the synthetic training bundle under `datasets/`: PaySim-style mobile money, credit-card-style PCA signals, and IEEE-CIS-style card-not-present signals. Each model is trained from its `train_80.xlsx` split and evaluated against `test_20.xlsx` at server startup. The Transactions scoring form lets operators select the dataset model; responses include the deployed registry version, dataset name, model artifact version, and held-out metrics.

## Main procedures

All client/server communication uses tRPC under `/api/trpc`.

| Area | Procedures |
| --- | --- |
| Dashboard | `dashboard.summary`, `health` |
| Transactions | `transactions.list`, `transactions.get`, `transactions.predict` |
| Trust signals | `linkDetection.analyze`, `emailDetection.analyze` |
| Pipeline | `pipeline.status`, `pipeline.start`, `pipeline.pause`, `pipeline.stop`, `pipeline.step` |
| Monitoring | `monitoring.overview`, `monitoring.drift`, `monitoring.performance` |
| Models | `models.list`, `models.get`, `models.retrain`, `models.promote` |
| Alerts | `alerts.list`, `alerts.acknowledge`, `alerts.resolve` |
| Governance | `experiments.list`, `audit.list`, `settings.get`, `settings.update` |

The MLOps control plane also exposes `mlops.status`, `mlops.health`, `mlops.train`, `mlops.deploy`, and `mlops.rollback`. Training evaluates a candidate against data-quality, performance, and drift gates. Only a candidate in `READY` state can be deployed; deployment changes the active model version used by new predictions and every lifecycle action is written to the audit log.

## Run locally

The managed project already includes its dependencies and a running development server. For a local checkout:

```bash
pnpm install
pnpm dev
```

The default preview runs on port 3000. The project also supports:

```bash
pnpm check
pnpm test
pnpm build
```

The existing `client/` directory is the frontend application and `server/` is the
Express/tRPC backend. They remain in one workspace so the current same-origin
development and production builds continue to work. For a separate frontend
deployment, set `VITE_API_BASE_URL` to the backend origin at frontend build time
and set `CLIENT_ORIGIN` to the exact frontend origin on the backend. Leave both
empty for the default same-origin setup. See [.env.example](./.env.example).

### Authentication

The application uses the existing OAuth provider rather than collecting passwords
in the frontend. The callback validates a one-time state nonce, exchanges the
authorization code server-side, synchronizes the user record, and issues an
HTTP-only signed session cookie. Dashboard routes are protected in the frontend
for user experience, while the backend session is the source of truth.

Copy `.env.example` to `.env` and configure `OAUTH_SERVER_URL`, `JWT_SECRET`,
`VITE_OAUTH_PORTAL_URL`, and `VITE_APP_ID` to enable the sign-in and workspace
access actions. Password recovery remains managed by the configured identity
provider; the login screen does not claim to send a local reset email.

For a local product demonstration before OAuth is configured, start the server
with `pnpm dev`, `DEMO_AUTH_ENABLED=true`, and privately chosen values for
`DEMO_AUTH_EMAIL`, `DEMO_AUTH_PASSWORD`, and `JWT_SECRET` in the ignored
`.env` file. The demo identity has the regular user role.

See [Azure deployment and access control](AZURE_DEPLOYMENT.md) for production settings and release checks.

## Testing

The test suite covers the scaffold authentication contract plus synthetic data population, required field quality, risk-band semantics, bounded metrics, and processed-record counts. Run the complete suite with `pnpm test`.

Run `python scripts/test-mysql.py` with Docker, Node and pnpm available to run the full database suite. The script creates an isolated MySQL 8.4 container with a fresh anonymous volume, migrates two test databases, runs `pnpm test`, restarts MySQL, and compares all transaction, scoring and pipeline rows before and after the restart. It stops the disposable container on exit.

For the MySQL HTTP integration tests, set `OPERATIONS_TEST_DATABASE_URL` to a freshly migrated, unseeded disposable loopback database named `fraud_sentinel_operations_test`. Run `pnpm test`. The suite seeds its own fixtures and installs a test-only trigger to verify transaction rollback. The earlier initializer tests use a separate `SEED_TEST_DATABASE_URL`.

## Runtime limitations

Signed-in users can read the latest ten URL or email scans from the past 90 days. History stores scan-time findings, the URL origin and the sender domain. Embedded links stay with the email. Reading history does not probe the network. Run `pnpm db:cleanup-scans` from the checkout with a maintenance account configured through `DATABASE_URL`. Schedule it daily to physically remove expired rows. MySQL determines the cutoff and preserves rows exactly 90 days old.

MySQL persists URL and email scan history, alerts, audit events and settings across restarts. The dashboard's active-alert count and the model evaluation drift gate read these values from MySQL. Stream rows and manual scoring evidence are persisted separately. Run `pnpm db:cleanup-scores` daily with a maintenance account to remove scoring requests older than 90 days. It only deletes from `scoring_requests`. Apply migration 0002 before enabling manual scoring after a promotion. It preserves existing rows and stores the observed registry version independently of the mutable registry. Pipeline status, speed, first-start timestamp and progress come from MySQL `pipeline_state.id = 1`. Each control locks that row until its state update and actor audit commit. The cursor is the last processed one-based stream sequence. Restarting Node preserves it. Admin browser tabs drive automatic steps while running; multiple tabs can increase throughput. The explicit admin step also works while paused or stopped. Model versions, completed runs, release pointers, and verified scoring artifacts are durable in MySQL. Lists and metrics cover the processed prefix in stream order; direct ID lookup covers the full seeded stream.

The frontend uses polling through tRPC for live refreshes. The original WebSocket contract is represented by the pipeline procedures and can be upgraded to a server-sent or WebSocket transport without changing page contracts.

The trust-signal analyzers use a versioned in-repository organization/domain directory, deterministic pattern checks, bounded DNS lookups, and SSRF-blocked HTTP HEAD checks. They do not render pages, download content, contact senders, or verify mailbox ownership. They are not wired to an unverified third-party fraud feed or email provider. A production integration should add an authenticated provider with explicit licensing, rate limits, privacy controls, and a reviewable fallback; the typed tRPC procedures provide the seam for that integration.

### Node model lifecycle

Apply the reviewed additive migration 0003 and run `pnpm db:register-model-artifacts` explicitly after backing up the database and approving cutover. Stop older Node workers before registration. On a fresh database only, initialize the approved fixtures first. Preserve the existing working database and its history. The command checks the active v1.2.0 baseline, captures three packaged feature-statistics scorers under one pinned SHA-256 manifest, and audits the binding atomically. Repeat registration verifies the identical binding. The v1.2.0 catalog metadata and reported historical metrics are retained: the capture establishes the observed Node implementation at cutover, not provenance for an original Random Forest binary. v1.1.0 and baseline-1 have no verified artifact. Rollback to an unbound version fails.

Training refits the selected dataset deterministically from its packaged workbook. Evaluation uses the held-out split, a 0.5 evaluation threshold, and stepwise average precision for PR-AUC. The original metrics in the cutover snapshot remain historical. Existing performance and configured drift gates are retained; the drift gate is a threshold policy, not a live drift measurement. Re-fitting identical inputs yields a recorded rejection for an unchanged scorer. A completed candidate changes only its dataset entry. Eligible promotion and rollback switch complete manifests under a MySQL row lock. Scoring returns the registry version and the digest of the actual dataset payload executed. Runtime validation rejects unbound, incompatible or corrupt artifacts. Existing stream predictions and scoring history are never rewritten.

Only completed synchronous training outcomes are persisted. There is no background recovery of interrupted fitting or request-level idempotency key. Python/FastAPI joblib inference, Kafka consumers and MLflow tracking remain independent of this Node release mechanism.


## Project map

```text
client/src/App.tsx                    Route wiring
client/src/components/DashboardLayout.tsx  Sidebar and top status bar
client/src/pages/Home.tsx             Overview dashboard
client/src/pages/Transactions.tsx     Feed and investigation view
client/src/pages/Operations.tsx       Pipeline, monitoring, models, alerts, and governance
server/fraud-data.ts                  Synthetic dataset and operational state
server/routers.ts                     Typed tRPC procedures
server/fraud-data.test.ts             Data and risk-engine tests
```

## References

[1]: https://react.dev/ "React documentation"
[2]: https://trpc.io/docs/ "tRPC documentation"
[3]: https://recharts.org/en-US/ "Recharts documentation"
[4]: https://orm.drizzle.team/docs/overview "Drizzle ORM documentation"
