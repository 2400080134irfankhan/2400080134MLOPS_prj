import pandas as pd
import numpy as np

# Create reference dataset
np.random.seed(42)
n_samples = 1000
reference_data = pd.DataFrame({
    'amount': np.random.lognormal(mean=3, sigma=1, size=n_samples),
    'age': np.random.normal(loc=40, scale=15, size=n_samples),
    'transaction_count': np.random.poisson(lam=5, size=n_samples),
    'merchant_category': np.random.choice(['groceries', 'gas', 'online', 'restaurant'], size=n_samples),
    'is_weekend': np.random.choice([0, 1], size=n_samples, p=[0.7, 0.3])
})
reference_data.to_csv('data/processed/transactions.csv', index=False)

# Create current dataset with slight drift
current_data = pd.DataFrame({
    'amount': np.random.lognormal(mean=3.3, sigma=1.2, size=n_samples),  # Shifted distribution
    'age': np.random.normal(loc=38, scale=16, size=n_samples),
    'transaction_count': np.random.poisson(lam=6, size=n_samples),
    'merchant_category': np.random.choice(['groceries', 'gas', 'online', 'restaurant'], size=n_samples),
    'is_weekend': np.random.choice([0, 1], size=n_samples, p=[0.6, 0.4])
})
current_data.to_csv('data/processed/current.csv', index=False)
print("Sample data created successfully")
