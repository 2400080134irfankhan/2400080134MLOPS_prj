import pandas as pd
from fastapi.testclient import TestClient
from src.common.model import build_pipeline
from src.common.schemas import FEATURES, CATEGORICAL_FEATURES
from src.training.prepare import prepare


def sample_frame(n=20):
    rows = []
    for i in range(n):
        rows.append({
            "amount": 10 + i * 2,
            "merchant_category": "retail" if i % 2 else "travel",
            "customer_age": 30 + i % 10,
            "account_age_days": 100 + i,
            "distance_from_home_km": float(i),
            "hour": i % 24,
            "device_trust_score": 0.9 if i % 3 else 0.1,
            "previous_chargebacks": i % 3,
            "is_fraud": int(i % 4 == 0),
        })
    return pd.DataFrame(rows)


def test_prepare_writes_validated_data(tmp_path):
    source = tmp_path / "source.csv"
    output = tmp_path / "processed.csv"
    sample_frame().to_csv(source, index=False)
    report = prepare(str(source), str(output))
    assert output.exists()
    assert report["rows"] == 20
    assert 0 < report["fraud_rate"] < 1


def test_model_pipeline_predicts_probabilities():
    df = sample_frame(40)
    model = build_pipeline()
    model.fit(df[FEATURES + CATEGORICAL_FEATURES], df["is_fraud"])
    probabilities = model.predict_proba(df[FEATURES + CATEGORICAL_FEATURES])[:, 1]
    assert len(probabilities) == 40
    assert ((probabilities >= 0) & (probabilities <= 1)).all()


def test_api_health():
    from src.api.main import app
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
