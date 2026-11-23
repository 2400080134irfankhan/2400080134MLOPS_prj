import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { appSettings, auditEvents, modelDeploymentState as deployment, modelRuns as runs, modelVersions as versions, transactions, type User } from "../drizzle/schema";
import { actorFields, insertAudit, query } from "./operations-db";
import { readPipeline } from "./pipeline-db";
import { listDatasets, defaultDataset, evaluateModel, trainDataset, type DatasetName } from "./dataset-model";
import { decodeScorer, encodeManifest, encodeScorer, inferenceSignature } from "./model-artifacts";
import { conflict, manifestFor, pointers, scorerFor, storeArtifact, verifyRelease, type Tx } from "./model-db";
import type { MLOpsStage, Run } from "./model-fixtures";
export type { MLOpsStage } from "./model-fixtures";

async function status(tx: Tx) {
  const state = await pointers(tx);
  // Singleton-serialized registrations establish a total order even if Node clocks disagree.
  const [latest] = await tx.select({ run: runs }).from(runs).leftJoin(auditEvents, and(
    eq(auditEvents.resourceId, runs.version), eq(auditEvents.resourceType, "model"), eq(auditEvents.event, "Model registered"),
  )).orderBy(desc(auditEvents.eventOrder), desc(runs.completedAt), desc(runs.id)).limit(1);
  const r = latest?.run;
  const [{ runCount }] = await tx.select({ runCount: count() }).from(runs);
  const latestRun: Run | null = r ? {
    id: r.id, version: r.version, dataset: r.dataset, featureSet: r.featureSet, startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null, metrics: r.metrics, gates: r.gates, stage: r.stage, message: r.message,
  } : null;
  const [last] = await tx.select({ event: auditEvents.event }).from(auditEvents)
    .where(eq(auditEvents.resourceType, "model")).orderBy(desc(auditEvents.eventOrder)).limit(1);
  const stage: MLOpsStage = last?.event === "Model rollback" || last?.event === "Model deployed" ? "DEPLOYED" : latestRun?.stage ?? "IDLE";
  return { stage, activeVersion: state.activeVersion, previousVersion: state.previousVersion, latestRun, runCount,
    gates: latestRun?.gates ?? { dataQuality: false, performance: false, drift: false }, updatedAt: new Date().toISOString() };
}

export const mlopsStatus = () => query(db => db.transaction(status, { isolationLevel: "repeatable read" }));

export function catalog() {
  return query(db => db.transaction(async tx => {
    const { activeVersion } = await pointers(tx);
    const rows = await tx.select({ v: versions, stage: runs.stage }).from(versions)
      .leftJoin(runs, eq(runs.version, versions.version)).orderBy(desc(versions.createdAt));
    return rows.map(({ v, stage }) => ({ version: v.version, algorithm: v.algorithm, created: v.createdAt.toISOString(),
      dataset: v.dataset, ...v.metrics, features: v.featureCount, params: v.params,
      status: v.version === activeVersion ? "Production" : v.isReference ? "Reference" :
        stage === "READY" ? "Ready" : stage === "FAILED" ? "Rejected" : "Archived" }));
  }, { isolationLevel: "repeatable read" }));
}

export function activeDatasets() {
  return query(db => db.transaction(async tx => {
    const state = await pointers(tx);
    const manifest = await manifestFor(tx, state.activeVersion);
    const result = [];
    for (const dataset of listDatasets()) {
      const { model, digest } = await scorerFor(tx, manifest, dataset.name);
      result.push({ ...dataset, modelVersion: digest, trainRows: model.trainRows, testRows: model.testRows,
        rows: model.trainRows + model.testRows, fraudRate: model.fraudRate, metrics: model.metrics });
    }
    return result;
  }, { isolationLevel: "repeatable read" }));
}

export function activeScorer(dataset: DatasetName) {
  return query(db => db.transaction(async tx => {
    const { activeVersion } = await pointers(tx);
    const manifest = await manifestFor(tx, activeVersion);
    return { version: activeVersion, ...await scorerFor(tx, manifest, dataset) };
  }, { isolationLevel: "repeatable read" }));
}

export async function trainModel(user: User, dataset: DatasetName = defaultDataset()) {
  const base = await query(db => pointers(db));
  const startedAt = new Date();
  const fitted = trainDataset(dataset);
  fitted.metrics = evaluateModel(fitted);
  const snapshot = encodeScorer(fitted);
  decodeScorer(snapshot, snapshot.digest, dataset);
  return query(db => db.transaction(async tx => {
    const state = await pointers(tx, true);
    if (base.revision !== state.revision || state.activeVersion !== base.activeVersion) conflict("Active deployment changed during fitting");
    const parent = await verifyRelease(tx, state.activeVersion);
    const previous = await scorerFor(tx, parent, dataset);
    const changed = inferenceSignature(previous.model) !== inferenceSignature(fitted);
    const version = `v1.2.${state.nextCandidate}`;
    const manifest = encodeManifest({ format: 1, parent: state.activeVersion, parentRevision: state.revision,
      datasets: { ...parent.datasets, [dataset]: snapshot.digest } });
    const { cursor } = await readPipeline(tx);
    const [{ total }] = await tx.select({ total: count() }).from(transactions);
    const [settings] = await tx.select().from(appSettings).where(eq(appSettings.id, 1));
    if (!settings) throw new Error("Missing gate settings");
    const { precision, recall, f1 } = fitted.metrics;
    const gates = { dataQuality: cursor > 100 && total >= cursor, performance: precision >= 0.85 && recall >= 0.8 && f1 >= 0.82,
      drift: settings.driftThreshold >= 0.25 };
    const passed = changed && Object.values(gates).every(Boolean);
    const stage = passed ? "READY" : "FAILED";
    const message = !changed ? "Candidate reproduces the active scorer." : passed ? "Candidate passed release gates." : "Candidate failed release gates.";
    await storeArtifact(tx, snapshot);
    await storeArtifact(tx, manifest);
    await tx.insert(versions).values({ version, dataset, algorithm: "Feature statistics", featureCount: fitted.features.length,
      params: "feature-statistics-v1", metrics: fitted.metrics, artifact: manifest.digest });
    const id = "RUN-" + randomUUID();
    await tx.insert(runs).values({ id, version, dataset, startedAt, completedAt: new Date(), message, featureSet: "manual-input-v1",
      stage, gates, metrics: fitted.metrics, actorUserId: actorFields(user).actorUserId });
    await tx.update(deployment).set({ nextCandidate: state.nextCandidate + 1 }).where(eq(deployment.id, 1));
    for (const event of ["Model registered", passed ? "Model training accepted" : "Model training rejected"]) {
      await insertAudit(tx, user, { event, resourceType: "model", resourceId: version, details: message,
        changes: { run: id, gates, changed, manifest: manifest.digest, dataset, scorer: snapshot.digest } });
    }
    return status(tx);
  }));
}

export function deployModel(user: User, version: string) {
  return query(db => db.transaction(async tx => {
    const state = await pointers(tx, true);
    const [run] = await tx.select().from(runs).where(eq(runs.version, version));
    if (run?.version !== version || run.stage !== "READY") conflict("A ready candidate is required");
    const candidate = await verifyRelease(tx, version);
    if (candidate.parent !== state.activeVersion || candidate.parentRevision !== state.revision) conflict("Candidate was built against a stale deployment");
    const parent = await verifyRelease(tx, state.activeVersion);
    const dataset = run.dataset as DatasetName;
    const before = await scorerFor(tx, parent, dataset);
    const after = await scorerFor(tx, candidate, dataset);
    if (inferenceSignature(before.model) === inferenceSignature(after.model)) conflict("Candidate reproduces the active scorer");
    for (const key of Object.keys(parent.datasets) as DatasetName[]) {
      if (key !== dataset && parent.datasets[key] !== candidate.datasets[key]) conflict("Candidate changes an unrelated dataset");
    }
    await tx.update(runs).set({ stage: "DEPLOYED" }).where(eq(runs.id, run.id));
    await switchRelease(tx, user, state, version, "Model deployed");
    return status(tx);
  }));
}

async function switchRelease(tx: Tx, user: User, state: Awaited<ReturnType<typeof pointers>>, target: string, event: string) {
  const manifests = await tx.select({ version: versions.version, digest: versions.artifact }).from(versions)
    .where(inArray(versions.version, [state.activeVersion, target]));
  const digests = Object.fromEntries(manifests.map(row => [row.version, row.digest]));
  await tx.update(deployment).set({ previousVersion: state.activeVersion, activeVersion: target, revision: state.revision + 1 }).where(eq(deployment.id, 1));
  await insertAudit(tx, user, { event, resourceType: "model", resourceId: target, details: `Switched ${state.activeVersion} to ${target}`,
    changes: { before: state.activeVersion, after: target, manifests: digests, revision: state.revision + 1 } });
}

export function rollbackModel(user: User) {
  return query(db => db.transaction(async tx => {
    const state = await pointers(tx, true);
    if (state.previousVersion) {
      await verifyRelease(tx, state.previousVersion);
      await switchRelease(tx, user, state, state.previousVersion, "Model rollback");
    }
    return status(tx);
  }));
}

export function mlopsHealth() {
  return query(db => db.transaction(async tx => {
    const s = await status(tx);
    await verifyRelease(tx, s.activeVersion);
    return { training: "ready", registry: "connected", featureStore: "healthy", monitoring: s.gates.drift ? "healthy" : "warning",
      inferenceModel: s.activeVersion, traceId: randomUUID() };
  }, { isolationLevel: "repeatable read" }));
}
