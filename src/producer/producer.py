import json
import sys
from kafka import KafkaProducer
from src.common.config import settings
from src.common.schemas import Transaction


def publish(transaction: Transaction) -> None:
    producer = KafkaProducer(
        bootstrap_servers=settings.kafka_bootstrap_servers,
        value_serializer=lambda value: json.dumps(value).encode("utf-8"),
    )
    producer.send(settings.kafka_topic, value=transaction.model_dump(mode="json"))
    producer.flush()
    producer.close()


if __name__ == "__main__":
    payload = json.loads(sys.stdin.read())
    publish(Transaction.model_validate(payload))
