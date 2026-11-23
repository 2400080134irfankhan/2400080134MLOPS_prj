import { sql } from "drizzle-orm";
import {
  bigint, boolean, check, decimal, double, foreignKey, index, int, json, mysqlEnum,
  mediumtext, mysqlTable, text, timestamp, varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

const occurredAt = (name: string) => timestamp(name, { fsp: 3 }).notNull();
const insertedAt = () => occurredAt("created_at").default(sql`CURRENT_TIMESTAMP(3)`);
const versionKey = (name: string) => varchar(name, { length: 64 });
const actorId = () => int("actor_user_id").references(() => users.id, { onDelete: "set null" });
const actorKind = () => mysqlEnum("actor_kind", ["user", "demo", "system"]).notNull();
const riskLevel = () => mysqlEnum("risk_level", ["LOW", "MEDIUM", "HIGH"]).notNull();
const prediction = () => mysqlEnum("prediction", ["FRAUD", "LEGITIMATE"]).notNull();

export const modelArtifacts = mysqlTable("model_artifacts", {
  digest: varchar("digest", { length: 64 }).primaryKey(),
  kind: mysqlEnum("kind", ["scorer", "manifest"]).notNull(),
  payload: mediumtext("payload").notNull(),
  createdAt: insertedAt(),
});

export const modelVersions = mysqlTable("model_versions", {
  version: versionKey("version").primaryKey(),
  algorithm: varchar("algorithm", { length: 100 }).notNull(),
  createdAt: insertedAt(),
  dataset: varchar("dataset", { length: 100 }).notNull(),
  featureCount: int("feature_count", { unsigned: true }).notNull(),
  params: text("params").notNull(),
  metrics: json("metrics").$type<ModelMetrics>().notNull(),
  isReference: boolean("is_reference").default(false).notNull(),
  artifact: varchar("artifact", { length: 200 }),
});

type ModelMetrics = { precision: number; recall: number; f1: number; prAuc: number };

export const modelRuns = mysqlTable("model_runs", {
  id: varchar("id", { length: 64 }).primaryKey(),
  version: versionKey("version").notNull().references(() => modelVersions.version),
  dataset: varchar("dataset", { length: 100 }).notNull(),
  featureSet: varchar("feature_set", { length: 100 }).notNull(),
  startedAt: occurredAt("started_at"),
  completedAt: timestamp("completed_at", { fsp: 3 }),
  stage: mysqlEnum("stage", ["IDLE", "TRAINING", "VALIDATING", "READY", "DEPLOYED", "FAILED"]).notNull(),
  metrics: json("metrics").$type<ModelMetrics>(),
  gates: json("gates").$type<{ dataQuality: boolean; performance: boolean; drift: boolean }>().notNull(),
  message: text("message").notNull(),
  actorUserId: actorId(),
}, t => [index("run_version_time").on(t.version, t.startedAt), index("run_time").on(t.startedAt, t.id)]);

export const modelDeploymentState = mysqlTable("model_deployment_state", {
  id: int("id").primaryKey(),
  activeVersion: versionKey("active_version").notNull().references(() => modelVersions.version),
  previousVersion: versionKey("previous_version"),
  nextCandidate: int("next_candidate", { unsigned: true }).notNull(),
  revision: int("revision", { unsigned: true }).default(0).notNull(),
}, t => [
  check("deployment_singleton", sql`${t.id} = 1`),
  foreignKey({ name: "deployment_previous_version_fk", columns: [t.previousVersion], foreignColumns: [modelVersions.version] }).onDelete("no action").onUpdate("no action"),
]);

export const transactions = mysqlTable("transactions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  streamSequence: int("stream_sequence", { unsigned: true }).notNull().unique(),
  timestamp: occurredAt("occurred_at"),
  amount: decimal("amount", { precision: 18, scale: 2 }).notNull(),
  merchantCategory: varchar("merchant_category", { length: 80 }).notNull(),
  merchantId: varchar("merchant_id", { length: 64 }).notNull(),
  merchantName: varchar("merchant_name", { length: 160 }).notNull(),
  customerId: varchar("customer_id", { length: 64 }).notNull(),
  customerAge: int("customer_age").notNull(),
  customerLocation: varchar("customer_location", { length: 80 }).notNull(),
  merchantLocation: varchar("merchant_location", { length: 80 }).notNull(),
  paymentMethod: varchar("payment_method", { length: 80 }).notNull(),
  deviceType: varchar("device_type", { length: 80 }).notNull(),
  deviceId: varchar("device_id", { length: 64 }).notNull(),
  accountAgeDays: int("account_age_days").notNull(),
  transactionFrequency: int("transaction_frequency").notNull(),
  previousTransactionAmount: decimal("previous_transaction_amount", { precision: 18, scale: 2 }).notNull(),
  distanceFromHome: double("distance_from_home").notNull(),
  failedAttempts: int("failed_attempts").notNull(),
  hour: int("hour").notNull(),
  dayOfWeek: varchar("day_of_week", { length: 12 }).notNull(),
  isInternational: boolean("is_international").notNull(),
  isNewDevice: boolean("is_new_device").notNull(),
  isNewMerchant: boolean("is_new_merchant").notNull(),
  velocity1h: int("velocity_1h").notNull(),
  velocity24h: int("velocity_24h").notNull(),
  amountDeviation: double("amount_deviation").notNull(),
  riskScore: double("risk_score").notNull(),
  fraudProbability: double("fraud_probability").notNull(),
  riskLevel: riskLevel(),
  prediction: prediction(),
  isFraud: boolean("is_fraud").notNull(),
  modelVersion: versionKey("model_version").notNull().references(() => modelVersions.version),
  processingTimeMs: int("processing_time_ms", { unsigned: true }).notNull(),
  riskFactors: json("risk_factors").$type<string[]>().notNull(),
  features: json("features").$type<Record<string, number>>().notNull(),
}, t => [
  index("tx_risk_sequence").on(t.riskLevel, t.streamSequence),
  index("tx_prediction_sequence").on(t.prediction, t.streamSequence),
  check("tx_probability", sql`${t.fraudProbability} BETWEEN 0 AND 1`),
]);

export const pipelineState = mysqlTable("pipeline_state", {
  id: int("id").primaryKey(),
  status: mysqlEnum("status", ["STOPPED", "RUNNING", "PAUSED"]).notNull(),
  cursor: int("cursor", { unsigned: true }).notNull(),
  startedAt: timestamp("started_at", { fsp: 3 }),
  speed: int("speed").notNull(),
  revision: int("revision", { unsigned: true }).default(0).notNull(),
}, t => [check("pipeline_singleton", sql`${t.id} = 1`), check("pipeline_speed", sql`${t.speed} BETWEEN 1 AND 10`)]);

export const alerts = mysqlTable("alerts", {
  id: varchar("id", { length: 64 }).primaryKey(),
  type: varchar("type", { length: 80 }).notNull(),
  severity: mysqlEnum("severity", ["CRITICAL", "WARNING", "INFO"]).notNull(),
  description: text("description").notNull(),
  affectedMetric: varchar("affected_metric", { length: 100 }).notNull(),
  status: mysqlEnum("status", ["OPEN", "ACKNOWLEDGED", "RESOLVED"]).notNull(),
  createdAt: insertedAt(),
  updatedAt: occurredAt("updated_at"),
}, t => [index("alert_status_time").on(t.status, t.createdAt, t.id)]);

export const auditEvents = mysqlTable("audit_events", {
  eventOrder: bigint("event_order", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  id: varchar("id", { length: 64 }).notNull().unique(),
  createdAt: insertedAt(),
  event: varchar("event", { length: 120 }).notNull(),
  actorUserId: actorId(),
  actorKind: actorKind(),
  actorLabel: varchar("actor_label", { length: 160 }).notNull(),
  resourceType: varchar("resource_type", { length: 64 }).notNull(),
  resourceId: varchar("resource_id", { length: 100 }).notNull(),
  details: text("details").notNull(),
  changes: json("changes"),
}, t => [index("audit_resource_order").on(t.resourceType, t.resourceId, t.eventOrder)]);

export const appSettings = mysqlTable("app_settings", {
  id: int("id").primaryKey(),
  lowThreshold: double("low_threshold").notNull(),
  highThreshold: double("high_threshold").notNull(),
  latencyThreshold: double("latency_threshold").notNull(),
  driftThreshold: double("drift_threshold").notNull(),
  revision: int("revision", { unsigned: true }).default(0).notNull(),
  updatedAt: occurredAt("updated_at"),
  actorUserId: actorId(),
}, t => [
  check("settings_singleton", sql`${t.id} = 1`),
  check("settings_threshold_bounds", sql`${t.lowThreshold} BETWEEN 0 AND 1 AND ${t.highThreshold} BETWEEN 0 AND 1 AND ${t.driftThreshold} BETWEEN 0 AND 1 AND ${t.latencyThreshold} BETWEEN 50 AND 5000`),
]);

export const scanHistory = mysqlTable("scan_history", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  kind: mysqlEnum("kind", ["URL", "EMAIL"]).notNull(),
  createdAt: insertedAt(),
  actorUserId: actorId(),
  actorKind: actorKind(),
  verdict: varchar("verdict", { length: 40 }).notNull(),
  riskScore: int("risk_score", { unsigned: true }).notNull(),
  formatVersion: int("format_version", { unsigned: true }).notNull(),
  result: json("result").notNull(),
}, t => [
  index("scan_kind_time").on(t.kind, t.createdAt, t.id),
  index("scan_retention").on(t.createdAt, t.id),
  check("scan_score", sql`${t.riskScore} BETWEEN 0 AND 100`),
]);

export const scoringRequests = mysqlTable("scoring_requests", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  createdAt: insertedAt(),
  actorUserId: actorId(),
  actorKind: actorKind(),
  dataset: varchar("dataset", { length: 100 }).notNull(),
  inputs: json("inputs").notNull(),
  // Historical version observed at inference, including process-local promotions.
  modelVersion: versionKey("model_version").notNull(),
  artifact: varchar("artifact", { length: 200 }).notNull(),
  probability: double("probability").notNull(),
  riskLevel: riskLevel(),
  prediction: prediction(),
  processingTimeMs: int("processing_time_ms", { unsigned: true }).notNull(),
  metrics: json("metrics").$type<ModelMetrics>().notNull(),
  topRiskFactors: json("top_risk_factors").$type<string[]>().notNull(),
}, t => [
  index("scoring_retention").on(t.createdAt, t.id),
  check("scoring_probability", sql`${t.probability} BETWEEN 0 AND 1`),
]);
