import argparse
import json
from pathlib import Path
import pandas as pd
from evidently import Report
from evidently.presets import DataDriftPreset
from src.common.schemas import FEATURES, CATEGORICAL_FEATURES


def detect(reference_path: str, current_path: str, report_path: str, threshold: float = 0.20) -> dict:
    reference = pd.read_csv(reference_path)
    current = pd.read_csv(current_path)
    report = Report([DataDriftPreset()])
    snapshot = report.run(current_data=current[FEATURES + CATEGORICAL_FEATURES], reference_data=reference[FEATURES + CATEGORICAL_FEATURES])
    result = snapshot.dict()
    drifted = 0
    total = 0
    for metric in result.get("metrics", []):
        value = metric.get("value")
        if isinstance(value, dict) and "count" in value and "share" in value:
            drifted = value["count"]
            total = value["count"] / value["share"] if value["share"] else 0
    share = float(drifted / total) if total else 0.0
    decision = {"drift_share": share, "threshold": threshold, "retrain_required": share >= threshold}
    Path(report_path).parent.mkdir(parents=True, exist_ok=True)
    Path(report_path).write_text(json.dumps({"decision": decision, "evidently": result}, indent=2, default=str))
    return decision


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", required=True)
    parser.add_argument("--current", required=True)
    parser.add_argument("--report", default="reports/drift.json")
    parser.add_argument("--threshold", type=float, default=0.20)
    args = parser.parse_args()
    print(json.dumps(detect(args.reference, args.current, args.report, args.threshold), indent=2))
