import argparse
import json
from pathlib import Path
import mlflow
import mlflow.sklearn
import pandas as pd
from sklearn.metrics import roc_auc_score, precision_score, recall_score, f1_score
from sklearn.model_selection import train_test_split
from src.common.config import settings
from src.common.model import build_pipeline, save_model
from src.common.schemas import FEATURES, CATEGORICAL_FEATURES


def train(input_path: str, output_path: str, run_name: str = "training") -> dict:
    df = pd.read_csv(input_path)
    required = set(FEATURES + CATEGORICAL_FEATURES + ["is_fraud"])
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Missing columns: {sorted(missing)}")
    df = df.dropna(subset=list(required))
    X, y = df[FEATURES + CATEGORICAL_FEATURES], df["is_fraud"].astype(int)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )
    positives = max(int(y_train.sum()), 1)
    scale_pos_weight = (len(y_train) - positives) / positives
    model = build_pipeline(scale_pos_weight)
    mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
    mlflow.set_experiment(settings.mlflow_experiment)
    with mlflow.start_run(run_name=run_name) as run:
        model.fit(X_train, y_train)
        probabilities = model.predict_proba(X_test)[:, 1]
        predictions = (probabilities >= settings.fraud_threshold).astype(int)
        metrics = {
            "roc_auc": float(roc_auc_score(y_test, probabilities)),
            "precision": float(precision_score(y_test, predictions, zero_division=0)),
            "recall": float(recall_score(y_test, predictions, zero_division=0)),
            "f1": float(f1_score(y_test, predictions, zero_division=0)),
        }
        mlflow.log_params({"model": "XGBClassifier", "threshold": settings.fraud_threshold})
        mlflow.log_metrics(metrics)
        mlflow.sklearn.log_model(model, "model")
        save_model(model, output_path)
        Path(output_path).with_suffix(".metrics.json").write_text(json.dumps(metrics, indent=2))
        return {"run_id": run.info.run_id, **metrics, "model_path": output_path}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="data/processed/transactions.csv")
    parser.add_argument("--output", default=settings.model_path)
    parser.add_argument("--run-name", default="training")
    args = parser.parse_args()
    print(json.dumps(train(args.input, args.output, args.run_name), indent=2))
