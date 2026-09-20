install:
	pip install -r requirements.txt

prepare:
	python -m src.training.prepare --input data/raw/transactions.csv --output data/processed/transactions.csv

train:
	python -m src.training.train --input data/processed/transactions.csv --output models/model.joblib

validate:
	python -m src.monitoring.validate --candidate models/candidate.joblib --production models/model.joblib --data data/processed/transactions.csv

drift:
	python -m src.monitoring.drift --reference data/processed/transactions.csv --current data/processed/current.csv --report reports/drift.json

test:
	pytest -q

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f api consumer
