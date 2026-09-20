from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_path: str = "models/model.joblib"
    kafka_bootstrap_servers: str = "localhost:9092"
    kafka_topic: str = "transactions"
    kafka_group_id: str = "fraud-detector"
    mlflow_tracking_uri: str = "http://localhost:5000"
    mlflow_experiment: str = "fraud-detection"
    fraud_threshold: float = 0.50
    drift_threshold: float = 0.20
    model_min_auc: float = 0.75
    model_min_recall: float = 0.60

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="ignore")


settings = Settings()
