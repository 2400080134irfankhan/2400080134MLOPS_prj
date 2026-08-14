import json
import logging
from datetime import datetime, timezone
from kafka import KafkaConsumer
from prometheus_client import Counter, start_http_server
from src.common.config import settings
from src.common.model import frame_from_transaction, load_model

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("fraud-consumer")
PROCESSED = Counter("fraud_consumer_transactions_total", "Transactions consumed")
ALERTS = Counter("fraud_consumer_alerts_total", "Fraud alerts emitted")


def run() -> None:
    model = load_model(settings.model_path)
    start_http_server(8001)
    consumer = KafkaConsumer(
        settings.kafka_topic,
        bootstrap_servers=settings.kafka_bootstrap_servers,
        group_id=settings.kafka_group_id,
        auto_offset_reset="earliest",
        enable_auto_commit=True,
        value_deserializer=lambda value: json.loads(value.decode("utf-8")),
    )
    logger.info("Listening to topic %s", settings.kafka_topic)
    for message in consumer:
        transaction = message.value
        probability = float(model.predict_proba(frame_from_transaction(transaction))[0, 1])
        fraud = probability >= settings.fraud_threshold
        PROCESSED.inc()
        if fraud:
            ALERTS.inc()
            logger.warning("FRAUD ALERT transaction_id=%s probability=%.4f", transaction.get("transaction_id"), probability)
        else:
            logger.info("Genuine transaction_id=%s probability=%.4f", transaction.get("transaction_id"), probability)
        logger.info("prediction=%s", {"transaction_id": transaction.get("transaction_id"), "is_fraud": fraud, "probability": probability, "timestamp": datetime.now(timezone.utc).isoformat()})


if __name__ == "__main__":
    run()
