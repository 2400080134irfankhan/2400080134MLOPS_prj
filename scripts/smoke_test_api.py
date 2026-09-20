import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from src.api.main import app

client = TestClient(app)
payload = {
    "transaction_id": "smoke-001",
    "amount": 245.50,
    "merchant_category": "online",
    "customer_age": 35,
    "account_age_days": 420,
    "distance_from_home_km": 42.0,
    "hour": 2,
    "device_trust_score": 0.18,
    "previous_chargebacks": 1,
}
response = client.post("/predict", json=payload)
response.raise_for_status()
print(response.json())
