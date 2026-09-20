import argparse
import json
from pathlib import Path
import pandas as pd
import numpy as np
from scipy.stats import ks_2samp, chi2_contingency
from src.common.schemas import FEATURES, CATEGORICAL_FEATURES


def detect(reference_path: str, current_path: str, report_path: str, threshold: float = 0.20) -> dict:
    """
    Detect data drift using Kolmogorov-Smirnov test for numeric features
    and chi-square test for categorical features.
    """
    reference = pd.read_csv(reference_path)
    current = pd.read_csv(current_path)
    
    feature_cols = FEATURES + CATEGORICAL_FEATURES
    drifted_count = 0
    total_count = 0
    drift_details = {}
    
    # Test numeric features
    for col in FEATURES:
        if col in reference.columns and col in current.columns:
            total_count += 1
            ref_data = reference[col].dropna()
            cur_data = current[col].dropna()
            
            if len(ref_data) > 0 and len(cur_data) > 0:
                statistic, p_value = ks_2samp(ref_data, cur_data)
                is_drifted = p_value < 0.05
                if is_drifted:
                    drifted_count += 1
                drift_details[col] = {
                    "type": "numeric",
                    "ks_statistic": float(statistic),
                    "p_value": float(p_value),
                    "drifted": is_drifted
                }
    
    # Test categorical features
    for col in CATEGORICAL_FEATURES:
        if col in reference.columns and col in current.columns:
            total_count += 1
            ref_counts = reference[col].value_counts()
            cur_counts = current[col].value_counts()
            
            # Align categories
            all_categories = set(ref_counts.index) | set(cur_counts.index)
            ref_counts = ref_counts.reindex(all_categories, fill_value=0)
            cur_counts = cur_counts.reindex(all_categories, fill_value=0)
            
            contingency_table = np.array([ref_counts.values, cur_counts.values])
            chi2, p_value, dof, expected = chi2_contingency(contingency_table)
            is_drifted = p_value < 0.05
            if is_drifted:
                drifted_count += 1
            drift_details[col] = {
                "type": "categorical",
                "chi2_statistic": float(chi2),
                "p_value": float(p_value),
                "drifted": is_drifted
            }
    
    share = float(drifted_count / total_count) if total_count > 0 else 0.0
    decision = {
        "drift_share": share,
        "threshold": threshold,
        "retrain_required": share >= threshold,
        "drifted_features": drifted_count,
        "total_features": total_count
    }
    
    Path(report_path).parent.mkdir(parents=True, exist_ok=True)
    Path(report_path).write_text(json.dumps(
        {"decision": decision, "drift_details": drift_details},
        indent=2,
        default=str
    ))
    return decision


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", required=True)
    parser.add_argument("--current", required=True)
    parser.add_argument("--report", default="reports/drift.json")
    parser.add_argument("--threshold", type=float, default=0.20)
    args = parser.parse_args()
    print(json.dumps(detect(args.reference, args.current, args.report, args.threshold), indent=2))
