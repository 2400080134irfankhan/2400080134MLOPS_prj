import argparse
import json
from pathlib import Path
import pandas as pd
from sklearn.metrics import roc_auc_score, recall_score
from src.common.config import settings
from src.common.model import load_model
from src.common.schemas import FEATURES, CATEGORICAL_FEATURES


def evaluate(model_path: str, data_path: str) -> dict:
    df = pd.read_csv(data_path)
    X = df[FEATURES + CATEGORICAL_FEATURES]
    y = df["is_fraud"].astype(int)
    p = load_model(model_path).predict_proba(X)[:, 1]
    pred = (p >= settings.fraud_threshold).astype(int)
    return {
        "roc_auc": float(roc_auc_score(y, p)),
        "recall": float(recall_score(y, pred, zero_division=0)),
    }


def validate(candidate_path: str, production_path: str, data_path: str, decision_path: str) -> dict:
    candidate = evaluate(candidate_path, data_path)
    production = evaluate(production_path, data_path) if Path(production_path).exists() else {"roc_auc": 0.0, "recall": 0.0}
    accepted = (
        candidate["roc_auc"] >= settings.model_min_auc
        and candidate["recall"] >= settings.model_min_recall
        and candidate["roc_auc"] >= production["roc_auc"]
        and candidate["recall"] >= production["recall"]
    )
    decision = {"accepted": accepted, "candidate": candidate, "production": production}
    Path(decision_path).parent.mkdir(parents=True, exist_ok=True)
    Path(decision_path).write_text(json.dumps(decision, indent=2))
    return decision


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--production", default="models/model.joblib")
    parser.add_argument("--data", required=True)
    parser.add_argument("--decision", default="reports/validation.json")
    args = parser.parse_args()
    print(json.dumps(validate(args.candidate, args.production, args.data, args.decision), indent=2))
