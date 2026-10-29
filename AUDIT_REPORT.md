# Fraud Sentinel Phase 1 Audit

Date: 2026-10-29

## Executive summary

The repository contains a working React/Vite dashboard, an Express/tRPC application server, a separate Python/FastAPI/Kafka MLOps prototype, synthetic datasets, DVC metadata, and Docker Compose services. The currently launched dashboard uses the TypeScript server and process-local state. The Python services are not wired into the dashboard runtime.

The existing automated baseline is healthy: TypeScript checking, the current Vitest suite, and the production build pass. The primary functional gap is trust-signal accuracy: URL and email analysis are deterministic heuristics over a small checked-in directory. They do not verify DNS, website reachability, message authentication, or external reputation. The UI and API therefore must describe results as qualified assessments rather than safety guarantees.

## Existing architecture

| Area | Current implementation | Assessment |
| --- | --- | --- |
| Frontend | React 19, TypeScript, Vite, Tailwind, Wouter, tRPC client under `client/` | Working and integrated with the TypeScript server |
| Dashboard backend | Express and tRPC under `server/`; static files are served by the same process in production | Working monolith; not a separately deployable frontend/backend pair |
| Python backend | FastAPI inference API under `src/api/`, Kafka producer/consumer, Prometheus metrics | Separate prototype; not called by the dashboard |
| Persistence | Drizzle/MySQL `users` table only; operational data is held in module-level objects | Authentication persistence seam exists, but analyses, alerts, models, and audit records reset on restart |
| Data | Synthetic transaction data in `server/fraud-data.ts`; XLSX training bundle under `datasets/` | Useful demo fixtures; not production data |
| MLOps | Dataset statistics inference in `server/dataset-model.ts`; process-local lifecycle in `server/mlops.ts`; Python training/DVC/MLflow documentation | Demonstration lifecycle, not durable registry or deployment |
| Observability | Docker Compose Prometheus/Grafana and Python metrics | Available as infrastructure, but not integrated with the dashboard server lifecycle |
| Authentication | Scaffold OAuth/session routes; most product procedures are `publicProcedure` | Authentication is not enforced for operations or analysis endpoints |

## API and execution flow

### URL flow

`client/src/pages/LinkDetection.tsx` -> `linkDetection.analyze` tRPC mutation in `server/routers.ts` -> `analyzeLink()` in `server/link-detector.ts` -> `data/reputation/domains.json` lookup -> heuristic result rendered in the client.

The submitted URL is not opened. No DNS query, HTTP request, redirect inspection, TLS inspection, or threat-intelligence request occurs.

### Email flow

`client/src/pages/EmailDetection.tsx` -> `emailDetection.analyze` tRPC mutation in `server/routers.ts` -> `analyzeEmail()` in `server/email-detector.ts` -> sender-domain seed lookup and regex rules -> result rendered in the client.

Only sender, subject, and body are accepted. Reply-To, headers, attachments, extracted links, authentication results, and analysis history are not supported.

### Transaction flow

The dashboard calls tRPC procedures in `server/routers.ts`. Seeded transactions are generated in `server/fraud-data.ts`; ad-hoc predictions use the in-process statistical model in `server/dataset-model.ts`. The Python FastAPI `/predict` implementation is a separate path and is not used by the dashboard.

## Working functionality

- Dashboard routes and tRPC client/server integration.
- Synthetic transaction feed, filtering, details, and prediction form.
- Static link and email heuristic screens.
- Dataset loading and deterministic feature-statistics scoring.
- Process-local MLOps train/validate/deploy/rollback simulation.
- Existing authentication scaffold and logout behavior.
- Existing unit tests for transaction data, trust-signal basics, authentication logout, and MLOps flow.
- Production client/server build.

## Broken, incomplete, or misleading functionality

### URL analysis

- `analyzeLink()` performs bounded DNS lookup and HEAD reachability checks with timeout, redirect revalidation, and private-address blocking.
- A seed record is a local reputation assertion, not proof that the submitted host is trustworthy.
- DNS failures, non-resolving domains, blocked destinations, unreachable websites, and inconclusive redirects are represented separately.
- The risk score is an additive heuristic estimate; it is not a calibrated probability.
- The result UI now separates verdict, score, check evidence, uncertainty, technical details, and recommended action.

### Email analysis

- The engine is regex-based and also routes extracted URLs through URL analysis.
- Reply-To, headers, and attachment metadata are accepted; SPF/DKIM/DMARC remain unavailable unless trusted authentication results are supplied.
- Free-mail and unknown domains add risk, which can create false positives for legitimate personal mail and recruiters.
- A recognized domain does not authenticate the sender or prove the message is legitimate.
- Risk categories are `LOW`, `REVIEW`, and `HIGH`, not the requested qualified email verdicts.
- No analysis record is persisted.

### Data, MLOps, and audit

- Operational state, audit events, alerts, and pipeline state reset when the Node process restarts.
- `server/mlops.ts` creates candidate metrics by applying optimistic minimums and increments rather than running a durable training/evaluation/deployment artifact workflow.
- The dashboard contains seeded model/experiment values that need explicit synthetic/demo labeling.
- The database schema contains users only; there are no analysis, evidence, provider-status, or retention tables.
- Product procedures, including model deployment and alert changes, are public.

### UI and API quality

- Link, email, and transaction results now use shared verdict, score, evidence, and recommendation presentation components.
- Frontend API base URL is fixed to the same-origin `/api/trpc`; separate deployment requires environment configuration and CORS.
- Frontend and backend are colocated rather than cleanly separated applications.
- The production `npm start` script uses Unix-only `NODE_ENV=production` syntax and does not launch directly on Windows; the built server itself runs when the environment variable is set using Windows syntax.

## Security findings

1. **Public operational mutations:** `mlops.train`, `mlops.deploy`, `mlops.rollback`, pipeline controls, alert mutations, settings updates, and analysis endpoints use `publicProcedure`. These require authentication and authorization before production exposure.
2. **No rate limiting:** analysis and mutation endpoints have no request quotas or abuse controls.
3. **No input-size or content policy beyond basic Zod limits:** email headers, attachments, URLs, and extracted content are not modeled.
4. **Future SSRF risk:** adding HTTP/DNS verification without centralized IP validation, redirect validation, and DNS-rebinding safeguards would expose the server.
5. **Sensitive-data retention is undefined:** the planned email/history feature must avoid storing full message bodies, credentials, OTPs, or tokens by default.
6. **Error handling is inconsistent:** the server does not expose a uniform error schema for detection failures and the client does not consistently show mutation errors.

## False-positive and false-negative risks

### False positives

- Legitimate Gmail/Outlook senders, personal messages, job offers, and newsletters may be elevated solely due to free-mail or unknown-domain status.
- URL path words such as `login`, `verify`, or `payment` are common on legitimate sites.
- HTTP is treated as a risk signal even though transport security and legitimacy are separate properties.

### False negatives

- A malicious URL on a verified seed domain or a compromised legitimate domain can receive a low-risk result.
- A phishing URL using an unknown but syntactically ordinary domain is only under review; no DNS/reputation/content evidence is added.
- Email links are not extracted or analyzed.
- Sender display-name impersonation, Reply-To mismatch, attachment indicators, and actual authentication results are not evaluated.

## Recommended implementation order

1. Establish shared schemas and a backend service boundary for URL/email analysis.
2. Replace the URL result model with qualified DNS, reachability, reputation, and verdict statuses.
3. Add SSRF-safe DNS/HTTP probing with bounded timeouts, redirect validation, and explicit provider-unavailable states.
4. Extend email input and analysis; reuse the URL engine for extracted links and avoid treating unknown evidence as fraud by default.
5. Add independently tested risk scoring and result schemas.
6. Add minimized analysis/history tables and authorization/rate limiting.
7. Reconcile the TypeScript dashboard model path with the Python/DVC/MLflow path and remove optimistic fabricated lifecycle metrics.
8. Configure frontend API URLs/CORS and improve error states for a separable deployment.
9. Add the requested URL, email, security, and integration tests.
10. Update startup/demo documentation and label synthetic data and unavailable providers explicitly.

## Files likely to change

- `server/link-detector.ts`
- `server/email-detector.ts`
- `server/reputation-data.ts`
- `server/routers.ts`
- `server/_core/trpc.ts` and authentication helpers
- `drizzle/schema.ts` and migrations
- `client/src/pages/LinkDetection.tsx`
- `client/src/pages/EmailDetection.tsx`
- `client/src/lib/trpc.ts` and `client/src/main.tsx`
- New backend service/schema/test modules for URL, email, scoring, history, and security controls
- `package.json`, environment examples, `README.md`, and deployment documentation

## Phase 1 conclusion

The existing project is functional as a synthetic dashboard and static heuristic demonstration, but it is not yet a production-grade URL/email verification service. The highest-priority correctness change is to ensure that lack of DNS/reputation evidence can never be presented as a clean safety verdict, while distinguishing malicious, suspicious, unreachable, and inconclusive outcomes.

## Follow-up implementation status

After this audit, the first corrective phases were implemented and validated:

- The existing `client/` and `server/` boundary now supports `VITE_API_BASE_URL` for a separately hosted frontend and exact-origin `CLIENT_ORIGIN` CORS configuration.
- URL analysis now performs bounded DNS lookup, public-address validation, SSRF blocking, controlled HTTP HEAD reachability checks, redirect validation, and qualified verdicts.
- Email analysis now supports optional Reply-To and authentication-header metadata, extracts embedded HTTP(S) links, reuses URL analysis, and reports missing evidence.
- The regression suite covers reserved non-resolving domains and localhost SSRF blocking.

External threat-intelligence providers, durable analysis history, authenticated operational mutations, and the Python/MLflow runtime integration remain future phases.
