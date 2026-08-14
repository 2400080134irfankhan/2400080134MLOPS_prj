# MLOps Pipeline for Real-Time Fraud Detection

## 1. Scope and architecture

This repository implements the requested flow:

> Data → DVC/Git → preparation → XGBoost training → MLflow tracking/registry → FastAPI and Kafka inference → Prometheus/Grafana metrics → Evidently drift detection → retraining → candidate validation → promotion or rejection → rollback.

The local reference deployment uses Docker Compose. Kafka receives transaction events on the `transactions` topic. The consumer loads the currently deployed `models/model.joblib` artifact, scores every event, logs a fraud alert when the probability crosses `FRAUD_THRESHOLD`, and exposes metrics on port `8001`. The FastAPI service exposes the same model through `/predict` and metrics through `/metrics`. MLflow records training parameters, metrics, and artifacts. Prometheus scrapes the API and consumer, while Grafana visualizes the metrics.

| Component | Location | Responsibility | Default endpoint or command |
|---|---|---|---|
| Transaction schema | `src/common/schemas.py` | Validates event shape and defines model features | Imported by API and producer |
| Settings | `src/common/config.py` | Centralizes environment variables and thresholds | `.env` or shell environment |
| Model pipeline | `src/common/model.py` | Preprocessing, XGBoost classifier, persistence | Imported by training and inference |
| Data preparation | `src/training/prepare.py` | Schema checks, null handling, quality report | `python -m src.training.prepare` |
| Training | `src/training/train.py` | Split, fit, evaluate, MLflow log, artifact save | `python -m src.training.train` |
| REST inference | `src/api/main.py` | Health, prediction, Prometheus endpoints | `http://localhost:8000` |
| Kafka producer | `src/producer/producer.py` | Publishes a validated transaction event | Reads JSON from stdin |
| Kafka consumer | `src/consumer/worker.py` | Scores events and emits alerts | Long-running worker |
| Drift detection | `src/monitoring/drift.py` | Compares reference/current feature distributions | Writes `reports/drift.json` |
| Validation gate | `src/monitoring/validate.py` | Compares candidate with production model | Writes `reports/validation.json` |
| Infrastructure | `docker-compose.yml` | Starts Kafka, MLflow, API, worker, Prometheus, Grafana | `docker compose up -d --build` |
| CI/CD | `.github/workflows/ci.yml` | Tests, trains on main, validates, promotes artifact | GitHub Actions |

The implementation intentionally keeps PostgreSQL out of the baseline. MLflow uses SQLite and a local artifact directory for demonstration; replace these with managed PostgreSQL and object storage for a production deployment.

## 2. Two deployment options

| Approach | Tradeoffs | Cost | Setup complexity |
|---|---|---:|---:|
| Local Docker Compose, implemented here | Reproducible and easy to inspect; not highly available and requires a machine running Docker | Low for development; infrastructure cost depends on host | Moderate |
| Kubernetes or managed container platform | Supports replicas, rolling deployment, secrets, durable storage, and high availability; requires cluster operations | Higher and provider-dependent | High |
| Lightweight single-process alternative | Run FastAPI and scheduled Python scripts without Kafka/MLflow/Grafana; faster to learn but does not satisfy the requested production-style streaming and governance requirements | Lowest | Low |

The repository implements the first option because it satisfies the requested technology stack and is the most reproducible starting point. The second option is the production migration path.

## 3. Prerequisites

Install Python 3.11 or newer, Docker Engine with Compose v2, Git, and DVC. From the repository root, create a virtual environment and install dependencies:

```bash
cd /home/ubuntu/mlops-fraud-detection
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

The dependency versions are pinned in `requirements.txt` so that CI and local execution use the same package set. If `xgboost` or `evidently` cannot be installed on a target machine, use the project Docker image instead of changing versions immediately.

## 4. First execution: create data, prepare it, and train

The included `scripts/create_demo_data.py` creates a deterministic fixture for smoke tests only. It is not a substitute for an approved, representative fraud dataset. Run it once:

```bash
python scripts/create_demo_data.py
python -m src.training.prepare \
  --input data/raw/transactions.csv \
  --output data/processed/transactions.csv
```

`prepare.py` verifies the required columns, removes incomplete rows, requires both target classes, and writes `data/processed/transactions.quality.json`. In a real project, replace the raw CSV with a governed export and record its provenance, time period, label definition, and access controls.

Start MLflow in one terminal:

```bash
docker compose up -d mlflow
```

Then train:

```bash
export MLFLOW_TRACKING_URI=http://localhost:5000
python -m src.training.train \
  --input data/processed/transactions.csv \
  --output models/model.joblib \
  --run-name initial-model
```

The trainer uses a stratified split, calculates a class-imbalance weight, fits an XGBoost classifier behind a scikit-learn preprocessing pipeline, logs ROC AUC, precision, recall, F1, parameters, and a model artifact to MLflow, then saves the serving artifact at `models/model.joblib`. Open `http://localhost:5000` to inspect the run.

## 5. API implementation and test

The API loads `models/model.joblib` at startup. If the file is absent, `/health` remains reachable but `/predict` returns HTTP 503 until a model is trained. Start the API locally:

```bash
uvicorn src.api.main:app --reload --port 8000
```

Check health:

```bash
curl http://localhost:8000/health
```

Send a prediction:

```bash
curl -X POST http://localhost:8000/predict \
  -H 'Content-Type: application/json' \
  -d '{
    "transaction_id":"tx-001",
    "amount":245.50,
    "merchant_category":"online",
    "customer_age":35,
    "account_age_days":420,
    "distance_from_home_km":42.0,
    "hour":2,
    "device_trust_score":0.18,
    "previous_chargebacks":1
  }'
```

The response contains `fraud_probability`, boolean `is_fraud`, `model_version`, and an inference timestamp. `FRAUD_THRESHOLD` is controlled by the environment and defaults to `0.50`. In production, select this threshold from a cost-sensitive validation study rather than treating 0.50 as universally correct.

## 6. Kafka real-time path

Start the full stack after a model exists:

```bash
docker compose up -d --build
```

The Compose file creates a Kafka broker and automatically allows the `transactions` topic to be created. The consumer subscribes using the `fraud-detector` group, deserializes each JSON event, scores it, increments Prometheus counters, and logs either a genuine result or a fraud alert.

Publish an event from the host. The producer must use the host broker address, so set `KAFKA_BOOTSTRAP_SERVERS=localhost:9092` when invoking it outside Compose:

```bash
KAFKA_BOOTSTRAP_SERVERS=localhost:9092 \
python -m src.producer.producer <<'JSON'
{"transaction_id":"tx-kafka-001","amount":520.0,"merchant_category":"online","customer_age":28,"account_age_days":20,"distance_from_home_km":80.0,"hour":3,"device_trust_score":0.05,"previous_chargebacks":2}
JSON
```

View worker output:

```bash
docker compose logs -f consumer
```

A production alert path should replace the log line with an authenticated notification or case-management integration, add idempotency by `transaction_id`, and write the decision to durable storage.

## 7. Monitoring

Prometheus is available at `http://localhost:9090`; Grafana is available at `http://localhost:3000`. The API metrics endpoint is `http://localhost:8000/metrics`, and the consumer metrics endpoint is exposed inside Compose on port `8001`.

Important metrics include `fraud_prediction_requests_total`, `fraud_predictions_total`, `fraud_consumer_transactions_total`, `fraud_consumer_alerts_total`, and `fraud_prediction_latency_seconds`. Create Grafana panels for request rate, fraud-alert rate, p50/p95 latency, consumer throughput, consumer lag, API availability, and model error metrics once labels are added.

Infrastructure monitoring and model monitoring are different controls. Prometheus/Grafana show service behavior; Evidently compares data distributions and supports drift decisions. Neither system proves that labels are correct, so label quality and delayed ground-truth evaluation must be added for production.

## 8. Drift detection and automatic retraining

Place a new labeled or feature-only current window at `data/processed/current.csv`, then run:

```bash
python -m src.monitoring.drift \
  --reference data/processed/transactions.csv \
  --current data/processed/current.csv \
  --report reports/drift.json \
  --threshold 0.20
```

The script writes an Evidently report and a decision object. If `retrain_required` is true, the automation layer should launch preparation and training. In the included CI example, retraining is tied to a main-branch workflow after tests pass; in production, invoke the same commands from a scheduler, workflow engine, or event handler when the drift report is persisted. Do not use a high-frequency AI session for deterministic polling. Run the detector as a normal service job or platform-native scheduled job.

The minimum safe sequence is:

```bash
python -m src.training.prepare --input data/raw/transactions.csv --output data/processed/transactions.csv
python -m src.training.train --input data/processed/transactions.csv --output models/candidate.joblib --run-name retrain-$(date +%Y%m%d%H%M%S)
python -m src.monitoring.validate --candidate models/candidate.joblib --production models/model.joblib --data data/processed/transactions.csv --decision reports/validation.json
```

The model is accepted only when candidate ROC AUC and recall meet configured minimums and are not below the production model on the validation data. This is a baseline gate. Production gates should also include precision, calibration, false-positive cost, slice performance, fairness review where applicable, data quality, reproducibility, and approval metadata.

## 9. Deployment and rollback

The current local deployment mechanism is an atomic artifact replacement after validation:

```bash
cp models/model.joblib models/model.previous.joblib
cp models/candidate.joblib models/model.joblib
docker compose restart api consumer
```

Rollback is:

```bash
cp models/model.joblib models/model.failed.joblib
cp models/model.previous.joblib models/model.joblib
docker compose restart api consumer
```

Never overwrite the only copy of a production model. In a real registry, promote a version by alias or stage, keep immutable artifacts, record who/what/when, and use a deployment controller to roll back to the previous version. Add a canary phase before sending all traffic to a new model.

## 10. DVC and Git workflow

Initialize Git and DVC once:

```bash
git init
dvc init
dvc add data/raw/transactions.csv data/processed/transactions.csv
git add .dvc .dvcignore data/raw/transactions.csv.dvc data/processed/transactions.csv.dvc
git commit -m "initialize fraud detection mlops pipeline"
```

Configure a remote object store appropriate for the organization, then push data through DVC rather than Git. Keep secrets out of GitHub and `.env`; use repository or environment secrets for CI. A production DVC remote must have access control, encryption, retention, and backup policies.

## 11. Testing and CI/CD

Run local tests:

```bash
pytest -q
python -m compileall src tests
```

The CI workflow runs on pushes and pull requests. It installs pinned dependencies, compiles Python modules, and runs tests. On a successful push to `main`, the retraining job prepares data, trains a candidate, validates it against the production artifact, and uploads the validated artifact. Before enabling automatic promotion, add protected branches, required reviewers, secret management, DVC remote checkout, MLflow server authentication, and a deployment target.

## 12. Production hardening checklist

| Area | Required hardening |
|---|---|
| Data | Use a governed source, schema contracts, lineage, PII minimization, retention, and label-quality checks |
| Kafka | TLS/SASL, ACLs, replication factor, partitions based on throughput, retry/DLQ strategy, idempotency |
| API | Authentication, authorization, TLS, request limits, structured logs, correlation IDs, timeout policies |
| Model | Registry aliases, immutable artifacts, reproducible environments, calibration, slice metrics, approval gates |
| Retraining | Delayed labels, backtesting, drift plus performance triggers, cooldowns, concurrency locks |
| Monitoring | Alert thresholds, dashboards, SLOs, consumer lag, model performance, data quality, audit retention |
| Deployment | Canary or blue/green rollout, health probes, automatic rollback, artifact signing |
| Security | Secret manager, least privilege, container scanning, dependency scanning, network policies |
| Resilience | Durable MLflow/database/object storage, Kafka replication, backups, restore drills |

## 13. Key configuration variables

| Variable | Default | Meaning |
|---|---|---|
| `MODEL_PATH` | `models/model.joblib` | Model artifact loaded by API and consumer |
| `KAFKA_BOOTSTRAP_SERVERS` | `localhost:9092` | Kafka broker address |
| `KAFKA_TOPIC` | `transactions` | Transaction event topic |
| `MLFLOW_TRACKING_URI` | `http://localhost:5000` | MLflow server |
| `FRAUD_THRESHOLD` | `0.50` | Probability boundary for fraud decisions |
| `DRIFT_THRESHOLD` | `0.20` | Drift share that requests retraining |
| `MODEL_MIN_AUC` | `0.75` | Minimum candidate ROC AUC |
| `MODEL_MIN_RECALL` | `0.60` | Minimum candidate recall |

## 14. Suggested implementation order

Implement and verify the project in this order: first initialize Git/DVC and the directory structure; second bring up MLflow and prepare a governed dataset; third train and inspect the MLflow run; fourth start FastAPI and test `/health` and `/predict`; fifth start Kafka and verify producer-to-consumer flow; sixth add Prometheus/Grafana dashboards; seventh run drift detection on a new time window; eighth retrain a candidate; ninth run the validation gate; tenth promote only accepted artifacts; and finally test rollback by restoring the previous artifact.
