import { eq } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import {
  alerts, appSettings, auditEvents, modelDeploymentState, modelRuns, modelVersions,
  pipelineState, transactions,
} from "../drizzle/schema";
import { createOperationalFixtures, fixtureEpoch, models, operationalSeedVersion } from "./fraud-data";
import { initialRun, previousSeedVersion, productionVersion } from "./model-fixtures";

const resourceTypes: Record<string, string> = {
  "pipeline": "pipeline", "ALT-002": "alert", "v1.2.0": "model", "risk-engine": "settings",
};

function mysqlError(error: unknown, code: string): boolean {
  if (!error || typeof error !== "object") return false;
  return ("code" in error && error.code === code) || ("cause" in error && mysqlError(error.cause, code));
}

/** Called explicitly by the seed CLI, never by the web server. */
export async function seedOperational(db: MySql2Database<Record<string, unknown>>) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await seedTransaction(db);
    } catch (error) {
      // InnoDB rolls back the entire deadlock victim. Retry all writes together.
      if (attempt >= 3 || !mysqlError(error, "ER_LOCK_DEADLOCK")) throw error;
    }
  }
}

function seedTransaction(db: MySql2Database<Record<string, unknown>>) {
  return db.transaction(async tx => {
    const state = createOperationalFixtures();
    // Insert oldest first so descending event order matches the original history.
    const [marker, ...otherEvents] = [...state.audit].reverse().map(event => ({
      id: event.id, createdAt: new Date(event.timestamp), event: event.event,
      actorKind: "system" as const, actorLabel: event.user,
      resourceType: resourceTypes[event.resource], resourceId: event.resource,
      details: event.details, changes: { seedVersion: operationalSeedVersion },
    }));
    async function alreadySeeded() {
      const [row] = await tx.select({ changes: auditEvents.changes })
        .from(auditEvents).where(eq(auditEvents.id, marker.id));
      if (!row) return false;
      const metadata = row.changes;
      if (!metadata || typeof metadata !== "object" || !("seedVersion" in metadata)
        || metadata.seedVersion !== operationalSeedVersion) {
        throw new Error("Seed marker conflicts with an existing audit event");
      }
      return true;
    }
    if (await alreadySeeded()) return "already initialized";
    try {
      await tx.insert(auditEvents).values([marker, ...otherEvents]);
    } catch (error) {
      // A concurrent initializer can commit between our SELECT and INSERT.
      if (mysqlError(error, "ER_DUP_ENTRY") && await alreadySeeded()) return "already initialized";
      throw error;
    }

    await tx.insert(modelVersions).values(models().map(model => ({
      version: model.version, algorithm: model.algorithm, createdAt: new Date(model.created),
      dataset: model.dataset, featureCount: model.features, params: model.params,
      metrics: { precision: model.precision, recall: model.recall, f1: model.f1, prAuc: model.prAuc },
      isReference: model.status === "Reference",
    })));
    await tx.insert(modelRuns).values({
      ...initialRun, startedAt: new Date(initialRun.startedAt),
      completedAt: initialRun.completedAt ? new Date(initialRun.completedAt) : null,
    });
    await tx.insert(modelDeploymentState).values({
      id: 1, activeVersion: productionVersion, previousVersion: previousSeedVersion,
      nextCandidate: Number(productionVersion.split(".").at(-1)) + 1,
    });
    for (let offset = 0; offset < state.transactions.length; offset += 100) {
      const batch = state.transactions.slice(offset, offset + 100);
      await tx.insert(transactions).values(batch.map((row, index) => ({
        ...row, streamSequence: offset + index + 1, timestamp: new Date(row.timestamp),
        amount: row.amount.toFixed(2), previousTransactionAmount: row.previousTransactionAmount.toFixed(2),
      })));
    }
    const { status, cursor, speed } = state.pipeline;
    await tx.insert(pipelineState).values({ id: 1, status, cursor, speed });
    await tx.insert(alerts).values(state.alerts.map(alert => ({
      ...alert, createdAt: new Date(alert.createdAt), updatedAt: new Date(alert.createdAt),
    })));
    await tx.insert(appSettings).values({ id: 1, ...state.settings, updatedAt: new Date(fixtureEpoch) });
    return "initialized";
  }, { isolationLevel: "read committed" });
}
