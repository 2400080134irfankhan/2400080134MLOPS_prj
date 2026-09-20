import { randomUUID } from "node:crypto";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type Transaction = {
  id: string;
  timestamp: string;
  amount: number;
  merchantCategory: string;
  merchantId: string;
  merchantName: string;
  customerId: string;
  customerAge: number;
  customerLocation: string;
  merchantLocation: string;
  paymentMethod: string;
  deviceType: string;
  deviceId: string;
  accountAgeDays: number;
  transactionFrequency: number;
  previousTransactionAmount: number;
  distanceFromHome: number;
  failedAttempts: number;
  hour: number;
  dayOfWeek: string;
  isInternational: boolean;
  isNewDevice: boolean;
  isNewMerchant: boolean;
  velocity1h: number;
  velocity24h: number;
  amountDeviation: number;
  riskScore: number;
  fraudProbability: number;
  riskLevel: RiskLevel;
  prediction: "FRAUD" | "LEGITIMATE";
  isFraud: boolean;
  modelVersion: string;
  processingTimeMs: number;
  riskFactors: string[];
  features: Record<string, number>;
};

export type Alert = {
  id: string;
  type: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  description: string;
  createdAt: string;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  affectedMetric: string;
};

export type PipelineState = {
  status: "STOPPED" | "RUNNING" | "PAUSED";
  cursor: number;
  processed: number;
  lastTransactionId: string | null;
  startedAt: string | null;
  speed: number;
};

const categories = ["Online Retail", "Travel", "Electronics", "Grocery", "Digital Services", "Luxury Goods"];
const merchants = ["Northstar Market", "Orbit Travel", "Vertex Electronics", "Hearth & Basket", "Cloudline Media", "Mosaic Atelier"];
const paymentMethods = ["Card", "Digital wallet", "Bank transfer", "Virtual card"];
const locations = ["US", "CA", "GB", "DE", "SG", "AU", "NL", "JP"];
const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function seeded(index: number, salt = 0) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value));
}

function riskLevel(probability: number): RiskLevel {
  if (probability >= 0.7) return "HIGH";
  if (probability >= 0.3) return "MEDIUM";
  return "LOW";
}

function buildTransaction(index: number): Transaction {
  const hour = Math.floor(seeded(index, 1) * 24);
  const categoryIndex = Math.floor(seeded(index, 2) * categories.length);
  const merchantIndex = categoryIndex % merchants.length;
  const amountBase = [72, 165, 245, 46, 38, 620][categoryIndex];
  const amount = Math.max(8, amountBase * (0.45 + seeded(index, 3) * 1.9));
  const previous = amountBase * (0.7 + seeded(index, 4) * 0.65);
  const velocity1h = 1 + Math.floor(seeded(index, 5) * 8);
  const velocity24h = velocity1h + 2 + Math.floor(seeded(index, 6) * 28);
  const isInternational = seeded(index, 7) > 0.79;
  const isNewDevice = seeded(index, 8) > 0.86;
  const isNewMerchant = seeded(index, 9) > 0.82;
  const failedAttempts = Math.floor(seeded(index, 10) * 4);
  const distance = Math.round(3 + seeded(index, 11) * (isInternational ? 4200 : 160));
  const amountDeviation = Math.abs(amount - previous) / Math.max(previous, 1);
  const unusualHour = hour < 5 || hour > 22 ? 1 : 0;
  const locationRisk = clamp(distance / 1200);
  const score = -4.4 + velocity1h * 0.22 + amountDeviation * 0.9 + (isNewDevice ? 0.95 : 0) + (isNewMerchant ? 0.55 : 0) + (isInternational ? 0.75 : 0) + failedAttempts * 0.42 + unusualHour * 0.65 + locationRisk * 0.7 + (seeded(index, 12) - 0.5) * 0.85;
  const probability = clamp(0.015 + sigmoid(score) * 0.92);
  const prediction = probability >= 0.7 ? "FRAUD" : "LEGITIMATE";
  const isFraud = probability > 0.58 && seeded(index, 21) > 0.14;
  const factors: string[] = [];
  if (isNewDevice) factors.push("New device");
  if (amountDeviation > 1.8) factors.push(`Amount ${Math.max(1.1, amount / Math.max(previous, 1)).toFixed(1)}x normal`);
  if (velocity1h >= 6) factors.push("High transaction velocity");
  if (isInternational) factors.push("International transaction");
  if (failedAttempts >= 2) factors.push("Multiple failed attempts");
  if (unusualHour) factors.push("Unusual transaction hour");
  if (!factors.length) factors.push("Trusted transaction pattern");
  const timestamp = new Date(Date.now() - (2000 - index) * 218000).toISOString();
  const location = locations[Math.floor(seeded(index, 13) * locations.length)];
  return {
    id: `TXN-${String(100000 + index).padStart(6, "0")}`,
    timestamp,
    amount: Number(amount.toFixed(2)),
    merchantCategory: categories[categoryIndex],
    merchantId: `MRC-${String(200 + merchantIndex).padStart(4, "0")}`,
    merchantName: merchants[merchantIndex],
    customerId: `CUS-${String(30000 + (index % 640)).padStart(6, "0")}`,
    customerAge: 22 + Math.floor(seeded(index, 14) * 48),
    customerLocation: "US",
    merchantLocation: location,
    paymentMethod: paymentMethods[Math.floor(seeded(index, 15) * paymentMethods.length)],
    deviceType: ["iOS", "Android", "Web", "Tablet"][Math.floor(seeded(index, 16) * 4)],
    deviceId: `DEV-${String(50000 + (index % 830)).padStart(6, "0")}`,
    accountAgeDays: 12 + Math.floor(seeded(index, 17) * 1900),
    transactionFrequency: 1 + Math.floor(seeded(index, 18) * 16),
    previousTransactionAmount: Number(previous.toFixed(2)),
    distanceFromHome: distance,
    failedAttempts,
    hour,
    dayOfWeek: dayNames[new Date(timestamp).getUTCDay()],
    isInternational,
    isNewDevice,
    isNewMerchant,
    velocity1h,
    velocity24h,
    amountDeviation: Number(amountDeviation.toFixed(3)),
    riskScore: Number(clamp(probability * 1.08).toFixed(3)),
    fraudProbability: Number(probability.toFixed(3)),
    riskLevel: riskLevel(probability),
    prediction,
    isFraud,
    modelVersion: "v1.2.0",
    processingTimeMs: 18 + Math.floor(seeded(index, 19) * 58),
    riskFactors: factors.slice(0, 4),
    features: {
      velocityScore: velocity1h,
      failedAttemptRatio: Number((failedAttempts / Math.max(1, 90 + index % 400)).toFixed(3)),
      locationRisk: Number(locationRisk.toFixed(3)),
      deviceRisk: isNewDevice ? 1 : 0,
      merchantRisk: Number((0.01 + seeded(index, 20) * 0.08).toFixed(3)),
      timeRisk: unusualHour,
      internationalRisk: isInternational ? 1 : 0,
    },
  };
}

const transactions = Array.from({ length: 2000 }, (_, index) => buildTransaction(index));

const alerts: Alert[] = [
  { id: "ALT-001", type: "HIGH FRAUD RATE", severity: "CRITICAL", description: "Fraud rate increased from 2.8% to 4.1% in the last 24 hours.", createdAt: new Date(Date.now() - 18 * 60000).toISOString(), status: "OPEN", affectedMetric: "Fraud rate" },
  { id: "ALT-002", type: "DATA DRIFT", severity: "WARNING", description: "velocity_1h PSI exceeded the configured warning threshold.", createdAt: new Date(Date.now() - 86 * 60000).toISOString(), status: "ACKNOWLEDGED", affectedMetric: "velocity_1h" },
  { id: "ALT-003", type: "HIGH LATENCY", severity: "WARNING", description: "95th percentile inference latency reached 412 ms.", createdAt: new Date(Date.now() - 145 * 60000).toISOString(), status: "OPEN", affectedMetric: "p95 latency" },
  { id: "ALT-004", type: "MODEL PERFORMANCE", severity: "INFO", description: "Precision is stable and above the production target.", createdAt: new Date(Date.now() - 310 * 60000).toISOString(), status: "RESOLVED", affectedMetric: "Precision" },
];

export const state = {
  transactions,
  alerts,
  pipeline: { status: "STOPPED", cursor: 1885, processed: 1885, lastTransactionId: transactions[1884]?.id ?? null, startedAt: null, speed: 5 } as PipelineState,
  settings: { lowThreshold: 0.3, highThreshold: 0.7, latencyThreshold: 500, driftThreshold: 0.25 },
  audit: [
    { id: randomUUID(), timestamp: new Date(Date.now() - 16 * 60000).toISOString(), event: "Pipeline stopped", user: "Ops Console", resource: "pipeline", details: "Stream paused after processing 1,885 transactions" },
    { id: randomUUID(), timestamp: new Date(Date.now() - 42 * 60000).toISOString(), event: "Alert acknowledged", user: "Maya Chen", resource: "ALT-002", details: "Data drift review started" },
    { id: randomUUID(), timestamp: new Date(Date.now() - 119 * 60000).toISOString(), event: "Model deployed", user: "System", resource: "v1.2.0", details: "Random Forest promoted to production" },
    { id: randomUUID(), timestamp: new Date(Date.now() - 183 * 60000).toISOString(), event: "Threshold changed", user: "Maya Chen", resource: "risk-engine", details: "High risk threshold set to 0.70" },
  ],
};

export function getTransaction(id: string) {
  return state.transactions.find((transaction) => transaction.id === id);
}

export function classify(probability: number): RiskLevel {
  return riskLevel(probability);
}

export function addAudit(event: string, resource: string, details: string) {
  state.audit.unshift({ id: randomUUID(), timestamp: new Date().toISOString(), event, user: "Maya Chen", resource, details });
}

export function getMetrics() {
  const rows = state.transactions.slice(0, state.pipeline.processed);
  const fraud = rows.filter((row) => row.prediction === "FRAUD");
  const avgProbability = rows.reduce((sum, row) => sum + row.fraudProbability, 0) / Math.max(rows.length, 1);
  const latency = rows.map((row) => row.processingTimeMs).sort((a, b) => a - b);
  const tp = rows.filter((row) => row.prediction === "FRAUD" && row.isFraud).length;
  const actualFraud = rows.filter((row) => row.isFraud).length;
  const precision = fraud.length ? tp / fraud.length : 0;
  const recall = actualFraud ? tp / actualFraud : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    total: rows.length,
    fraud: fraud.length,
    fraudRate: fraud.length / Math.max(rows.length, 1),
    avgProbability,
    precision,
    recall,
    f1,
    p95: latency[Math.min(latency.length - 1, Math.floor(latency.length * 0.95))] ?? 0,
    avgLatency: latency.reduce((sum, value) => sum + value, 0) / Math.max(latency.length, 1),
  };
}

export function summary() {
  const rows = state.transactions.slice(0, state.pipeline.processed);
  const metrics = getMetrics();
  const dayBuckets = new Map<string, { total: number; fraud: number }>();
  rows.slice(-240).forEach((row) => {
    const day = new Date(row.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const bucket = dayBuckets.get(day) ?? { total: 0, fraud: 0 };
    bucket.total += 1;
    if (row.prediction === "FRAUD") bucket.fraud += 1;
    dayBuckets.set(day, bucket);
  });
  const category = categories.map((name) => {
    const group = rows.filter((row) => row.merchantCategory === name);
    return { name, fraud: group.filter((row) => row.prediction === "FRAUD").length, total: group.length };
  });
  const payment = paymentMethods.map((name) => ({ name, value: rows.filter((row) => row.paymentMethod === name).length }));
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour: `${String(hour).padStart(2, "0")}:00`, fraud: rows.filter((row) => row.hour === hour && row.prediction === "FRAUD").length, total: rows.filter((row) => row.hour === hour).length }));
  const distribution = [
    { name: "0–30%", value: rows.filter((row) => row.fraudProbability < 0.3).length },
    { name: "30–70%", value: rows.filter((row) => row.fraudProbability >= 0.3 && row.fraudProbability < 0.7).length },
    { name: "70–100%", value: rows.filter((row) => row.fraudProbability >= 0.7).length },
  ];
  return {
    metrics,
    trend: Array.from(dayBuckets.entries()).map(([date, values]) => ({ date, ...values })),
    category,
    payment,
    hours,
    distribution,
    latency: rows.slice(-80).map((row) => ({ time: new Date(row.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }), value: row.processingTimeMs })),
    modelPerformance: [{ metric: "Precision", current: metrics.precision, baseline: 0.84 }, { metric: "Recall", current: metrics.recall, baseline: 0.78 }, { metric: "F1", current: metrics.f1, baseline: 0.81 }, { metric: "PR-AUC", current: 0.88, baseline: 0.81 }],
    recentTransactions: rows.slice(-8).reverse(),
    activeAlerts: state.alerts.filter((alert) => alert.status !== "RESOLVED").length,
  };
}

export function monitoring() {
  const metrics = getMetrics();
  const drift = [
    { feature: "amount", baseline: 0.12, current: 0.18, psi: 0.07, status: "Stable" },
    { feature: "velocity_1h", baseline: 0.21, current: 0.38, psi: 0.31, status: "Warning" },
    { feature: "distance_from_home", baseline: 0.15, current: 0.19, psi: 0.12, status: "Stable" },
    { feature: "failed_attempts", baseline: 0.08, current: 0.13, psi: 0.22, status: "Stable" },
    { feature: "amount_deviation", baseline: 0.14, current: 0.26, psi: 0.28, status: "Warning" },
  ];
  return { metrics, drift, quality: { processed: state.pipeline.processed, valid: state.pipeline.processed - 3, invalid: 3, duplicates: 2, missing: 7 }, predictionDrift: [{ label: "Baseline", low: 78, medium: 16, high: 6 }, { label: "Production", low: Math.round((1 - metrics.fraudRate - 0.12) * 100), medium: 12, high: Math.round(metrics.fraudRate * 100) }], updatedAt: new Date().toISOString() };
}

export function models() {
  return [
    { version: "v1.2.0", algorithm: "Random Forest", created: "2026-09-18T11:20:00.000Z", dataset: "sentinel-synthetic-2k", precision: 0.91, recall: 0.84, f1: 0.87, prAuc: 0.88, status: "Production", features: 14, params: "n_estimators=240 · class_weight=balanced" },
    { version: "v1.1.0", algorithm: "Random Forest", created: "2026-09-12T09:45:00.000Z", dataset: "sentinel-synthetic-2k", precision: 0.88, recall: 0.8, f1: 0.84, prAuc: 0.84, status: "Archived", features: 14, params: "n_estimators=160 · class_weight=balanced" },
    { version: "baseline-1", algorithm: "Logistic Regression", created: "2026-09-10T14:05:00.000Z", dataset: "sentinel-synthetic-2k", precision: 0.79, recall: 0.73, f1: 0.76, prAuc: 0.77, status: "Reference", features: 14, params: "C=1.0 · class_weight=balanced" },
  ];
}

export { categories, paymentMethods };
