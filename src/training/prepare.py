import argparse
import json
from pathlib import Path
import pandas as pd
from src.common.schemas import FEATURES, CATEGORICAL_FEATURES


def prepare(input_path: str, output_path: str) -> dict:
    df = pd.read_csv(input_path)
    required = FEATURES + CATEGORICAL_FEATURES + ["is_fraud"]
    missing = sorted(set(required) - set(df.columns))
    if missing:
        raise ValueError(f"Missing required columns: {missing}")
    df = df[required].dropna().copy()
    df["is_fraud"] = df["is_fraud"].astype(int)
    if df["is_fraud"].nunique() < 2:
        raise ValueError("Training data must contain both fraud and genuine classes")
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_path, index=False)
    report = {"rows": len(df), "fraud_rate": float(df["is_fraud"].mean()), "columns": required}
    Path(output_path).with_suffix(".quality.json").write_text(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", default="data/processed/transactions.csv")
    args = parser.parse_args()
    print(json.dumps(prepare(args.input, args.output), indent=2))
