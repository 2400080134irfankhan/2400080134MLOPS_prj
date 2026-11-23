import { TRPCError } from "@trpc/server";
import { eq, gt, sql } from "drizzle-orm";
import { pipelineState as p, transactions, type User } from "../drizzle/schema";
import type { getDb } from "./db";
import type { PipelineState } from "./fraud-data";
import { insertAudit, query } from "./operations-db";

type Reader = Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "select">;
type Command = { action: "start"; speed: number } | { action: "pause" | "stop" | "step" };

function requireState(row: typeof p.$inferSelect | undefined, lastId: string | null): PipelineState {
  if (!row || (row.cursor > 0 && !lastId)) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Pipeline state or its stream position is missing" });
  }
  return { status: row.status, speed: row.speed, cursor: row.cursor, processed: row.cursor,
    startedAt: row.startedAt?.toISOString() ?? null, lastTransactionId: lastId };
}

export async function readPipeline(db: Reader) {
  const [row] = await db.select({ pipeline: p, lastId: transactions.id }).from(p)
    .leftJoin(transactions, eq(transactions.streamSequence, p.cursor)).where(eq(p.id, 1));
  return requireState(row?.pipeline, row?.lastId ?? null);
}

export const pipelineStatus = () => query(readPipeline);

export function controlPipeline(user: User, command: Command) {
  return query(db => db.transaction(async tx => {
    // Acquire the singleton lock before any snapshot reads or decisions.
    const [locked] = await tx.select().from(p).where(eq(p.id, 1)).for("update");
    const [last] = locked?.cursor ? await tx.select({ id: transactions.id }).from(transactions)
      .where(eq(transactions.streamSequence, locked.cursor)) : [];
    const before = requireState(locked, last?.id ?? null);
    const after = { ...before };
    let event: string;
    let details: string;
    switch (command.action) {
      case "step": {
        const [next] = await tx.select({ id: transactions.id, sequence: transactions.streamSequence })
          .from(transactions).where(gt(transactions.streamSequence, before.cursor)).orderBy(transactions.streamSequence).limit(1);
        if (!next) return before;
        if (next.sequence !== before.cursor + 1) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Pipeline stream sequence has a gap" });
        after.cursor = after.processed = next.sequence;
        after.lastTransactionId = next.id;
        event = "Pipeline stepped";
        details = `Processed stream position ${next.sequence} (${next.id})`;
        break;
      }
      case "start":
        after.status = "RUNNING";
        after.speed = command.speed;
        after.startedAt ??= new Date().toISOString();
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
      await tx.update(p).set({ cursor: after.cursor, status: after.status, speed: after.speed,
        startedAt: after.startedAt ? new Date(after.startedAt) : null, revision: sql`${p.revision} + 1` }).where(eq(p.id, 1));
    }
    await insertAudit(tx, user, { event, details, resourceType: "pipeline", resourceId: "pipeline", changes: { before, after } });
    return after;
  }));
}
