import { and, count, desc, eq, lt, lte, or, sql } from "drizzle-orm";
import { scoringRequests, transactions as t, type User } from "../drizzle/schema";
import { getMetrics, summary, type RiskLevel, type Transaction } from "./fraud-data";
import { readPipeline } from "./pipeline-db";
import type { getDb } from "./db";
import { actorFields, query } from "./operations-db";

function publicRow({ streamSequence, timestamp, amount, previousTransactionAmount, ...row }: typeof t.$inferSelect): Transaction {
  return { ...row, timestamp: timestamp.toISOString(), amount: Number(amount), previousTransactionAmount: Number(previousTransactionAmount) };
}

type ListInput = { search: string; filter: "ALL" | Transaction["prediction"] | RiskLevel; page: number; pageSize: number };

export function listTransactions({ search, filter, page, pageSize }: ListInput) {
  return query(db => db.transaction(async tx => {
    const scope = and(lte(t.streamSequence, (await readPipeline(tx)).cursor),
      filter === "ALL" ? undefined : filter === "FRAUD" || filter === "LEGITIMATE" ? eq(t.prediction, filter) : eq(t.riskLevel, filter),
      search ? or(...[t.id, t.customerId, t.merchantId, t.merchantName].map(column =>
        sql`LOCATE(CAST(${search.toLowerCase()} AS BINARY), CAST(LOWER(${column}) AS BINARY)) > 0`)) : undefined);
    const [{ total }] = await tx.select({ total: count() }).from(t).where(scope);
    const offset = (page - 1) * pageSize;
    const rows = offset >= total ? [] : await tx.select().from(t).where(scope)
      .orderBy(desc(t.streamSequence)).limit(pageSize).offset(offset);
    return { rows: rows.map(publicRow), total, page, pageSize };
  }, { isolationLevel: "repeatable read" }));
}

export function getTransaction(id: string) {
  return query(async db => {
    const [row] = await db.select().from(t).where(eq(t.id, id));
    return row?.id === id ? publicRow(row) : null;
  });
}

const metricFields = { prediction: t.prediction, fraudProbability: t.fraudProbability, processingTimeMs: t.processingTimeMs, isFraud: t.isFraud };
export function transactionMetrics() {
  return query(db => db.transaction(async tx => {
    const { cursor } = await readPipeline(tx);
    return getMetrics(await tx.select(metricFields).from(t).where(lte(t.streamSequence, cursor)).orderBy(t.streamSequence));
  }, { isolationLevel: "repeatable read" }));
}

export function dashboardSummary(activeAlerts: number) {
  return query(db => db.transaction(async tx => {
    const scope = lte(t.streamSequence, (await readPipeline(tx)).cursor);
    const rows = await tx.select({ ...metricFields, timestamp: t.timestamp, merchantCategory: t.merchantCategory,
      paymentMethod: t.paymentMethod, hour: t.hour }).from(t).where(scope).orderBy(t.streamSequence);
    const recent = await tx.select().from(t).where(scope).orderBy(desc(t.streamSequence)).limit(8);
    return summary(activeAlerts, rows.map(row => ({ ...row, timestamp: row.timestamp.toISOString() })), recent.map(publicRow));
  }, { isolationLevel: "repeatable read" }));
}

type ScoreRecord = Omit<typeof scoringRequests.$inferInsert, "id" | "createdAt" | "actorUserId" | "actorKind">;
export function saveScore(user: User, score: ScoreRecord) {
  const { actorKind, actorUserId } = actorFields(user);
  return query(async db => { await db.insert(scoringRequests).values({ ...score, actorKind, actorUserId }); });
}

export async function deleteExpiredScores(db: Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "delete">) {
  const [result] = await db.delete(scoringRequests).where(lt(scoringRequests.createdAt,
    sql`FROM_UNIXTIME(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) - 90 * 86400)`));
  return result.affectedRows;
}
