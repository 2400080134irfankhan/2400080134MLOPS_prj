import { drizzle } from "drizzle-orm/mysql2";
import { describe, expect, it } from "vitest";
import {
  alerts, appSettings, auditEvents, modelDeploymentState, modelRuns, modelVersions,
  pipelineState, scanHistory, scoringRequests, transactions,
} from "../drizzle/schema";
import { createOperationalFixtures, models } from "./fraud-data";
import { seedOperational } from "./seed-operational";
import { eq } from "drizzle-orm";

const url = process.env.SEED_TEST_DATABASE_URL;

describe("operational fixture initialization", () => {
  it("produces identical fixtures across calls", () => {
    expect(createOperationalFixtures()).toEqual(createOperationalFixtures());
  });

  it.skipIf(!url)("atomically seeds a fresh disposable database and preserves later changes", async () => {
    const target = new URL(url!);
    if (target.hostname !== "127.0.0.1" || target.pathname !== "/fraud_sentinel_seed_test") {
      throw new Error("Seed integration test requires a dedicated loopback fraud_sentinel_seed_test database");
    }
    const db = drizzle(url!);
    const fixtures = createOperationalFixtures();
    try {
      expect(await db.select().from(pipelineState)).toEqual([]);
      const outcomes = await Promise.all([seedOperational(db), seedOperational(db)]);
      expect(outcomes.sort()).toEqual(["already initialized", "initialized"]);
      const rows = await db.select().from(transactions).orderBy(transactions.streamSequence);
      expect(rows.map(({ streamSequence, timestamp, amount, previousTransactionAmount, ...row }, i) => {
        expect(streamSequence).toBe(i + 1);
        return { ...row, timestamp: timestamp.toISOString(), amount: Number(amount),
          previousTransactionAmount: Number(previousTransactionAmount) };
      })).toEqual(fixtures.transactions);
      expect(await db.select().from(pipelineState)).toMatchObject([{ id: 1, cursor: 1885, status: "STOPPED", speed: 5 }]);
      const initialAlerts = await db.select().from(alerts).orderBy(alerts.id);
      expect(initialAlerts.map(({ createdAt, updatedAt, ...row }) =>
        ({ ...row, createdAt: createdAt.toISOString() }))).toEqual(fixtures.alerts);
      expect(await db.select().from(appSettings)).toMatchObject([fixtures.settings]);
      expect((await db.select().from(modelVersions)).map(v => v.version).sort()).toEqual(models().map(v => v.version).sort());
      expect(await db.select().from(modelRuns)).toMatchObject([{ id: "RUN-024", version: "v1.2.0" }]);
      expect(await db.select().from(modelDeploymentState)).toMatchObject([{
        activeVersion: "v1.2.0", previousVersion: "v1.1.0", nextCandidate: 1,
      }]);
      const history = await db.select().from(auditEvents).orderBy(auditEvents.eventOrder);
      expect(history.map(e => e.id)).toEqual(fixtures.audit.map(e => e.id).reverse());
      expect(await db.select().from(scoringRequests)).toEqual([]);
      expect(await db.select().from(scanHistory)).toEqual([]);

      await db.update(pipelineState).set({ cursor: 1910, speed: 8, status: "PAUSED" }).where(eq(pipelineState.id, 1));
      await db.update(alerts).set({ status: "RESOLVED" }).where(eq(alerts.id, "ALT-001"));
      await db.update(appSettings).set({ lowThreshold: 0.4 }).where(eq(appSettings.id, 1));
      await db.update(modelDeploymentState).set({
        activeVersion: "v1.1.0", previousVersion: "v1.2.0", nextCandidate: 7,
      }).where(eq(modelDeploymentState.id, 1));
      expect(await seedOperational(db)).toBe("already initialized");
      expect(await db.select().from(pipelineState)).toMatchObject([{ cursor: 1910, speed: 8, status: "PAUSED" }]);
      expect(await db.select().from(alerts).where(eq(alerts.id, "ALT-001"))).toMatchObject([{ status: "RESOLVED" }]);
      expect(await db.select().from(appSettings)).toMatchObject([{ lowThreshold: 0.4 }]);
      expect(await db.select().from(modelDeploymentState)).toMatchObject([{
        activeVersion: "v1.1.0", previousVersion: "v1.2.0", nextCandidate: 7,
      }]);
      expect(await db.select().from(auditEvents).orderBy(auditEvents.eventOrder)).toEqual(history);
    } finally {
      await db.$client.promise().end();
    }
  }, 30_000);
});
