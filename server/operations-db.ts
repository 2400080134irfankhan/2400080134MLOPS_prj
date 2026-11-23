import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { count, desc, eq, ne, sql } from "drizzle-orm";
import { alerts, appSettings, auditEvents, type User } from "../drizzle/schema";
import { getDb } from "./db";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type AlertRow = typeof alerts.$inferSelect;
type Settings = Pick<typeof appSettings.$inferSelect, "lowThreshold" | "highThreshold" | "latencyThreshold" | "driftThreshold">;

export async function query<T>(work: (db: Database) => Promise<T>) {
  try {
    const db = await getDb();
    if (!db) throw new Error("Missing database connection");
    return await work(db);
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Operational database request failed" });
  }
}

export function actorFields(user: User | null) {
  if (!user) return { actorKind: "system", actorUserId: null, actorLabel: "System" } as const;
  const actorLabel = Array.from(user.name?.trim() || user.openId).slice(0, 160).join("");
  if (user.id === 0 && user.openId === "demo-fraud-sentinel") {
    return { actorKind: "demo", actorUserId: null, actorLabel } as const;
  }
  if (user.id === -1 && user.openId.startsWith("cron_")) {
    return { actorKind: "system", actorUserId: null, actorLabel } as const;
  }
  return { actorKind: "user", actorUserId: user.id, actorLabel } as const;
}

type AuditEntry = Pick<typeof auditEvents.$inferInsert, "event" | "resourceType" | "resourceId" | "details" | "changes">;

export function insertAudit(db: Pick<Database, "insert">, user: User | null, entry: AuditEntry) {
  return db.insert(auditEvents).values({ id: randomUUID(), ...actorFields(user), ...entry });
}

export function recordAudit(user: User | null, entry: AuditEntry) {
  return query(async db => { await insertAudit(db, user, entry); });
}

export function listAudit() {
  return query(async db => {
    const rows = await db.select({
      id: auditEvents.id, timestamp: auditEvents.createdAt, event: auditEvents.event,
      user: auditEvents.actorLabel, resource: auditEvents.resourceId, details: auditEvents.details,
    }).from(auditEvents).orderBy(desc(auditEvents.createdAt), desc(auditEvents.eventOrder));
    return rows.map(row => ({ ...row, timestamp: row.timestamp.toISOString() }));
  });
}

function publicAlert({ updatedAt, createdAt, ...alert }: AlertRow) {
  return { ...alert, createdAt: createdAt.toISOString() };
}

export function listAlerts(status: AlertRow["status"] | "ALL") {
  return query(async db => (await db.select().from(alerts)
    .where(status === "ALL" ? undefined : eq(alerts.status, status))
    .orderBy(desc(alerts.createdAt), alerts.id)).map(publicAlert));
}

export function activeAlertCount() {
  return query(async db => {
    const [row] = await db.select({ total: count() }).from(alerts).where(ne(alerts.status, "RESOLVED"));
    return row.total;
  });
}

export function transitionAlert(user: User, id: string, status: "ACKNOWLEDGED" | "RESOLVED") {
  return query(db => db.transaction(async tx => {
    const [row] = await tx.select().from(alerts).where(eq(alerts.id, id)).for("update");
    if (!row || row.id !== id) throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found" });
    if (row.status === status) return publicAlert(row);
    await tx.update(alerts).set({ status, updatedAt: new Date() }).where(eq(alerts.id, id));
    const acknowledged = status === "ACKNOWLEDGED";
    await insertAudit(tx, user, {
      event: acknowledged ? "Alert acknowledged" : "Alert resolved", resourceType: "alert", resourceId: id,
      details: acknowledged ? "Alert moved to acknowledged state" : "Alert marked resolved by operations",
      changes: { before: row.status, after: status },
    });
    return publicAlert({ ...row, status });
  }));
}

const settingsFields = {
  lowThreshold: appSettings.lowThreshold, highThreshold: appSettings.highThreshold,
  latencyThreshold: appSettings.latencyThreshold, driftThreshold: appSettings.driftThreshold,
};

function requireSettings(row: Settings | undefined) {
  if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Application settings are not initialized" });
  return row;
}

export function readSettings() {
  return query(async db => {
    const [row] = await db.select(settingsFields).from(appSettings).where(eq(appSettings.id, 1));
    return requireSettings(row);
  });
}

export function updateSettings(user: User, after: Settings) {
  return query(db => db.transaction(async tx => {
    const [row] = await tx.select(settingsFields).from(appSettings).where(eq(appSettings.id, 1)).for("update");
    const before = requireSettings(row);
    await tx.update(appSettings).set({
      ...after, updatedAt: new Date(), revision: sql`${appSettings.revision} + 1`,
      actorUserId: actorFields(user).actorUserId,
    }).where(eq(appSettings.id, 1));
    await insertAudit(tx, user, {
      event: "Threshold changed", resourceType: "settings", resourceId: "risk-engine",
      details: `High risk ${after.highThreshold.toFixed(2)} · latency ${after.latencyThreshold} ms`,
      changes: { before, after },
    });
    return after;
  }));
}
