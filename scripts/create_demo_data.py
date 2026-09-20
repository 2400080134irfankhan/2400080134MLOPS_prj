"""Create a deterministic local fixture for smoke tests and demos only.

Replace data/raw/transactions.csv with an approved real dataset before production use.
"""
from pathlib import Path
import numpy as np
import pandas as pd

rng = np.random.default_rng(42)
n = 1000
fraud = rng.binomial(1, 0.08, n)
df = pd.DataFrame({
    "amount": np.maximum(1, rng.lognormal(3.4, 1.0, n) + fraud * 80),
    "merchant_category": rng.choice(["retail", "travel", "food", "cash", "online"], n),
    "customer_age": rng.integers(18, 80, n),
    "account_age_days": rng.integers(1, 3000, n),
    "distance_from_home_km": np.maximum(0, rng.normal(12, 15, n) + fraud * 30),
    "hour": rng.integers(0, 24, n),
    "device_trust_score": np.clip(rng.normal(0.75, 0.2, n) - fraud * 0.45, 0, 1),
    "previous_chargebacks": np.maximum(0, rng.poisson(0.2, n) + fraud),
    "is_fraud": fraud,
})
Path("data/raw").mkdir(parents=True, exist_ok=True)
df.to_csv("data/raw/transactions.csv", index=False)
print(f"wrote {len(df)} demo rows to data/raw/transactions.csv")
