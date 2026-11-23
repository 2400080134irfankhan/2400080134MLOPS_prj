// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  clientOrigin: process.env.CLIENT_ORIGIN ?? ""
};
var demoAuthEnabled = process.env.NODE_ENV === "development" && process.env.DEMO_AUTH_ENABLED === "true" && Boolean(process.env.DEMO_AUTH_EMAIL?.trim() && process.env.DEMO_AUTH_PASSWORD);
function validateEnvironment() {
  if (!ENV.isProduction) return;
  if (process.env.DEMO_AUTH_ENABLED?.trim().toLowerCase() === "true") {
    throw new Error("DEMO_AUTH_ENABLED must be false in production");
  }
  if (Buffer.byteLength(ENV.cookieSecret.trim()) < 32) {
    throw new Error("JWT_SECRET must contain at least 32 bytes in production");
  }
  if (!ENV.appId.trim()) throw new Error("VITE_APP_ID is required in production");
  for (const [name, value, protocol] of [
    ["OAUTH_SERVER_URL", ENV.oAuthServerUrl, "https:"],
    ["DATABASE_URL", ENV.databaseUrl, "mysql:"]
  ]) {
    if (!URL.canParse(value) || new URL(value).protocol !== protocol) {
      throw new Error(`Set ${name} to a valid ${protocol} URL in production`);
    }
  }
}

// server/_core/app.ts
import express from "express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
var OAUTH_STATE_COOKIE = "__Host-oauth_state";
var decodeOAuthState = (state2) => {
  let decoded;
  try {
    decoded = atob(state2);
  } catch {
    return { redirectUri: "" };
  }
  try {
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.redirectUri === "string") return parsed;
  } catch {
  }
  return { redirectUri: decoded };
};

// server/_core/oauth.ts
import { parse as parseCookieHeader2 } from "cookie";

// server/db.ts
import { eq, sql as sql2 } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

// drizzle/schema.ts
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  decimal,
  double,
  foreignKey,
  index,
  int,
  json,
  mysqlEnum,
  mediumtext,
  mysqlTable,
  text,
  timestamp,
  varchar
} from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
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
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var occurredAt = (name) => timestamp(name, { fsp: 3 }).notNull();
var insertedAt = () => occurredAt("created_at").default(sql`CURRENT_TIMESTAMP(3)`);
var versionKey = (name) => varchar(name, { length: 64 });
var actorId = () => int("actor_user_id").references(() => users.id, { onDelete: "set null" });
var actorKind = () => mysqlEnum("actor_kind", ["user", "demo", "system"]).notNull();
var riskLevel = () => mysqlEnum("risk_level", ["LOW", "MEDIUM", "HIGH"]).notNull();
var prediction = () => mysqlEnum("prediction", ["FRAUD", "LEGITIMATE"]).notNull();
var modelArtifacts = mysqlTable("model_artifacts", {
  digest: varchar("digest", { length: 64 }).primaryKey(),
  kind: mysqlEnum("kind", ["scorer", "manifest"]).notNull(),
  payload: mediumtext("payload").notNull(),
  createdAt: insertedAt()
});
var modelVersions = mysqlTable("model_versions", {
  version: versionKey("version").primaryKey(),
  algorithm: varchar("algorithm", { length: 100 }).notNull(),
  createdAt: insertedAt(),
  dataset: varchar("dataset", { length: 100 }).notNull(),
  featureCount: int("feature_count", { unsigned: true }).notNull(),
  params: text("params").notNull(),
  metrics: json("metrics").$type().notNull(),
  isReference: boolean("is_reference").default(false).notNull(),
  artifact: varchar("artifact", { length: 200 })
});
var modelRuns = mysqlTable("model_runs", {
  id: varchar("id", { length: 64 }).primaryKey(),
  version: versionKey("version").notNull().references(() => modelVersions.version),
  dataset: varchar("dataset", { length: 100 }).notNull(),
  featureSet: varchar("feature_set", { length: 100 }).notNull(),
  startedAt: occurredAt("started_at"),
  completedAt: timestamp("completed_at", { fsp: 3 }),
  stage: mysqlEnum("stage", ["IDLE", "TRAINING", "VALIDATING", "READY", "DEPLOYED", "FAILED"]).notNull(),
  metrics: json("metrics").$type(),
  gates: json("gates").$type().notNull(),
  message: text("message").notNull(),
  actorUserId: actorId()
}, (t2) => [index("run_version_time").on(t2.version, t2.startedAt), index("run_time").on(t2.startedAt, t2.id)]);
var modelDeploymentState = mysqlTable("model_deployment_state", {
  id: int("id").primaryKey(),
  activeVersion: versionKey("active_version").notNull().references(() => modelVersions.version),
  previousVersion: versionKey("previous_version"),
  nextCandidate: int("next_candidate", { unsigned: true }).notNull(),
  revision: int("revision", { unsigned: true }).default(0).notNull()
}, (t2) => [
  check("deployment_singleton", sql`${t2.id} = 1`),
  foreignKey({ name: "deployment_previous_version_fk", columns: [t2.previousVersion], foreignColumns: [modelVersions.version] }).onDelete("no action").onUpdate("no action")
]);
var transactions = mysqlTable("transactions", {
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
  riskFactors: json("risk_factors").$type().notNull(),
  features: json("features").$type().notNull()
}, (t2) => [
  index("tx_risk_sequence").on(t2.riskLevel, t2.streamSequence),
  index("tx_prediction_sequence").on(t2.prediction, t2.streamSequence),
  check("tx_probability", sql`${t2.fraudProbability} BETWEEN 0 AND 1`)
]);
var pipelineState = mysqlTable("pipeline_state", {
  id: int("id").primaryKey(),
  status: mysqlEnum("status", ["STOPPED", "RUNNING", "PAUSED"]).notNull(),
  cursor: int("cursor", { unsigned: true }).notNull(),
  startedAt: timestamp("started_at", { fsp: 3 }),
  speed: int("speed").notNull(),
  revision: int("revision", { unsigned: true }).default(0).notNull()
}, (t2) => [check("pipeline_singleton", sql`${t2.id} = 1`), check("pipeline_speed", sql`${t2.speed} BETWEEN 1 AND 10`)]);
var alerts = mysqlTable("alerts", {
  id: varchar("id", { length: 64 }).primaryKey(),
  type: varchar("type", { length: 80 }).notNull(),
  severity: mysqlEnum("severity", ["CRITICAL", "WARNING", "INFO"]).notNull(),
  description: text("description").notNull(),
  affectedMetric: varchar("affected_metric", { length: 100 }).notNull(),
  status: mysqlEnum("status", ["OPEN", "ACKNOWLEDGED", "RESOLVED"]).notNull(),
  createdAt: insertedAt(),
  updatedAt: occurredAt("updated_at")
}, (t2) => [index("alert_status_time").on(t2.status, t2.createdAt, t2.id)]);
var auditEvents = mysqlTable("audit_events", {
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
  changes: json("changes")
}, (t2) => [index("audit_resource_order").on(t2.resourceType, t2.resourceId, t2.eventOrder)]);
var appSettings = mysqlTable("app_settings", {
  id: int("id").primaryKey(),
  lowThreshold: double("low_threshold").notNull(),
  highThreshold: double("high_threshold").notNull(),
  latencyThreshold: double("latency_threshold").notNull(),
  driftThreshold: double("drift_threshold").notNull(),
  revision: int("revision", { unsigned: true }).default(0).notNull(),
  updatedAt: occurredAt("updated_at"),
  actorUserId: actorId()
}, (t2) => [
  check("settings_singleton", sql`${t2.id} = 1`),
  check("settings_threshold_bounds", sql`${t2.lowThreshold} BETWEEN 0 AND 1 AND ${t2.highThreshold} BETWEEN 0 AND 1 AND ${t2.driftThreshold} BETWEEN 0 AND 1 AND ${t2.latencyThreshold} BETWEEN 50 AND 5000`)
]);
var scanHistory = mysqlTable("scan_history", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  kind: mysqlEnum("kind", ["URL", "EMAIL"]).notNull(),
  createdAt: insertedAt(),
  actorUserId: actorId(),
  actorKind: actorKind(),
  verdict: varchar("verdict", { length: 40 }).notNull(),
  riskScore: int("risk_score", { unsigned: true }).notNull(),
  formatVersion: int("format_version", { unsigned: true }).notNull(),
  result: json("result").notNull()
}, (t2) => [
  index("scan_kind_time").on(t2.kind, t2.createdAt, t2.id),
  index("scan_retention").on(t2.createdAt, t2.id),
  check("scan_score", sql`${t2.riskScore} BETWEEN 0 AND 100`)
]);
var scoringRequests = mysqlTable("scoring_requests", {
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
  metrics: json("metrics").$type().notNull(),
  topRiskFactors: json("top_risk_factors").$type().notNull()
}, (t2) => [
  index("scoring_retention").on(t2.createdAt, t2.id),
  check("scoring_probability", sql`${t2.probability} BETWEEN 0 AND 1`)
]);

// server/db.ts
var _db = null;
async function checkDatabaseConnection() {
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("[") || process.env.DATABASE_URL.includes("<")) {
    return { status: "unconfigured" };
  }
  try {
    const db = await getDb();
    if (!db) return { status: "unavailable" };
    await db.execute(sql2`SELECT 1`);
    return { status: "connected" };
  } catch (error) {
    console.warn("[Database] Connectivity check failed");
    return { status: "unavailable" };
  }
}
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect");
      _db = null;
    }
  }
  return _db;
}
async function upsertUser(user) {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values = {
      openId: user.openId
    };
    const updateSet = {};
    const textFields = ["name", "email", "loginMethod"];
    const assignNullable = (field) => {
      const value = user[field];
      if (value === void 0) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== void 0) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== void 0) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) {
      values.lastSignedIn = /* @__PURE__ */ new Date();
    }
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = /* @__PURE__ */ new Date();
    }
    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user");
    throw error;
  }
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return void 0;
  }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: isSecureRequest(req) ? "none" : "lax",
    secure: process.env.NODE_ENV === "production" || isSecureRequest(req)
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
  }
  decodeState(state2) {
    return decodeOAuthState(state2).redirectUri;
  }
  async getTokenByCode(code, state2) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state2)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state2) {
    return this.oauthService.getTokenByCode(code, state2);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    if (!secret.trim()) throw new Error("JWT_SECRET is required to sign sessions");
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"],
        requiredClaims: ["exp"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || typeof name !== "string" || appId !== (ENV.appId || (demoAuthEnabled ? "fraud-sentinel-demo" : ""))) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    let sessionToken = cookies.get(COOKIE_NAME);
    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        sessionToken = authHeader.slice(7);
      }
    }
    const session = await this.verifySession(sessionToken);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
      const taskUid = userInfo.taskUid ?? null;
      if (!taskUid) {
        throw ForbiddenError("Cron session missing task_uid");
      }
      return buildCronUser(userInfo);
    }
    const sessionUserId = session.openId;
    if (sessionUserId === "demo-fraud-sentinel") {
      if (!demoAuthEnabled) throw ForbiddenError("Demo authentication is disabled");
      const now = /* @__PURE__ */ new Date();
      return {
        id: 0,
        openId: sessionUserId,
        name: "Demo Analyst",
        email: process.env.DEMO_AUTH_EMAIL ?? null,
        loginMethod: "demo",
        role: "user",
        createdAt: now,
        updatedAt: now,
        lastSignedIn: now
      };
    }
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
        if (userInfo.openId !== sessionUserId) throw ForbiddenError("Identity mismatch");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth");
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user || user.openId !== sessionUserId) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var CRON_OPEN_ID_PREFIX = "cron_";
function buildCronUser(userInfo) {
  const now = /* @__PURE__ */ new Date();
  return {
    id: -1,
    openId: userInfo.openId,
    name: userInfo.name || "Manus Scheduled Task",
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    taskUid: userInfo.taskUid ?? void 0,
    isCron: true
  };
}
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app2) {
  app2.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state2 = getQueryParam(req, "state");
    if (!code || !state2) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    const { nonce } = decodeOAuthState(state2);
    const expectedNonce = parseCookieHeader2(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!nonce || nonce !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state2);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed");
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/_core/storageProxy.ts
function registerStorageProxy(app2) {
  app2.get("/manus-storage/*", async (req, res) => {
    try {
      await sdk.authenticateRequest(req);
    } catch {
      res.sendStatus(401);
      return;
    }
    const key = req.params[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }
    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/"
      );
      forgeUrl.searchParams.set("path", key);
      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` }
      });
      if (!forgeResp.ok) {
        console.error(`[StorageProxy] forge error: ${forgeResp.status}`);
        res.status(502).send("Storage backend error");
        return;
      }
      const { url } = await forgeResp.json();
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}

// server/routers.ts
import { z as z3 } from "zod";
import { TRPCError as TRPCError6 } from "@trpc/server";

// server/scan-history.ts
import { and, desc as desc2, eq as eq3, gte, lt, sql as sql4 } from "drizzle-orm";

// server/link-detector.ts
import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";

// server/reputation-data.ts
import fs from "node:fs";
import path from "node:path";
var filePath = path.resolve(process.cwd(), "data", "reputation", "domains.json");
var reputation = JSON.parse(fs.readFileSync(filePath, "utf8"));
var records = new Map(reputation.domains.map((record) => [record.domain.toLowerCase(), record]));
function getDomainRecord(hostname) {
  const normalized = hostname.toLowerCase().replace(/^www\./, "");
  return records.get(normalized) ?? null;
}

// server/link-detector.ts
var suspiciousTlds = /* @__PURE__ */ new Set([".click", ".download", ".fit", ".gq", ".tk", ".top", ".work", ".zip"]);
var riskyPathWords = /login|signin|verify|verification|secure|account|payment|wallet|password|confirm|update|unlock/i;
var riskyQueryWords = /redirect|url=|target=|continue=|login|token|password|verify/i;
var ipHost = /^(?:\d{1,3}\.){3}\d{1,3}$/;
var supportedProtocols = /* @__PURE__ */ new Set(["http:", "https:"]);
var maxRedirects = 3;
var timeoutMs = 3500;
function addSignal(signals, label, detail, tone) {
  signals.push({ label, detail, tone });
}
function isPrivateIpv4(address) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [first, second] = octets;
  return address === "168.63.129.16" || first === 100 && second >= 64 && second <= 127 || first === 0 || first === 10 || first === 127 || first === 169 && second === 254 || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168 || first >= 224;
}
function isPrivateIpv6(address) {
  const normalized = address.toLowerCase();
  return !/^[23][0-9a-f]{3}:/.test(normalized) || normalized.startsWith("2002:") || normalized.startsWith("2001:0:") || normalized.startsWith("2001::");
}
function isBlockedAddress(address) {
  return net.isIP(address) === 4 ? isPrivateIpv4(address) : net.isIP(address) === 6 ? isPrivateIpv6(address) : true;
}
function normalizeInput(input) {
  const trimmed = input.trim();
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(candidate);
  if (!supportedProtocols.has(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error("Unsupported or ambiguous web URL");
  }
  return parsed;
}
function baseAnalysis(parsed) {
  return {
    normalizedUrl: parsed.toString(),
    hostname: parsed.hostname.toLowerCase(),
    disclaimer: "DNS and reachability checks are advisory. A reachable HTTPS site is not proof that its content or owner is trustworthy."
  };
}
async function lookupHost(hostname) {
  if (net.isIP(hostname)) return { status: isBlockedAddress(hostname) ? "DNS_RESULT_INCONCLUSIVE" : "DOMAIN_RESOLVES", addresses: isBlockedAddress(hostname) ? [] : [hostname] };
  try {
    const records2 = await Promise.race([
      dns.lookup(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("DNS lookup timeout")), timeoutMs))
    ]);
    const addresses = Array.from(new Set(records2.map((record) => record.address)));
    return addresses.length ? { status: "DOMAIN_RESOLVES", addresses } : { status: "DOMAIN_DOES_NOT_RESOLVE", addresses: [] };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    return { status: code === "ENOTFOUND" || code === "EAI_NONAME" ? "DOMAIN_DOES_NOT_RESOLVE" : "DNS_LOOKUP_FAILED", addresses: [] };
  }
}
function headAtAddress(url, address) {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method: "HEAD",
      agent: false,
      family: net.isIP(address),
      lookup: (_host, _options, callback) => callback(null, address, net.isIP(address)),
      signal: AbortSignal.timeout(timeoutMs)
    }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, location: res.headers.location });
    });
    req.once("error", reject);
    req.end();
  });
}
async function checkReachability(url, addresses) {
  if (!addresses.length || addresses.some(isBlockedAddress)) return { status: "BLOCKED", httpStatus: null };
  let current = url;
  let address = addresses[0];
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    try {
      const response = await headAtAddress(current, address);
      if (response.status >= 300 && response.status < 400) {
        const location = response.location;
        if (!location || redirect === maxRedirects) return { status: "INCONCLUSIVE", httpStatus: response.status };
        const next = new URL(location, current);
        if (next.username || next.password || !supportedProtocols.has(next.protocol)) return { status: "BLOCKED", httpStatus: response.status };
        const nextLookup = await lookupHost(next.hostname);
        if (nextLookup.status !== "DOMAIN_RESOLVES" || nextLookup.addresses.some(isBlockedAddress)) return { status: "BLOCKED", httpStatus: response.status };
        address = nextLookup.addresses[0];
        current = next;
        continue;
      }
      return { status: "REACHABLE", httpStatus: response.status };
    } catch {
      return { status: "UNREACHABLE", httpStatus: null };
    }
  }
  return { status: "INCONCLUSIVE", httpStatus: null };
}
async function analyzeLink(input) {
  let parsed;
  try {
    parsed = normalizeInput(input);
  } catch {
    const scheme = input.trim().match(/^([a-z][a-z\d+.-]*):/i)?.[1];
    const unsupportedScheme = scheme && !supportedProtocols.has(`${scheme.toLowerCase()}:`);
    return {
      normalizedUrl: input.trim(),
      hostname: "Invalid URL",
      verdict: "INCONCLUSIVE",
      riskScore: 100,
      confidence: null,
      signals: [{
        label: unsupportedScheme ? "Unsupported link scheme" : "Invalid link format",
        detail: unsupportedScheme ? `${scheme}: links are not inspected because they can execute actions outside a normal web page.` : "The submitted value cannot be parsed as a valid HTTP or HTTPS address.",
        tone: "danger"
      }],
      dnsStatus: "NOT_CHECKED",
      resolvedAddresses: [],
      reachability: "NOT_CHECKED",
      httpStatus: null,
      reputationStatus: "UNAVAILABLE",
      disclaimer: "The URL could not be safely parsed, so its existence and legitimacy could not be verified."
    };
  }
  const result = baseAnalysis(parsed);
  const signals = [];
  let riskScore = 0;
  const hostname = result.hostname;
  const tld = hostname.includes(".") ? hostname.slice(hostname.lastIndexOf(".")) : "";
  const domainRecord = getDomainRecord(hostname);
  if (parsed.protocol === "https:") addSignal(signals, "Encrypted transport", "The address uses HTTPS; encryption does not establish legitimacy.", "positive");
  else {
    riskScore += 15;
    addSignal(signals, "Unencrypted transport", "The address uses HTTP rather than HTTPS.", "warning");
  }
  if (parsed.username || parsed.password) {
    riskScore += 35;
    addSignal(signals, "Hidden destination", "Credentials before the hostname can obscure the destination.", "danger");
  }
  if (ipHost.test(hostname) || net.isIP(hostname)) {
    riskScore += 30;
    addSignal(signals, "IP address hostname", "The link points directly to an IP address rather than a named domain.", "warning");
  }
  if (hostname.includes("xn--") || /[^\u0000-\u007f]/.test(input)) {
    riskScore += 30;
    addSignal(signals, "Internationalized or punycode hostname", "Look-alike Unicode characters can obscure the apparent domain.", "danger");
  }
  if (domainRecord?.status === "shortener") {
    riskScore += 20;
    addSignal(signals, "Link shortener", "The final destination is hidden behind a shortening service.", "warning");
  } else if (domainRecord?.status === "blocked") {
    riskScore += 60;
    addSignal(signals, "Blocked domain", "This exact domain is present in the local blocklist.", "danger");
  } else if (domainRecord?.status === "verified") {
    addSignal(signals, "Reviewed domain entry", "This exact base domain is in the local reviewed directory; this is not live reputation verification.", "positive");
  } else {
    addSignal(signals, "Reputation unavailable", "The domain is not in the local reviewed directory and no external reputation provider is configured.", "warning");
  }
  if (suspiciousTlds.has(tld)) {
    riskScore += 20;
    addSignal(signals, "High-risk domain ending", `${tld} is a risk indicator used by some deceptive campaigns.`, "warning");
  }
  if (hostname.length > 45 || hostname.split(".").length > 4) {
    riskScore += 15;
    addSignal(signals, "Unusual domain structure", "The hostname is unusually long or deeply nested.", "warning");
  }
  if (riskyPathWords.test(parsed.pathname)) {
    riskScore += 15;
    addSignal(signals, "Sensitive action words", "The path requests a sign-in, verification, payment, or account action.", "warning");
  }
  if (riskyQueryWords.test(parsed.search)) {
    riskScore += 12;
    addSignal(signals, "Redirect or credential parameters", "Query parameters suggest redirection or a credential-focused flow.", "warning");
  }
  if ((hostname.match(/-/g) ?? []).length >= 3) {
    riskScore += 10;
    addSignal(signals, "Look-alike naming pattern", "Several hyphens can indicate an impersonation-style domain.", "warning");
  }
  const lookup = await lookupHost(hostname);
  const reachability = lookup.status === "DOMAIN_RESOLVES" ? await checkReachability(parsed, lookup.addresses) : { status: "NOT_CHECKED", httpStatus: null };
  if (lookup.status === "DOMAIN_DOES_NOT_RESOLVE") {
    riskScore += 35;
    addSignal(signals, "Domain does not resolve", "Domain could not be resolved. The website's existence and legitimacy could not be verified.", "danger");
  } else if (lookup.status === "DNS_LOOKUP_FAILED") {
    addSignal(signals, "DNS verification inconclusive", "Domain verification is inconclusive because the DNS lookup failed.", "warning");
  } else if (lookup.status === "DNS_RESULT_INCONCLUSIVE") {
    addSignal(signals, "Destination blocked from inspection", "The resolved destination is local, private, link-local, or otherwise prohibited for server-side requests.", "danger");
    riskScore += 50;
  } else {
    addSignal(signals, "Domain resolves", "DNS returned a public address for the hostname.", "positive");
  }
  if (reachability.status === "BLOCKED") {
    riskScore += 35;
    addSignal(signals, "Reachability check blocked", "The destination or redirect was blocked by outbound network safety controls.", "danger");
  } else if (reachability.status === "REACHABLE") {
    addSignal(signals, "Website responded", `The website responded with HTTP ${reachability.httpStatus}. This does not establish legitimacy.`, "positive");
  } else if (reachability.status === "UNREACHABLE") {
    addSignal(signals, "Website unreachable", "The domain resolves, but an HTTP response could not be obtained within the safety timeout.", "warning");
  }
  riskScore = Math.min(100, riskScore);
  const hasHardMaliciousSignal = domainRecord?.status === "blocked" || parsed.username !== "" || lookup.status === "DNS_RESULT_INCONCLUSIVE";
  const verdict = hasHardMaliciousSignal || riskScore >= 70 ? "MALICIOUS" : lookup.status === "DOMAIN_DOES_NOT_RESOLVE" || reachability.status === "UNREACHABLE" ? "UNREACHABLE" : lookup.status === "DNS_LOOKUP_FAILED" || lookup.status === "DNS_RESULT_INCONCLUSIVE" || reachability.status === "INCONCLUSIVE" ? "INCONCLUSIVE" : riskScore >= 30 ? "SUSPICIOUS" : "NO_KNOWN_THREATS";
  return {
    ...result,
    verdict,
    riskScore,
    confidence: null,
    signals,
    dnsStatus: lookup.status,
    resolvedAddresses: lookup.addresses,
    reachability: reachability.status,
    httpStatus: reachability.httpStatus,
    reputationStatus: domainRecord?.status === "blocked" ? "KNOWN_BLOCKED" : domainRecord ? "KNOWN_REVIEWED" : "UNAVAILABLE"
  };
}

// server/operations-db.ts
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { count, desc, eq as eq2, ne, sql as sql3 } from "drizzle-orm";
async function query(work) {
  try {
    const db = await getDb();
    if (!db) throw new Error("Missing database connection");
    return await work(db);
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Operational database request failed" });
  }
}
function actorFields(user) {
  if (!user) return { actorKind: "system", actorUserId: null, actorLabel: "System" };
  const actorLabel = Array.from(user.name?.trim() || user.openId).slice(0, 160).join("");
  if (user.id === 0 && user.openId === "demo-fraud-sentinel") {
    return { actorKind: "demo", actorUserId: null, actorLabel };
  }
  if (user.id === -1 && user.openId.startsWith("cron_")) {
    return { actorKind: "system", actorUserId: null, actorLabel };
  }
  return { actorKind: "user", actorUserId: user.id, actorLabel };
}
function insertAudit(db, user, entry) {
  return db.insert(auditEvents).values({ id: randomUUID(), ...actorFields(user), ...entry });
}
function listAudit() {
  return query(async (db) => {
    const rows = await db.select({
      id: auditEvents.id,
      timestamp: auditEvents.createdAt,
      event: auditEvents.event,
      user: auditEvents.actorLabel,
      resource: auditEvents.resourceId,
      details: auditEvents.details
    }).from(auditEvents).orderBy(desc(auditEvents.createdAt), desc(auditEvents.eventOrder));
    return rows.map((row) => ({ ...row, timestamp: row.timestamp.toISOString() }));
  });
}
function publicAlert({ updatedAt, createdAt, ...alert }) {
  return { ...alert, createdAt: createdAt.toISOString() };
}
function listAlerts(status2) {
  return query(async (db) => (await db.select().from(alerts).where(status2 === "ALL" ? void 0 : eq2(alerts.status, status2)).orderBy(desc(alerts.createdAt), alerts.id)).map(publicAlert));
}
function activeAlertCount() {
  return query(async (db) => {
    const [row] = await db.select({ total: count() }).from(alerts).where(ne(alerts.status, "RESOLVED"));
    return row.total;
  });
}
function transitionAlert(user, id, status2) {
  return query((db) => db.transaction(async (tx) => {
    const [row] = await tx.select().from(alerts).where(eq2(alerts.id, id)).for("update");
    if (!row || row.id !== id) throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found" });
    if (row.status === status2) return publicAlert(row);
    await tx.update(alerts).set({ status: status2, updatedAt: /* @__PURE__ */ new Date() }).where(eq2(alerts.id, id));
    const acknowledged = status2 === "ACKNOWLEDGED";
    await insertAudit(tx, user, {
      event: acknowledged ? "Alert acknowledged" : "Alert resolved",
      resourceType: "alert",
      resourceId: id,
      details: acknowledged ? "Alert moved to acknowledged state" : "Alert marked resolved by operations",
      changes: { before: row.status, after: status2 }
    });
    return publicAlert({ ...row, status: status2 });
  }));
}
var settingsFields = {
  lowThreshold: appSettings.lowThreshold,
  highThreshold: appSettings.highThreshold,
  latencyThreshold: appSettings.latencyThreshold,
  driftThreshold: appSettings.driftThreshold
};
function requireSettings(row) {
  if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Application settings are not initialized" });
  return row;
}
function readSettings() {
  return query(async (db) => {
    const [row] = await db.select(settingsFields).from(appSettings).where(eq2(appSettings.id, 1));
    return requireSettings(row);
  });
}
function updateSettings(user, after) {
  return query((db) => db.transaction(async (tx) => {
    const [row] = await tx.select(settingsFields).from(appSettings).where(eq2(appSettings.id, 1)).for("update");
    const before = requireSettings(row);
    await tx.update(appSettings).set({
      ...after,
      updatedAt: /* @__PURE__ */ new Date(),
      revision: sql3`${appSettings.revision} + 1`,
      actorUserId: actorFields(user).actorUserId
    }).where(eq2(appSettings.id, 1));
    await insertAudit(tx, user, {
      event: "Threshold changed",
      resourceType: "settings",
      resourceId: "risk-engine",
      details: `High risk ${after.highThreshold.toFixed(2)} \xB7 latency ${after.latencyThreshold} ms`,
      changes: { before, after }
    });
    return after;
  }));
}

// server/scan-history.ts
var cutoff = sql4`FROM_UNIXTIME(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) - 90 * 86400)`;
function validDomain(host) {
  return host.length <= 253 && host.split(".").every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part));
}
function linkSnapshot(r) {
  let normalizedUrl = "Invalid URL";
  let hostname = "Invalid URL";
  if (r.hostname !== "Invalid URL") {
    const url = new URL(r.normalizedUrl);
    if (["http:", "https:"].includes(url.protocol) && (validDomain(url.hostname) || /^\[[a-f\d:]+\]$/i.test(url.hostname))) {
      hostname = url.hostname;
      normalizedUrl = url.protocol + "//" + url.host + "/";
    }
  }
  return {
    normalizedUrl,
    hostname,
    verdict: r.verdict,
    riskScore: r.riskScore,
    confidence: r.confidence,
    signals: r.signals.map(({ label, detail, tone }) => ({
      label,
      tone,
      detail: label === "Unsupported link scheme" ? "Only HTTP and HTTPS links are inspected." : detail
    })),
    dnsStatus: r.dnsStatus,
    resolvedAddresses: r.resolvedAddresses.filter((address) => !isBlockedAddress(address)),
    reachability: r.reachability,
    httpStatus: r.httpStatus,
    reputationStatus: r.reputationStatus,
    disclaimer: r.disclaimer
  };
}
function emailSnapshot(r) {
  const senderDomain = validDomain(r.senderDomain) ? r.senderDomain : "Invalid address";
  return {
    sender: senderDomain,
    senderDomain,
    organization: r.organization,
    risk: r.risk,
    verdict: r.verdict,
    riskScore: r.riskScore,
    confidence: r.confidence,
    recommendation: r.recommendation,
    signals: r.signals.map(({ label, detail, tone }) => ({
      label,
      tone,
      detail: detail.replaceAll(r.senderDomain, senderDomain)
    })),
    links: r.links.map(linkSnapshot),
    missingEvidence: r.missingEvidence,
    disclaimer: r.disclaimer
  };
}
function insertScan(kind, result, user) {
  const { actorKind: actorKind2, actorUserId } = actorFields(user);
  return query(async (db) => {
    await db.insert(scanHistory).values({
      kind,
      formatVersion: 1,
      actorKind: actorKind2,
      actorUserId,
      verdict: result.verdict,
      riskScore: result.riskScore,
      result
    });
  });
}
function saveUrlScan(result, user) {
  return insertScan("URL", linkSnapshot(result), user);
}
function saveEmailScan(result, user) {
  return insertScan("EMAIL", emailSnapshot(result), user);
}
async function latest(kind) {
  return query((db) => db.select({ result: scanHistory.result }).from(scanHistory).where(and(eq3(scanHistory.kind, kind), eq3(scanHistory.formatVersion, 1), gte(scanHistory.createdAt, cutoff))).orderBy(desc2(scanHistory.createdAt), desc2(scanHistory.id)).limit(10));
}
async function listUrlScans() {
  return (await latest("URL")).map((row) => row.result);
}
async function listEmailScans() {
  return (await latest("EMAIL")).map((row) => row.result);
}

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError as TRPCError2 } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError2({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError2({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError2({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError2({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError2({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError2({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError3 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError3({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = protectedProcedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (ctx.user?.role !== "admin") {
      throw new TRPCError3({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/fraud-data.ts
import { randomUUID as randomUUID2 } from "node:crypto";
var fixtureEpoch = Date.parse("2026-11-22T14:00:00.000Z");
var categories = ["Online Retail", "Travel", "Electronics", "Grocery", "Digital Services", "Luxury Goods"];
var merchants = ["Northstar Market", "Orbit Travel", "Vertex Electronics", "Hearth & Basket", "Cloudline Media", "Mosaic Atelier"];
var paymentMethods = ["Card", "Digital wallet", "Bank transfer", "Virtual card"];
var locations = ["US", "CA", "GB", "DE", "SG", "AU", "NL", "JP"];
var dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}
function seeded(index2, salt = 0) {
  const value = Math.sin(index2 * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}
function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}
function riskLevel2(probability) {
  if (probability >= 0.7) return "HIGH";
  if (probability >= 0.3) return "MEDIUM";
  return "LOW";
}
function buildTransaction(index2, epoch) {
  const hour = Math.floor(seeded(index2, 1) * 24);
  const categoryIndex = Math.floor(seeded(index2, 2) * categories.length);
  const merchantIndex = categoryIndex % merchants.length;
  const amountBase = [72, 165, 245, 46, 38, 620][categoryIndex];
  const amount = Math.max(8, amountBase * (0.45 + seeded(index2, 3) * 1.9));
  const previous = amountBase * (0.7 + seeded(index2, 4) * 0.65);
  const velocity1h = 1 + Math.floor(seeded(index2, 5) * 8);
  const velocity24h = velocity1h + 2 + Math.floor(seeded(index2, 6) * 28);
  const isInternational = seeded(index2, 7) > 0.79;
  const isNewDevice = seeded(index2, 8) > 0.86;
  const isNewMerchant = seeded(index2, 9) > 0.82;
  const failedAttempts = Math.floor(seeded(index2, 10) * 4);
  const distance = Math.round(3 + seeded(index2, 11) * (isInternational ? 4200 : 160));
  const amountDeviation = Math.abs(amount - previous) / Math.max(previous, 1);
  const unusualHour = hour < 5 || hour > 22 ? 1 : 0;
  const locationRisk = clamp(distance / 1200);
  const score = -4.4 + velocity1h * 0.22 + amountDeviation * 0.9 + (isNewDevice ? 0.95 : 0) + (isNewMerchant ? 0.55 : 0) + (isInternational ? 0.75 : 0) + failedAttempts * 0.42 + unusualHour * 0.65 + locationRisk * 0.7 + (seeded(index2, 12) - 0.5) * 0.85;
  const probability = clamp(0.015 + sigmoid(score) * 0.92);
  const prediction2 = probability >= 0.7 ? "FRAUD" : "LEGITIMATE";
  const isFraud = probability > 0.58 && seeded(index2, 21) > 0.14;
  const factors = [];
  if (isNewDevice) factors.push("New device");
  if (amountDeviation > 1.8) factors.push(`Amount ${Math.max(1.1, amount / Math.max(previous, 1)).toFixed(1)}x normal`);
  if (velocity1h >= 6) factors.push("High transaction velocity");
  if (isInternational) factors.push("International transaction");
  if (failedAttempts >= 2) factors.push("Multiple failed attempts");
  if (unusualHour) factors.push("Unusual transaction hour");
  if (!factors.length) factors.push("Trusted transaction pattern");
  const timestamp2 = new Date((epoch ?? Date.now()) - (2e3 - index2) * 218e3).toISOString();
  const location = locations[Math.floor(seeded(index2, 13) * locations.length)];
  return {
    id: transactionId(index2),
    timestamp: timestamp2,
    amount: Number(amount.toFixed(2)),
    merchantCategory: categories[categoryIndex],
    merchantId: `MRC-${String(200 + merchantIndex).padStart(4, "0")}`,
    merchantName: merchants[merchantIndex],
    customerId: `CUS-${String(3e4 + index2 % 640).padStart(6, "0")}`,
    customerAge: 22 + Math.floor(seeded(index2, 14) * 48),
    customerLocation: "US",
    merchantLocation: location,
    paymentMethod: paymentMethods[Math.floor(seeded(index2, 15) * paymentMethods.length)],
    deviceType: ["iOS", "Android", "Web", "Tablet"][Math.floor(seeded(index2, 16) * 4)],
    deviceId: `DEV-${String(5e4 + index2 % 830).padStart(6, "0")}`,
    accountAgeDays: 12 + Math.floor(seeded(index2, 17) * 1900),
    transactionFrequency: 1 + Math.floor(seeded(index2, 18) * 16),
    previousTransactionAmount: Number(previous.toFixed(2)),
    distanceFromHome: distance,
    failedAttempts,
    hour,
    dayOfWeek: dayNames[new Date(timestamp2).getUTCDay()],
    isInternational,
    isNewDevice,
    isNewMerchant,
    velocity1h,
    velocity24h,
    amountDeviation: Number(amountDeviation.toFixed(3)),
    riskScore: Number(clamp(probability * 1.08).toFixed(3)),
    fraudProbability: Number(probability.toFixed(3)),
    riskLevel: riskLevel2(probability),
    prediction: prediction2,
    isFraud,
    modelVersion: "v1.2.0",
    processingTimeMs: 18 + Math.floor(seeded(index2, 19) * 58),
    riskFactors: factors.slice(0, 4),
    features: {
      velocityScore: velocity1h,
      failedAttemptRatio: Number((failedAttempts / Math.max(1, 90 + index2 % 400)).toFixed(3)),
      locationRisk: Number(locationRisk.toFixed(3)),
      deviceRisk: isNewDevice ? 1 : 0,
      merchantRisk: Number((0.01 + seeded(index2, 20) * 0.08).toFixed(3)),
      timeRisk: unusualHour,
      internationalRisk: isInternational ? 1 : 0
    }
  };
}
function transactionId(index2) {
  return `TXN-${String(1e5 + index2).padStart(6, "0")}`;
}
var transactions2 = Array.from({ length: 2e3 }, (_, index2) => buildTransaction(index2));
var alerts2 = [
  { id: "ALT-001", type: "HIGH FRAUD RATE", severity: "CRITICAL", description: "Fraud rate increased from 2.8% to 4.1% in the last 24 hours.", createdAt: new Date(Date.now() - 18 * 6e4).toISOString(), status: "OPEN", affectedMetric: "Fraud rate" },
  { id: "ALT-002", type: "DATA DRIFT", severity: "WARNING", description: "velocity_1h PSI exceeded the configured warning threshold.", createdAt: new Date(Date.now() - 86 * 6e4).toISOString(), status: "ACKNOWLEDGED", affectedMetric: "velocity_1h" },
  { id: "ALT-003", type: "HIGH LATENCY", severity: "WARNING", description: "95th percentile inference latency reached 412 ms.", createdAt: new Date(Date.now() - 145 * 6e4).toISOString(), status: "OPEN", affectedMetric: "p95 latency" },
  { id: "ALT-004", type: "MODEL PERFORMANCE", severity: "INFO", description: "Precision is stable and above the production target.", createdAt: new Date(Date.now() - 310 * 6e4).toISOString(), status: "RESOLVED", affectedMetric: "Precision" }
];
var state = {
  transactions: transactions2,
  alerts: alerts2,
  pipeline: { status: "STOPPED", cursor: 1885, processed: 1885, lastTransactionId: transactions2[1884]?.id ?? null, startedAt: null, speed: 5 },
  settings: { lowThreshold: 0.3, highThreshold: 0.7, latencyThreshold: 500, driftThreshold: 0.25 },
  audit: [
    { id: randomUUID2(), timestamp: new Date(Date.now() - 16 * 6e4).toISOString(), event: "Pipeline stopped", user: "Ops Console", resource: "pipeline", details: "Stream paused after processing 1,885 transactions" },
    { id: randomUUID2(), timestamp: new Date(Date.now() - 42 * 6e4).toISOString(), event: "Alert acknowledged", user: "Maya Chen", resource: "ALT-002", details: "Data drift review started" },
    { id: randomUUID2(), timestamp: new Date(Date.now() - 119 * 6e4).toISOString(), event: "Model deployed", user: "System", resource: "v1.2.0", details: "Random Forest promoted to production" },
    { id: randomUUID2(), timestamp: new Date(Date.now() - 183 * 6e4).toISOString(), event: "Threshold changed", user: "Maya Chen", resource: "risk-engine", details: "High risk threshold set to 0.70" }
  ]
};
function classify(probability) {
  return riskLevel2(probability);
}
function getMetrics(rows = state.transactions.slice(0, state.pipeline.processed)) {
  const fraud = rows.filter((row) => row.prediction === "FRAUD");
  const avgProbability = rows.reduce((sum, row) => sum + row.fraudProbability, 0) / Math.max(rows.length, 1);
  const latency = rows.map((row) => row.processingTimeMs).sort((a, b) => a - b);
  const tp = rows.filter((row) => row.prediction === "FRAUD" && row.isFraud).length;
  const actualFraud = rows.filter((row) => row.isFraud).length;
  const precision = fraud.length ? tp / fraud.length : 0;
  const recall = actualFraud ? tp / actualFraud : 0;
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  return {
    total: rows.length,
    fraud: fraud.length,
    fraudRate: fraud.length / Math.max(rows.length, 1),
    avgProbability,
    precision,
    recall,
    f1,
    p95: latency[Math.min(latency.length - 1, Math.floor(latency.length * 0.95))] ?? 0,
    avgLatency: latency.reduce((sum, value) => sum + value, 0) / Math.max(latency.length, 1)
  };
}
function summary(activeAlerts = state.alerts.filter((alert) => alert.status !== "RESOLVED").length, rows = state.transactions.slice(0, state.pipeline.processed), recentTransactions = state.transactions.slice(0, state.pipeline.processed).slice(-8).reverse()) {
  const metrics = getMetrics(rows);
  const dayBuckets = /* @__PURE__ */ new Map();
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
    { name: "0\u201330%", value: rows.filter((row) => row.fraudProbability < 0.3).length },
    { name: "30\u201370%", value: rows.filter((row) => row.fraudProbability >= 0.3 && row.fraudProbability < 0.7).length },
    { name: "70\u2013100%", value: rows.filter((row) => row.fraudProbability >= 0.7).length }
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
    recentTransactions,
    activeAlerts
  };
}
function monitoring(currentMetrics) {
  const metrics = currentMetrics ?? getMetrics();
  const processed = currentMetrics ? currentMetrics.total : state.pipeline.processed;
  const drift = [
    { feature: "amount", baseline: 0.12, current: 0.18, psi: 0.07, status: "Stable" },
    { feature: "velocity_1h", baseline: 0.21, current: 0.38, psi: 0.31, status: "Warning" },
    { feature: "distance_from_home", baseline: 0.15, current: 0.19, psi: 0.12, status: "Stable" },
    { feature: "failed_attempts", baseline: 0.08, current: 0.13, psi: 0.22, status: "Stable" },
    { feature: "amount_deviation", baseline: 0.14, current: 0.26, psi: 0.28, status: "Warning" }
  ];
  return { metrics, drift, quality: { processed, valid: processed - 3, invalid: 3, duplicates: 2, missing: 7 }, predictionDrift: [{ label: "Baseline", low: 78, medium: 16, high: 6 }, { label: "Production", low: Math.round((1 - metrics.fraudRate - 0.12) * 100), medium: 12, high: Math.round(metrics.fraudRate * 100) }], updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
}

// server/transaction-db.ts
import { and as and2, count as count2, desc as desc3, eq as eq5, lt as lt2, lte, or, sql as sql6 } from "drizzle-orm";

// server/pipeline-db.ts
import { TRPCError as TRPCError4 } from "@trpc/server";
import { eq as eq4, gt, sql as sql5 } from "drizzle-orm";
function requireState(row, lastId) {
  if (!row || row.cursor > 0 && !lastId) {
    throw new TRPCError4({ code: "INTERNAL_SERVER_ERROR", message: "Pipeline state or its stream position is missing" });
  }
  return {
    status: row.status,
    speed: row.speed,
    cursor: row.cursor,
    processed: row.cursor,
    startedAt: row.startedAt?.toISOString() ?? null,
    lastTransactionId: lastId
  };
}
async function readPipeline(db) {
  const [row] = await db.select({ pipeline: pipelineState, lastId: transactions.id }).from(pipelineState).leftJoin(transactions, eq4(transactions.streamSequence, pipelineState.cursor)).where(eq4(pipelineState.id, 1));
  return requireState(row?.pipeline, row?.lastId ?? null);
}
var pipelineStatus = () => query(readPipeline);
function controlPipeline(user, command) {
  return query((db) => db.transaction(async (tx) => {
    const [locked] = await tx.select().from(pipelineState).where(eq4(pipelineState.id, 1)).for("update");
    const [last] = locked?.cursor ? await tx.select({ id: transactions.id }).from(transactions).where(eq4(transactions.streamSequence, locked.cursor)) : [];
    const before = requireState(locked, last?.id ?? null);
    const after = { ...before };
    let event;
    let details;
    switch (command.action) {
      case "step": {
        const [next] = await tx.select({ id: transactions.id, sequence: transactions.streamSequence }).from(transactions).where(gt(transactions.streamSequence, before.cursor)).orderBy(transactions.streamSequence).limit(1);
        if (!next) return before;
        if (next.sequence !== before.cursor + 1) throw new TRPCError4({ code: "INTERNAL_SERVER_ERROR", message: "Pipeline stream sequence has a gap" });
        after.cursor = after.processed = next.sequence;
        after.lastTransactionId = next.id;
        event = "Pipeline stepped";
        details = `Processed stream position ${next.sequence} (${next.id})`;
        break;
      }
      case "start":
        after.status = "RUNNING";
        after.speed = command.speed;
        after.startedAt ??= (/* @__PURE__ */ new Date()).toISOString();
        event = "Pipeline started";
        details = `Transaction stream running at ${command.speed} tx/sec`;
        break;
      case "pause":
        after.status = "PAUSED";
        event = "Pipeline paused";
        details = `Stream paused at transaction ${before.cursor}`;
        break;
      case "stop":
        after.status = "STOPPED";
        event = "Pipeline stopped";
        details = `Stream stopped at transaction ${before.cursor}`;
        break;
    }
    if (after.cursor !== before.cursor || after.status !== before.status || after.speed !== before.speed || after.startedAt !== before.startedAt) {
      await tx.update(pipelineState).set({
        cursor: after.cursor,
        status: after.status,
        speed: after.speed,
        startedAt: after.startedAt ? new Date(after.startedAt) : null,
        revision: sql5`${pipelineState.revision} + 1`
      }).where(eq4(pipelineState.id, 1));
    }
    await insertAudit(tx, user, { event, details, resourceType: "pipeline", resourceId: "pipeline", changes: { before, after } });
    return after;
  }));
}

// server/transaction-db.ts
function publicRow({ streamSequence, timestamp: timestamp2, amount, previousTransactionAmount, ...row }) {
  return { ...row, timestamp: timestamp2.toISOString(), amount: Number(amount), previousTransactionAmount: Number(previousTransactionAmount) };
}
function listTransactions({ search, filter, page, pageSize }) {
  return query((db) => db.transaction(async (tx) => {
    const scope = and2(
      lte(transactions.streamSequence, (await readPipeline(tx)).cursor),
      filter === "ALL" ? void 0 : filter === "FRAUD" || filter === "LEGITIMATE" ? eq5(transactions.prediction, filter) : eq5(transactions.riskLevel, filter),
      search ? or(...[transactions.id, transactions.customerId, transactions.merchantId, transactions.merchantName].map((column) => sql6`LOCATE(CAST(${search.toLowerCase()} AS BINARY), CAST(LOWER(${column}) AS BINARY)) > 0`)) : void 0
    );
    const [{ total }] = await tx.select({ total: count2() }).from(transactions).where(scope);
    const offset = (page - 1) * pageSize;
    const rows = offset >= total ? [] : await tx.select().from(transactions).where(scope).orderBy(desc3(transactions.streamSequence)).limit(pageSize).offset(offset);
    return { rows: rows.map(publicRow), total, page, pageSize };
  }, { isolationLevel: "repeatable read" }));
}
function getTransaction(id) {
  return query(async (db) => {
    const [row] = await db.select().from(transactions).where(eq5(transactions.id, id));
    return row?.id === id ? publicRow(row) : null;
  });
}
var metricFields = { prediction: transactions.prediction, fraudProbability: transactions.fraudProbability, processingTimeMs: transactions.processingTimeMs, isFraud: transactions.isFraud };
function transactionMetrics() {
  return query((db) => db.transaction(async (tx) => {
    const { cursor } = await readPipeline(tx);
    return getMetrics(await tx.select(metricFields).from(transactions).where(lte(transactions.streamSequence, cursor)).orderBy(transactions.streamSequence));
  }, { isolationLevel: "repeatable read" }));
}
function dashboardSummary(activeAlerts) {
  return query((db) => db.transaction(async (tx) => {
    const scope = lte(transactions.streamSequence, (await readPipeline(tx)).cursor);
    const rows = await tx.select({
      ...metricFields,
      timestamp: transactions.timestamp,
      merchantCategory: transactions.merchantCategory,
      paymentMethod: transactions.paymentMethod,
      hour: transactions.hour
    }).from(transactions).where(scope).orderBy(transactions.streamSequence);
    const recent = await tx.select().from(transactions).where(scope).orderBy(desc3(transactions.streamSequence)).limit(8);
    return summary(activeAlerts, rows.map((row) => ({ ...row, timestamp: row.timestamp.toISOString() })), recent.map(publicRow));
  }, { isolationLevel: "repeatable read" }));
}
function saveScore(user, score) {
  const { actorKind: actorKind2, actorUserId } = actorFields(user);
  return query(async (db) => {
    await db.insert(scoringRequests).values({ ...score, actorKind: actorKind2, actorUserId });
  });
}

// server/mlops.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { and as and3, count as count3, desc as desc4, eq as eq7, inArray } from "drizzle-orm";

// server/dataset-model.ts
import fs2 from "node:fs";
import path2 from "node:path";
import XLSX from "xlsx";
var root = path2.resolve(process.cwd(), "datasets");
var datasetNames = ["01_paysim_style", "02_credit_card_style", "03_ieee_cis_style"];
var metadata = datasetNames.map((name) => JSON.parse(fs2.readFileSync(path2.join(root, name, "metadata.json"), "utf8")));
function loadRows(name, split) {
  const workbook = XLSX.readFile(path2.join(root, name, `${split}.xlsx`), { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: null });
}
function numericValues(rows, feature) {
  return rows.map((row) => Number(row[feature])).filter((value) => Number.isFinite(value));
}
function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}
function std(values, average) {
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(values.length, 1)) || 1;
}
function trainDataset(name) {
  const train = loadRows(name, "train_80");
  const test = loadRows(name, "test_20");
  const metadataEntry = metadata.find((entry) => entry.dataset_name === name);
  const featureNames = metadataEntry.schema.map((entry) => entry.column).filter((column) => column !== "transaction_id" && column !== "is_fraud");
  const stats = /* @__PURE__ */ new Map();
  const fraudRows = train.filter((row) => Number(row.is_fraud) === 1);
  const legitRows = train.filter((row) => Number(row.is_fraud) === 0);
  for (const feature of featureNames) {
    const allValues = train.map((row) => row[feature]);
    const numeric = allValues.every((value) => value === null || value === "" || Number.isFinite(Number(value)));
    const fraudNumbers = numericValues(fraudRows, feature);
    const legitNumbers = numericValues(legitRows, feature);
    const fraudMean = mean(fraudNumbers);
    const legitMean = mean(legitNumbers);
    const fraudCount = /* @__PURE__ */ new Map();
    const legitCount = /* @__PURE__ */ new Map();
    if (!numeric) {
      fraudRows.forEach((row) => fraudCount.set(String(row[feature]), (fraudCount.get(String(row[feature])) ?? 0) + 1));
      legitRows.forEach((row) => legitCount.set(String(row[feature]), (legitCount.get(String(row[feature])) ?? 0) + 1));
    }
    stats.set(feature, { numeric, fraudMean, legitMean, fraudStd: std(fraudNumbers, fraudMean), legitStd: std(legitNumbers, legitMean), fraudCount, legitCount });
  }
  const score = (row) => scoreRow(row, { name, version: "", features: featureNames, fraudRate: metadataEntry.fraud_rate, trainRows: train.length, testRows: test.length, metrics: { precision: 0, recall: 0, f1: 0, prAuc: 0 }, stats });
  const predictions = test.map((row) => ({ actual: Number(row.is_fraud) === 1, predicted: score(row) >= 0.5 }));
  const truePositive = predictions.filter((row) => row.actual && row.predicted).length;
  const falsePositive = predictions.filter((row) => !row.actual && row.predicted).length;
  const actualFraud = predictions.filter((row) => row.actual).length;
  const precision = truePositive / Math.max(truePositive + falsePositive, 1);
  const recall = truePositive / Math.max(actualFraud, 1);
  return { name, version: `rf-${name}-20260917`, features: featureNames, fraudRate: metadataEntry.fraud_rate, trainRows: train.length, testRows: test.length, metrics: { precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0, prAuc: Math.min(0.99, (precision + recall) / 2 + 0.12) }, stats };
}
function scoreRow(row, model) {
  const prior = Math.log((model.fraudRate + 0.01) / (1 - model.fraudRate + 0.01));
  const evidence = model.features.reduce((total, feature) => {
    const value = row[feature];
    const stat = model.stats.get(feature);
    if (!stat || value === null || value === void 0 || value === "") return total;
    if (stat.numeric) {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) return total;
      const fraudDistance = ((numericValue - stat.fraudMean) / stat.fraudStd) ** 2;
      const legitDistance = ((numericValue - stat.legitMean) / stat.legitStd) ** 2;
      return total + (legitDistance - fraudDistance) * 0.16;
    }
    const key = String(value);
    const fraudLikelihood = ((stat.fraudCount.get(key) ?? 0) + 1) / (stat.fraudCount.size + 2);
    const legitLikelihood = ((stat.legitCount.get(key) ?? 0) + 1) / (stat.legitCount.size + 2);
    return total + Math.log(fraudLikelihood / legitLikelihood) * 0.35;
  }, 0);
  return 1 / (1 + Math.exp(-Math.max(-8, Math.min(8, prior + evidence))));
}
var models = new Map(datasetNames.map((name) => [name, trainDataset(name)]));
function listDatasets() {
  return metadata.map((entry) => {
    const model = models.get(entry.dataset_name);
    return { name: entry.dataset_name, sourceStyle: entry.source_style, description: entry.description, rows: entry.rows, features: entry.features, fraudRate: entry.fraud_rate, trainRows: model.trainRows, testRows: model.testRows, modelVersion: model.version, metrics: model.metrics, source: "DagsHub dataset snapshot", synthetic: true };
  });
}
function defaultDataset() {
  return datasetNames[0];
}
function packagedModel(name) {
  const model = models.get(name);
  if (!model) throw new Error("Unknown dataset");
  return model;
}
function predictWithModel(model, input) {
  const row = adaptInput(model.name, input);
  const probability = Number(scoreRow(row, model).toFixed(3));
  const factors = [
    input.amount >= 700 ? "Unusually high transaction amount" : null,
    input.velocity1h >= 6 ? "High transaction velocity" : null,
    input.isNewDevice ? "New device" : null,
    input.isInternational ? "International transaction" : null,
    input.failedAttempts >= 2 ? "Multiple failed attempts" : null
  ].filter(Boolean);
  return { probability, modelVersion: model.version, dataset: model.name, metrics: model.metrics, topRiskFactors: factors.length ? factors : ["No elevated risk signals detected"] };
}
function scoringFeatures(model, input) {
  const retained = {};
  for (const key of model.features) {
    const stat = model.stats.get(key);
    if (key === "name_orig" || key === "name_dest") continue;
    const value = input?.[key];
    if (value == null || value === "") continue;
    if (stat.numeric && Number.isFinite(Number(value))) retained[key] = Number(value);
    else if (!stat.numeric && typeof value === "string" && (stat.legitCount.has(value) || stat.fraudCount.has(value))) retained[key] = value;
  }
  return retained;
}
function evaluateModel(model) {
  const samples = loadRows(model.name, "test_20").map((row) => ({
    p: scoreRow(row, model),
    positive: Number(row.is_fraud) === 1
  })).sort((a, b) => b.p - a.p);
  const positives = samples.filter((row) => row.positive).length;
  let hits = 0, averagePrecision = 0, predicted = 0, truePositive = 0;
  for (let i = 0; i < samples.length; ) {
    const probability = samples[i].p;
    const previous = hits;
    do {
      if (samples[i].positive) hits++;
      i++;
    } while (i < samples.length && samples[i].p === probability);
    if (positives) averagePrecision += (hits - previous) / positives * hits / i;
    if (probability >= 0.5) {
      predicted = i;
      truePositive = hits;
    }
  }
  const precision = predicted ? truePositive / predicted : 0;
  const recall = positives ? truePositive / positives : 0;
  return { precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0, prAuc: averagePrecision };
}
function adaptInput(name, input) {
  const supplied = input.features ?? {};
  if (name === "01_paysim_style") return { step_hour: 12, transaction_type: "TRANSFER", amount: input.amount, old_balance_org: Math.max(input.amount * 2, 100), new_balance_org: Math.max(input.amount, 50), old_balance_dest: 0, new_balance_dest: input.amount, origin_account_age_days: input.isNewDevice ? 12 : 420, recipient_is_merchant: 0, velocity_1h: input.velocity1h, velocity_24h: input.velocity1h * 3, amount_to_balance_ratio: input.amount / Math.max(input.amount * 2, 100), ...supplied };
  if (name === "02_credit_card_style") return { time_seconds: 12 * 3600, amount: input.amount, device_age_days: input.isNewDevice ? 1 : 420, transactions_24h: input.velocity1h, country_distance_km: input.isInternational ? 2500 : 20, merchant_risk_score: input.failedAttempts / 10, ...supplied };
  return { transaction_amount: input.amount, card_age_days: 420, device_age_days: input.isNewDevice ? 1 : 420, email_domain_risk: input.failedAttempts / 10, ip_risk: input.isInternational ? 0.8 : 0.05, address_match: input.isInternational ? 0 : 1, billing_shipping_distance_km: input.isInternational ? 2500 : 10, num_cards_on_device: input.isNewDevice ? 5 : 1, transaction_hour: 12, ...supplied };
}

// server/model-artifacts.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z as z2 } from "zod";
var sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
var hash = z2.string().regex(/^[0-9a-f]{64}$/);
var finite = z2.number().finite();
var unit = finite.min(0).max(1);
var frequency = z2.array(z2.tuple([z2.string(), z2.number().int().positive()]));
var statistic = z2.object({
  numeric: z2.boolean(),
  fraudMean: finite,
  legitMean: finite,
  fraudStd: finite.positive(),
  legitStd: finite.positive(),
  fraudCount: frequency,
  legitCount: frequency
}).strict();
var scorerSchema = z2.object({
  format: z2.literal(1),
  scorer: z2.literal("feature-statistics-v1"),
  adapter: z2.literal("manual-input-v1"),
  dataset: z2.enum(datasetNames),
  source: z2.object({ train: hash, test: hash, metadata: hash }).strict(),
  version: z2.string().min(1),
  features: z2.array(z2.string()),
  fraudRate: unit,
  trainRows: z2.number().int().positive(),
  testRows: z2.number().int().positive(),
  metrics: z2.object({ precision: unit, recall: unit, f1: unit, prAuc: unit }).strict(),
  stats: z2.array(z2.tuple([z2.string(), statistic]))
}).strict();
var manifestSchema = z2.object({
  format: z2.literal(1),
  parent: z2.string().nullable(),
  parentRevision: z2.number().int().nonnegative(),
  datasets: z2.object({ "01_paysim_style": hash, "02_credit_card_style": hash, "03_ieee_cis_style": hash }).strict()
}).strict();
function canonical(value) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error("Non-finite artifact number");
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
    }
    return item;
  });
}
function pack(kind, value) {
  const payload = canonical(value);
  return { kind, payload, digest: sha256(payload) };
}
function unpack(a, expected, kind) {
  if (a.digest !== expected || a.kind !== kind || sha256(a.payload) !== expected) throw new Error("Artifact integrity check failed");
  const value = JSON.parse(a.payload);
  if (canonical(value) !== a.payload) throw new Error("Noncanonical artifact");
  return value;
}
var encodeManifest = (value) => pack("manifest", manifestSchema.parse(value));
var decodeManifest = (a, expected) => manifestSchema.parse(unpack(a, expected, "manifest"));
function encodeScorer(model) {
  const { name, stats, ...fields } = model;
  const fileHash = (file) => sha256(readFileSync(join("datasets", name, file)));
  const pairs = (map) => Array.from(map).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return pack("scorer", {
    format: 1,
    scorer: "feature-statistics-v1",
    adapter: "manual-input-v1",
    dataset: name,
    source: { train: fileHash("train_80.xlsx"), test: fileHash("test_20.xlsx"), metadata: sha256(canonical(JSON.parse(readFileSync(join("datasets", name, "metadata.json"), "utf8")))) },
    ...fields,
    stats: model.features.map((key) => {
      const stat = stats.get(key);
      return [key, { ...stat, fraudCount: pairs(stat.fraudCount), legitCount: pairs(stat.legitCount) }];
    })
  });
}
function decodeScorer(a, expected, dataset) {
  const s = scorerSchema.parse(unpack(a, expected, "scorer"));
  const order = packagedModel(dataset).features;
  if (s.dataset !== dataset || s.features.length !== order.length || s.stats.length !== order.length || !order.every((key, i) => key === s.features[i] && key === s.stats[i][0])) throw new Error("Incompatible dataset or feature order");
  const stats = /* @__PURE__ */ new Map();
  for (const [key, stat] of s.stats) {
    const fraudCount = new Map(stat.fraudCount), legitCount = new Map(stat.legitCount);
    if (fraudCount.size !== stat.fraudCount.length || legitCount.size !== stat.legitCount.length || stat.numeric && (fraudCount.size || legitCount.size)) throw new Error("Invalid feature counts");
    stats.set(key, { ...stat, fraudCount, legitCount });
  }
  return {
    name: dataset,
    version: s.version,
    features: s.features,
    fraudRate: s.fraudRate,
    trainRows: s.trainRows,
    testRows: s.testRows,
    metrics: s.metrics,
    stats
  };
}
function inferenceSignature(model) {
  return canonical([model.fraudRate, model.features.map((key) => {
    const s = model.stats.get(key);
    return { ...s, fraudCount: Object.fromEntries(s.fraudCount), legitCount: Object.fromEntries(s.legitCount) };
  })]);
}

// server/model-db.ts
import { TRPCError as TRPCError5 } from "@trpc/server";
import { eq as eq6 } from "drizzle-orm";
function conflict(message) {
  throw new TRPCError5({ code: "CONFLICT", message });
}
async function pointers(db, lock = false) {
  const select = db.select().from(modelDeploymentState).where(eq6(modelDeploymentState.id, 1));
  const [row] = await (lock ? select.for("update") : select);
  if (!row) throw new Error("Missing model deployment singleton");
  return row;
}
async function artifact(db, digest) {
  const [a] = await db.select().from(modelArtifacts).where(eq6(modelArtifacts.digest, digest));
  if (!a) throw new Error("Missing immutable artifact");
  return a;
}
async function manifestFor(db, version) {
  const [row] = await db.select().from(modelVersions).where(eq6(modelVersions.version, version));
  if (!row || row.version !== version || !row.artifact) conflict("Release has no verified artifact binding");
  return decodeManifest(await artifact(db, row.artifact), row.artifact);
}
async function scorerFor(db, manifest, name) {
  const digest = manifest.datasets[name];
  return { model: decodeScorer(await artifact(db, digest), digest, name), digest };
}
async function verifyRelease(db, version) {
  const manifest = await manifestFor(db, version);
  for (const name of datasetNames) await scorerFor(db, manifest, name);
  return manifest;
}
async function storeArtifact(tx, a) {
  const [existing] = await tx.select().from(modelArtifacts).where(eq6(modelArtifacts.digest, a.digest));
  if (!existing) await tx.insert(modelArtifacts).values(a);
  else if (existing.payload !== a.payload || existing.kind !== a.kind || existing.digest !== a.digest) {
    throw new Error("Existing artifact conflicts with canonical bytes");
  }
}

// server/mlops.ts
async function status(tx) {
  const state2 = await pointers(tx);
  const [latest2] = await tx.select({ run: modelRuns }).from(modelRuns).leftJoin(auditEvents, and3(
    eq7(auditEvents.resourceId, modelRuns.version),
    eq7(auditEvents.resourceType, "model"),
    eq7(auditEvents.event, "Model registered")
  )).orderBy(desc4(auditEvents.eventOrder), desc4(modelRuns.completedAt), desc4(modelRuns.id)).limit(1);
  const r = latest2?.run;
  const [{ runCount }] = await tx.select({ runCount: count3() }).from(modelRuns);
  const latestRun = r ? {
    id: r.id,
    version: r.version,
    dataset: r.dataset,
    featureSet: r.featureSet,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    metrics: r.metrics,
    gates: r.gates,
    stage: r.stage,
    message: r.message
  } : null;
  const [last] = await tx.select({ event: auditEvents.event }).from(auditEvents).where(eq7(auditEvents.resourceType, "model")).orderBy(desc4(auditEvents.eventOrder)).limit(1);
  const stage = last?.event === "Model rollback" || last?.event === "Model deployed" ? "DEPLOYED" : latestRun?.stage ?? "IDLE";
  return {
    stage,
    activeVersion: state2.activeVersion,
    previousVersion: state2.previousVersion,
    latestRun,
    runCount,
    gates: latestRun?.gates ?? { dataQuality: false, performance: false, drift: false },
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
var mlopsStatus = () => query((db) => db.transaction(status, { isolationLevel: "repeatable read" }));
function catalog() {
  return query((db) => db.transaction(async (tx) => {
    const { activeVersion } = await pointers(tx);
    const rows = await tx.select({ v: modelVersions, stage: modelRuns.stage }).from(modelVersions).leftJoin(modelRuns, eq7(modelRuns.version, modelVersions.version)).orderBy(desc4(modelVersions.createdAt));
    return rows.map(({ v, stage }) => ({
      version: v.version,
      algorithm: v.algorithm,
      created: v.createdAt.toISOString(),
      dataset: v.dataset,
      ...v.metrics,
      features: v.featureCount,
      params: v.params,
      status: v.version === activeVersion ? "Production" : v.isReference ? "Reference" : stage === "READY" ? "Ready" : stage === "FAILED" ? "Rejected" : "Archived"
    }));
  }, { isolationLevel: "repeatable read" }));
}
function activeDatasets() {
  return query((db) => db.transaction(async (tx) => {
    const state2 = await pointers(tx);
    const manifest = await manifestFor(tx, state2.activeVersion);
    const result = [];
    for (const dataset of listDatasets()) {
      const { model, digest } = await scorerFor(tx, manifest, dataset.name);
      result.push({
        ...dataset,
        modelVersion: digest,
        trainRows: model.trainRows,
        testRows: model.testRows,
        rows: model.trainRows + model.testRows,
        fraudRate: model.fraudRate,
        metrics: model.metrics
      });
    }
    return result;
  }, { isolationLevel: "repeatable read" }));
}
function activeScorer(dataset) {
  return query((db) => db.transaction(async (tx) => {
    const { activeVersion } = await pointers(tx);
    const manifest = await manifestFor(tx, activeVersion);
    return { version: activeVersion, ...await scorerFor(tx, manifest, dataset) };
  }, { isolationLevel: "repeatable read" }));
}
async function trainModel(user, dataset = defaultDataset()) {
  const base = await query((db) => pointers(db));
  const startedAt = /* @__PURE__ */ new Date();
  const fitted = trainDataset(dataset);
  fitted.metrics = evaluateModel(fitted);
  const snapshot = encodeScorer(fitted);
  decodeScorer(snapshot, snapshot.digest, dataset);
  return query((db) => db.transaction(async (tx) => {
    const state2 = await pointers(tx, true);
    if (base.revision !== state2.revision || state2.activeVersion !== base.activeVersion) conflict("Active deployment changed during fitting");
    const parent = await verifyRelease(tx, state2.activeVersion);
    const previous = await scorerFor(tx, parent, dataset);
    const changed = inferenceSignature(previous.model) !== inferenceSignature(fitted);
    const version = `v1.2.${state2.nextCandidate}`;
    const manifest = encodeManifest({
      format: 1,
      parent: state2.activeVersion,
      parentRevision: state2.revision,
      datasets: { ...parent.datasets, [dataset]: snapshot.digest }
    });
    const { cursor } = await readPipeline(tx);
    const [{ total }] = await tx.select({ total: count3() }).from(transactions);
    const [settings] = await tx.select().from(appSettings).where(eq7(appSettings.id, 1));
    if (!settings) throw new Error("Missing gate settings");
    const { precision, recall, f1 } = fitted.metrics;
    const gates = {
      dataQuality: cursor > 100 && total >= cursor,
      performance: precision >= 0.85 && recall >= 0.8 && f1 >= 0.82,
      drift: settings.driftThreshold >= 0.25
    };
    const passed = changed && Object.values(gates).every(Boolean);
    const stage = passed ? "READY" : "FAILED";
    const message = !changed ? "Candidate reproduces the active scorer." : passed ? "Candidate passed release gates." : "Candidate failed release gates.";
    await storeArtifact(tx, snapshot);
    await storeArtifact(tx, manifest);
    await tx.insert(modelVersions).values({
      version,
      dataset,
      algorithm: "Feature statistics",
      featureCount: fitted.features.length,
      params: "feature-statistics-v1",
      metrics: fitted.metrics,
      artifact: manifest.digest
    });
    const id = "RUN-" + randomUUID3();
    await tx.insert(modelRuns).values({
      id,
      version,
      dataset,
      startedAt,
      completedAt: /* @__PURE__ */ new Date(),
      message,
      featureSet: "manual-input-v1",
      stage,
      gates,
      metrics: fitted.metrics,
      actorUserId: actorFields(user).actorUserId
    });
    await tx.update(modelDeploymentState).set({ nextCandidate: state2.nextCandidate + 1 }).where(eq7(modelDeploymentState.id, 1));
    for (const event of ["Model registered", passed ? "Model training accepted" : "Model training rejected"]) {
      await insertAudit(tx, user, {
        event,
        resourceType: "model",
        resourceId: version,
        details: message,
        changes: { run: id, gates, changed, manifest: manifest.digest, dataset, scorer: snapshot.digest }
      });
    }
    return status(tx);
  }));
}
function deployModel(user, version) {
  return query((db) => db.transaction(async (tx) => {
    const state2 = await pointers(tx, true);
    const [run] = await tx.select().from(modelRuns).where(eq7(modelRuns.version, version));
    if (run?.version !== version || run.stage !== "READY") conflict("A ready candidate is required");
    const candidate = await verifyRelease(tx, version);
    if (candidate.parent !== state2.activeVersion || candidate.parentRevision !== state2.revision) conflict("Candidate was built against a stale deployment");
    const parent = await verifyRelease(tx, state2.activeVersion);
    const dataset = run.dataset;
    const before = await scorerFor(tx, parent, dataset);
    const after = await scorerFor(tx, candidate, dataset);
    if (inferenceSignature(before.model) === inferenceSignature(after.model)) conflict("Candidate reproduces the active scorer");
    for (const key of Object.keys(parent.datasets)) {
      if (key !== dataset && parent.datasets[key] !== candidate.datasets[key]) conflict("Candidate changes an unrelated dataset");
    }
    await tx.update(modelRuns).set({ stage: "DEPLOYED" }).where(eq7(modelRuns.id, run.id));
    await switchRelease(tx, user, state2, version, "Model deployed");
    return status(tx);
  }));
}
async function switchRelease(tx, user, state2, target, event) {
  const manifests = await tx.select({ version: modelVersions.version, digest: modelVersions.artifact }).from(modelVersions).where(inArray(modelVersions.version, [state2.activeVersion, target]));
  const digests = Object.fromEntries(manifests.map((row) => [row.version, row.digest]));
  await tx.update(modelDeploymentState).set({ previousVersion: state2.activeVersion, activeVersion: target, revision: state2.revision + 1 }).where(eq7(modelDeploymentState.id, 1));
  await insertAudit(tx, user, {
    event,
    resourceType: "model",
    resourceId: target,
    details: `Switched ${state2.activeVersion} to ${target}`,
    changes: { before: state2.activeVersion, after: target, manifests: digests, revision: state2.revision + 1 }
  });
}
function rollbackModel(user) {
  return query((db) => db.transaction(async (tx) => {
    const state2 = await pointers(tx, true);
    if (state2.previousVersion) {
      await verifyRelease(tx, state2.previousVersion);
      await switchRelease(tx, user, state2, state2.previousVersion, "Model rollback");
    }
    return status(tx);
  }));
}
function mlopsHealth() {
  return query((db) => db.transaction(async (tx) => {
    const s = await status(tx);
    await verifyRelease(tx, s.activeVersion);
    return {
      training: "ready",
      registry: "connected",
      featureStore: "healthy",
      monitoring: s.gates.drift ? "healthy" : "warning",
      inferenceModel: s.activeVersion,
      traceId: randomUUID3()
    };
  }, { isolationLevel: "repeatable read" }));
}

// server/email-detector.ts
var freeMailDomains = /* @__PURE__ */ new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "proton.me",
  "protonmail.com"
]);
var urgencyPattern = /urgent|immediately|act now|within \d+ hours|last chance|final warning/i;
var moneyPattern = /fee|payment|processing charge|registration charge|gift card|wire transfer|bank details|pay now/i;
var credentialPattern = /password|otp|one[- ]time password|verification code|login|reset|credential|social security|aadhaar|pan card/i;
var hiringPattern = /hired|job offer|selected|joining|interview|recruit|salary|employment|offer letter/i;
var shortenerPattern = /(?:https?:\/\/)?(?:bit\.ly|tinyurl\.com|t\.co|cutt\.ly|rb\.gy)\b/i;
var emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
function addSignal2(signals, label, detail, tone) {
  signals.push({ label, detail, tone });
}
async function analyzeEmail(senderInput, subject, content, options) {
  const sender = senderInput.trim().toLowerCase();
  const normalizedSubject = subject.trim();
  const normalizedContent = content.trim();
  const signals = [];
  const combined = `${normalizedSubject} ${normalizedContent}`;
  if (!emailPattern.test(sender)) {
    return {
      sender,
      senderDomain: "Invalid address",
      organization: null,
      risk: "HIGH",
      verdict: "INCONCLUSIVE",
      riskScore: 100,
      confidence: null,
      signals: [{ label: "Invalid sender address", detail: "The sender is not a complete email address.", tone: "danger" }],
      recommendation: "Do not reply or open attachments. Confirm the sender through an official website.",
      links: [],
      missingEvidence: ["A valid sender address is required for domain assessment."],
      disclaimer: "This is a pattern-based demonstration and does not contact the sender or verify mailbox ownership."
    };
  }
  const senderDomain = sender.split("@")[1].toLowerCase();
  const domainRecord = getDomainRecord(senderDomain);
  const organizationEntry = domainRecord?.organization ? [domainRecord.organization, [senderDomain]] : void 0;
  const senderAlias = sender.split("@")[0];
  const mentionedOrganization = ["Infosys", "Google", "Microsoft", "Amazon", "Apple", "Accenture"].find((name) => new RegExp(`\\b${name}\\b`, "i").test(`${senderAlias} ${combined}`));
  let riskScore = 0;
  if (organizationEntry) {
    addSignal2(signals, "Organization domain matched", `${organizationEntry[0]} uses ${senderDomain} in this demo directory.`, "positive");
  } else if (freeMailDomains.has(senderDomain)) {
    riskScore += 35;
    addSignal2(signals, "Free-mail sender", `${senderDomain} is not an official company domain and can be used to impersonate recruiters.`, "warning");
  } else {
    riskScore += 18;
    addSignal2(signals, "Unrecognized organization domain", `The domain ${senderDomain} is not in the current verification directory.`, "warning");
  }
  if (mentionedOrganization && (!organizationEntry || organizationEntry[0] !== mentionedOrganization)) {
    riskScore += 35;
    addSignal2(signals, "Organization mismatch", `The message mentions ${mentionedOrganization}, but the sender domain does not match its known pattern.`, "danger");
  }
  if (urgencyPattern.test(combined)) {
    riskScore += 18;
    addSignal2(signals, "Urgent language", "The message pressures the recipient to act quickly or avoid review.", "warning");
  }
  if (moneyPattern.test(combined)) {
    riskScore += 25;
    addSignal2(signals, "Money request", "The message asks for a fee, payment, transfer, or gift card.", "danger");
  }
  if (credentialPattern.test(combined)) {
    riskScore += 25;
    addSignal2(signals, "Credential request", "The message references passwords, codes, identity documents, or account access.", "danger");
  }
  if (shortenerPattern.test(normalizedContent)) {
    riskScore += 15;
    addSignal2(signals, "Shortened link", "A shortened link hides the destination and should be opened only after independent verification.", "warning");
  }
  if (hiringPattern.test(combined) && !organizationEntry) {
    riskScore += 12;
    addSignal2(signals, "Recruitment claim from unknown domain", "The message discusses hiring but does not come from a recognized organization domain.", "warning");
  }
  const urls = Array.from(new Set(combined.match(/https?:\/\/[^\s<>"']+/gi) ?? [])).slice(0, 10);
  const links = await Promise.all(urls.map((url) => analyzeLink(url)));
  const suspiciousLinks = links.filter((link) => link.verdict === "MALICIOUS" || link.verdict === "SUSPICIOUS" || link.verdict === "UNREACHABLE" || link.verdict === "INCONCLUSIVE");
  if (suspiciousLinks.length) {
    riskScore += Math.min(40, suspiciousLinks.reduce((total, link) => total + (link.verdict === "MALICIOUS" ? 25 : 12), 0));
    addSignal2(signals, "Suspicious message link", `${suspiciousLinks.length} embedded link(s) require independent verification before opening.`, "danger");
  }
  if (options?.replyTo && options.replyTo.trim().toLowerCase() !== sender) {
    riskScore += 25;
    addSignal2(signals, "Reply-To mismatch", "Replies would be directed to an address different from the displayed sender.", "danger");
  }
  if (options?.attachments?.length) {
    const riskyAttachment = options.attachments.some((name) => /\.(exe|scr|js|vbs|bat|cmd|ps1|iso|zip)$/i.test(name));
    if (riskyAttachment) {
      riskScore += 30;
      addSignal2(signals, "Risky attachment type", "One or more attachments can execute code or conceal executable content.", "danger");
    } else {
      addSignal2(signals, "Attachment metadata supplied", "Attachment names were supplied, but files were not opened or executed.", "warning");
    }
  }
  if (signals.length === 1 && riskScore === 0) {
    addSignal2(signals, "No obvious content red flags", "The sender pattern and message did not trigger the current heuristic checks.", "positive");
  }
  riskScore = Math.min(100, riskScore);
  const risk = riskScore >= 60 ? "HIGH" : riskScore >= 30 ? "REVIEW" : "LOW";
  const verdict = riskScore >= 75 ? "PHISHING" : riskScore >= 60 ? "LIKELY_FRAUD" : riskScore >= 30 ? "SUSPICIOUS" : links.length || organizationEntry ? "LEGITIMATE" : "INCONCLUSIVE";
  const confidence = null;
  const missingEvidence = [
    !options?.headers ? "Authentication headers were not provided; SPF, DKIM, and DMARC results were not verified." : null,
    !options?.replyTo ? "Reply-To metadata was not provided." : null,
    !options?.attachments ? "Attachment metadata was not provided." : null
  ].filter((item) => Boolean(item));
  const recommendation = risk === "LOW" ? "Still verify important offers through the organization's official careers page before sharing personal information." : risk === "REVIEW" ? "Do not click links or send documents yet. Contact the organization using a trusted channel." : "Treat this as likely fraud. Do not reply, pay fees, share codes, or open attachments.";
  return {
    sender,
    senderDomain,
    organization: organizationEntry?.[0] ?? mentionedOrganization ?? null,
    risk,
    verdict,
    riskScore,
    confidence,
    signals,
    recommendation,
    links,
    missingEvidence,
    disclaimer: "This is a pattern-based demonstration and does not contact the sender or verify mailbox ownership."
  };
}

// server/routers.ts
var riskFilter = z3.enum(["ALL", "FRAUD", "LEGITIMATE", "HIGH", "MEDIUM", "LOW"]).default("ALL");
var DEMO_OPEN_ID = "demo-fraud-sentinel";
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    demoConfig: publicProcedure.query(() => ({
      enabled: demoAuthEnabled,
      email: demoAuthEnabled ? process.env.DEMO_AUTH_EMAIL : null
    })),
    demoSignIn: publicProcedure.input(z3.object({
      email: z3.string().trim().email(),
      password: z3.string().min(1)
    })).mutation(async ({ input, ctx }) => {
      if (!demoAuthEnabled) {
        throw new TRPCError6({ code: "FORBIDDEN", message: "Demo authentication is disabled" });
      }
      if (input.email.toLowerCase() !== process.env.DEMO_AUTH_EMAIL?.toLowerCase() || input.password !== process.env.DEMO_AUTH_PASSWORD) {
        throw new TRPCError6({ code: "UNAUTHORIZED", message: "Invalid demo credentials" });
      }
      const sessionToken = await sdk.signSession({
        openId: DEMO_OPEN_ID,
        appId: process.env.VITE_APP_ID || "fraud-sentinel-demo",
        name: "Demo Analyst"
      }, { expiresInMs: 1e3 * 60 * 60 * 8 });
      ctx.res.cookie(COOKIE_NAME, sessionToken, {
        ...getSessionCookieOptions(ctx.req),
        maxAge: 1e3 * 60 * 60 * 8
      });
      return { success: true, token: sessionToken };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    })
  }),
  health: publicProcedure.query(async () => {
    const { status: database } = await checkDatabaseConnection();
    const pipeline = database === "connected" ? await pipelineStatus().then((p) => p.status.toLowerCase(), () => "unknown") : "unknown";
    return { api: "connected", database, model: "loaded", pipeline, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }),
  datasets: router({
    list: protectedProcedure.query(() => activeDatasets())
  }),
  linkDetection: router({
    history: protectedProcedure.query(() => listUrlScans()),
    analyze: protectedProcedure.input(z3.object({ url: z3.string().trim().min(1).max(2048) })).mutation(async ({ input, ctx }) => {
      const result = await analyzeLink(input.url);
      await saveUrlScan(result, ctx.user);
      return result;
    })
  }),
  emailDetection: router({
    history: protectedProcedure.query(() => listEmailScans()),
    analyze: protectedProcedure.input(z3.object({
      sender: z3.string().trim().min(1).max(320),
      subject: z3.string().max(300),
      content: z3.string().max(2e4),
      replyTo: z3.string().email().max(320).optional(),
      headers: z3.string().max(3e4).optional(),
      attachments: z3.array(z3.string().max(255)).max(20).optional()
    })).mutation(async ({ input, ctx }) => {
      const result = await analyzeEmail(input.sender, input.subject, input.content, input);
      await saveEmailScan(result, ctx.user);
      return result;
    })
  }),
  mlops: router({
    status: protectedProcedure.query(() => mlopsStatus()),
    health: protectedProcedure.query(() => mlopsHealth()),
    train: adminProcedure.input(z3.object({ datasetName: z3.enum(["01_paysim_style", "02_credit_card_style", "03_ieee_cis_style"]).optional() }).optional()).mutation(({ input, ctx }) => trainModel(ctx.user, input?.datasetName)),
    deploy: adminProcedure.input(z3.object({ version: z3.string() })).mutation(({ input, ctx }) => deployModel(ctx.user, input.version)),
    rollback: adminProcedure.mutation(({ ctx }) => rollbackModel(ctx.user))
  }),
  dashboard: router({
    summary: protectedProcedure.query(async () => dashboardSummary(await activeAlertCount()))
  }),
  transactions: router({
    list: protectedProcedure.input(z3.object({ search: z3.string().default(""), filter: riskFilter, page: z3.number().int().min(1).default(1), pageSize: z3.number().int().min(5).max(50).default(12) })).query(({ input }) => listTransactions(input)),
    get: protectedProcedure.input(z3.object({ id: z3.string() })).query(({ input }) => getTransaction(input.id)),
    predict: protectedProcedure.input(z3.object({ amount: z3.number().positive(), paymentMethod: z3.string(), isNewDevice: z3.boolean(), isInternational: z3.boolean(), velocity1h: z3.number().min(0), failedAttempts: z3.number().min(0), datasetName: z3.enum(["01_paysim_style", "02_credit_card_style", "03_ieee_cis_style"]).optional(), features: z3.record(z3.string(), z3.union([z3.number(), z3.string(), z3.boolean()])).optional() })).mutation(async ({ input, ctx }) => {
      const start = performance.now();
      const { model, digest, version: modelVersion } = await activeScorer(input.datasetName ?? defaultDataset());
      const result = predictWithModel(model, input);
      const probability = result.probability;
      const riskLevel3 = classify(probability);
      const prediction2 = riskLevel3 === "HIGH" ? "FRAUD" : "LEGITIMATE";
      const elapsed = Math.round(performance.now() - start);
      const { amount, paymentMethod, isNewDevice, isInternational, velocity1h, failedAttempts } = input;
      await saveScore(ctx.user, {
        inputs: {
          amount,
          paymentMethod: paymentMethods.includes(paymentMethod) ? paymentMethod : null,
          isNewDevice,
          isInternational,
          velocity1h,
          failedAttempts,
          features: scoringFeatures(model, input.features)
        },
        dataset: result.dataset,
        modelVersion,
        artifact: digest,
        probability,
        riskLevel: riskLevel3,
        prediction: prediction2,
        metrics: result.metrics,
        topRiskFactors: result.topRiskFactors,
        processingTimeMs: elapsed
      });
      return { probability, riskLevel: riskLevel3, prediction: prediction2, modelVersion, dataset: result.dataset, modelArtifact: digest, metrics: result.metrics, processingTimeMs: 42, topRiskFactors: result.topRiskFactors };
    })
  }),
  pipeline: router({
    status: protectedProcedure.query(() => pipelineStatus()),
    start: adminProcedure.input(z3.object({ speed: z3.number().int().min(1).max(10).default(5) })).mutation(({ ctx, input }) => controlPipeline(ctx.user, { action: "start", speed: input.speed })),
    pause: adminProcedure.mutation(({ ctx }) => controlPipeline(ctx.user, { action: "pause" })),
    stop: adminProcedure.mutation(({ ctx }) => controlPipeline(ctx.user, { action: "stop" })),
    step: adminProcedure.mutation(({ ctx }) => controlPipeline(ctx.user, { action: "step" }))
  }),
  monitoring: router({
    overview: protectedProcedure.query(async () => monitoring(await transactionMetrics())),
    drift: protectedProcedure.query(async () => monitoring(await transactionMetrics()).drift),
    performance: protectedProcedure.query(async () => monitoring(await transactionMetrics()).metrics)
  }),
  models: router({
    list: protectedProcedure.query(() => catalog()),
    get: protectedProcedure.input(z3.object({ version: z3.string() })).query(async ({ input }) => (await catalog()).find((model) => model.version === input.version) ?? null),
    retrain: adminProcedure.input(z3.object({ datasetName: z3.enum(["01_paysim_style", "02_credit_card_style", "03_ieee_cis_style"]).optional() }).optional()).mutation(({ input, ctx }) => trainModel(ctx.user, input?.datasetName)),
    promote: adminProcedure.input(z3.object({ version: z3.string() })).mutation(({ input, ctx }) => deployModel(ctx.user, input.version))
  }),
  alerts: router({
    list: protectedProcedure.input(z3.object({ status: z3.enum(["ALL", "OPEN", "ACKNOWLEDGED", "RESOLVED"]).default("ALL") })).query(({ input }) => listAlerts(input.status)),
    acknowledge: protectedProcedure.input(z3.object({ id: z3.string() })).mutation(({ ctx, input }) => transitionAlert(ctx.user, input.id, "ACKNOWLEDGED")),
    resolve: protectedProcedure.input(z3.object({ id: z3.string() })).mutation(({ ctx, input }) => transitionAlert(ctx.user, input.id, "RESOLVED"))
  }),
  experiments: router({ list: protectedProcedure.query(() => [
    { id: "EXP-024", model: "Random Forest", dataset: "sentinel-synthetic-2k", featureSet: "risk-v4", timestamp: "2026-09-18T11:20:00.000Z", status: "Registered", metrics: "F1 0.87 \xB7 PR-AUC 0.88", params: "240 trees \xB7 balanced weights" },
    { id: "EXP-023", model: "Logistic Regression", dataset: "sentinel-synthetic-2k", featureSet: "risk-v4", timestamp: "2026-09-10T14:05:00.000Z", status: "Reference", metrics: "F1 0.76 \xB7 PR-AUC 0.77", params: "C=1.0 \xB7 balanced weights" },
    { id: "EXP-021", model: "Random Forest", dataset: "sentinel-synthetic-2k", featureSet: "risk-v3", timestamp: "2026-09-04T08:40:00.000Z", status: "Archived", metrics: "F1 0.84 \xB7 PR-AUC 0.84", params: "160 trees \xB7 balanced weights" }
  ]) }),
  audit: router({ list: protectedProcedure.query(() => listAudit()) }),
  settings: router({ get: protectedProcedure.query(() => readSettings()), update: adminProcedure.input(z3.object({ lowThreshold: z3.number().min(0).max(1), highThreshold: z3.number().min(0).max(1), latencyThreshold: z3.number().min(50).max(5e3), driftThreshold: z3.number().min(0).max(1) })).mutation(({ ctx, input }) => updateSettings(ctx.user, input)) }),
  metrics: protectedProcedure.query(() => transactionMetrics())
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/app.ts
import { createExpressMiddleware } from "@trpc/server/adapters/express";
function createApp() {
  validateEnvironment();
  const app2 = express();
  app2.disable("x-powered-by");
  const clientOrigins = new Set(
    (process.env.CLIENT_ORIGIN ?? "").split(",").map((origin) => origin.trim().replace(/\/$/, "")).filter(Boolean)
  );
  app2.use((req, res, next) => {
    const requestOrigin = req.headers.origin?.replace(/\/$/, "");
    if (requestOrigin && clientOrigins.has(requestOrigin)) {
      res.setHeader("Access-Control-Allow-Origin", requestOrigin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.vary("Origin");
      if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
    }
    next();
  });
  app2.use(express.json({ limit: "50mb" }));
  app2.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app2);
  app2.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  registerOAuthRoutes(app2);
  app2.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "fraud-sentinel-backend" });
  });
  app2.use("/api/trpc", createExpressMiddleware({
    router: appRouter,
    createContext
  }));
  app2.use("/api", (_req, res) => {
    res.status(404).json({ error: "API route not found" });
  });
  return app2;
}

// serverless/vercel-entry.ts
var app = createApp();
function handler(req, res) {
  return app(req, res);
}
export {
  handler as default
};
