from datetime import datetime, timezone
from typing import Optional
from pydantic import BaseModel, Field


class Transaction(BaseModel):
    transaction_id: str
    amount: float = Field(ge=0)
    merchant_category: str
    customer_age: int = Field(ge=18, le=120)
    account_age_days: int = Field(ge=0)
    distance_from_home_km: float = Field(ge=0)
    hour: int = Field(ge=0, le=23)
    device_trust_score: float = Field(ge=0, le=1)
    previous_chargebacks: int = Field(ge=0)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    is_fraud: Optional[int] = Field(default=None, ge=0, le=1)


class Prediction(BaseModel):
    transaction_id: str
    fraud_probability: float
    is_fraud: bool
    model_version: str
    timestamp: datetime


FEATURES = [
    "amount", "customer_age", "account_age_days", "distance_from_home_km",
    "hour", "device_trust_score", "previous_chargebacks",
]
CATEGORICAL_FEATURES = ["merchant_category"]
