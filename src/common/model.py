from pathlib import Path
import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from xgboost import XGBClassifier
from .schemas import FEATURES, CATEGORICAL_FEATURES


def build_pipeline(scale_pos_weight: float = 1.0) -> Pipeline:
    numeric = Pipeline([("scale", StandardScaler())])
    categorical = Pipeline([("onehot", OneHotEncoder(handle_unknown="ignore"))])
    preprocessor = ColumnTransformer([
        ("numeric", numeric, FEATURES),
        ("categorical", categorical, CATEGORICAL_FEATURES),
    ])
    classifier = XGBClassifier(
        n_estimators=250, max_depth=5, learning_rate=0.05,
        subsample=0.9, colsample_bytree=0.9, eval_metric="logloss",
        random_state=42, n_jobs=2, scale_pos_weight=scale_pos_weight,
    )
    return Pipeline([("preprocessor", preprocessor), ("classifier", classifier)])


def frame_from_transaction(transaction: dict) -> pd.DataFrame:
    return pd.DataFrame([{key: transaction[key] for key in FEATURES + CATEGORICAL_FEATURES}])


def save_model(model, path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, path)


def load_model(path: str):
    if not Path(path).exists():
        raise FileNotFoundError(f"Model not found at {path}. Run training first.")
    return joblib.load(path)
