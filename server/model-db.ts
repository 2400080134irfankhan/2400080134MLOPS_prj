import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { modelArtifacts as artifacts, modelDeploymentState as deployment, modelRuns, modelVersions } from "../drizzle/schema";
import type { getDb } from "./db";
import { datasetNames, packagedModel, type DatasetName } from "./dataset-model";
import { decodeManifest, decodeScorer, encodeManifest, encodeScorer, type Artifact, type Manifest } from "./model-artifacts";
import { insertAudit } from "./operations-db";

export type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Pick<Database, "select">;
export function conflict(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}
export async function pointers(db: Reader, lock = false) {
  const select = db.select().from(deployment).where(eq(deployment.id, 1));
  const [row] = await (lock ? select.for("update") : select);
  if (!row) throw new Error("Missing model deployment singleton");
  return row;
}
async function artifact(db: Reader, digest: string) {
  const [a] = await db.select().from(artifacts).where(eq(artifacts.digest, digest));
  if (!a) throw new Error("Missing immutable artifact");
  return a;
}
export async function manifestFor(db: Reader, version: string) {
  const [row] = await db.select().from(modelVersions).where(eq(modelVersions.version, version));
  if (!row || row.version !== version || !row.artifact) conflict("Release has no verified artifact binding");
  return decodeManifest(await artifact(db, row.artifact), row.artifact);
}
export async function scorerFor(db: Reader, manifest: Manifest, name: DatasetName) {
  const digest = manifest.datasets[name];
  return { model: decodeScorer(await artifact(db, digest), digest, name), digest };
}
export async function verifyRelease(db: Reader, version: string) {
  const manifest = await manifestFor(db, version);
  for (const name of datasetNames) await scorerFor(db, manifest, name);
  return manifest;
}

// Every writer already owns the same deployment singleton lock.
export async function storeArtifact(tx: Tx, a: Artifact) {
  const [existing] = await tx.select().from(artifacts).where(eq(artifacts.digest, a.digest));
  if (!existing) await tx.insert(artifacts).values(a);
  else if (existing.payload !== a.payload || existing.kind !== a.kind || existing.digest !== a.digest) {
    throw new Error("Existing artifact conflicts with canonical bytes");
  }
}

export async function registerLegacy(db: Database) {
  const scorers = datasetNames.map(name => encodeScorer(packagedModel(name)));
  const datasets = Object.fromEntries(datasetNames.map((name, i) => [name, scorers[i].digest])) as Manifest["datasets"];
  const manifest = encodeManifest({ format: 1, parent: null, parentRevision: 0, datasets });
  if (manifest.digest !== "5c872cd04bdaf67e3e043d5abf8cd619021ec181d74fe2acbf58d6c40d39f92d") {
    conflict("Packaged scorers differ from the approved legacy capture");
  }
  return db.transaction(async tx => {
    const state = await pointers(tx, true);
    const [version] = await tx.select().from(modelVersions).where(eq(modelVersions.version, "v1.2.0"));
    if (version?.artifact === manifest.digest) {
      await verifyRelease(tx, version.version);
      return "already registered";
    }
    const [run] = await tx.select().from(modelRuns).where(eq(modelRuns.id, "RUN-024"));
    if (!version || version.artifact !== null || state.activeVersion !== "v1.2.0" || state.previousVersion !== "v1.1.0" ||
        state.revision !== 0 || state.nextCandidate !== 1 || run?.version !== version.version || run.stage !== "DEPLOYED") {
      conflict("Legacy deployment no longer matches the approved baseline");
    }
    for (const a of [...scorers, manifest]) await storeArtifact(tx, a);
    await tx.update(modelVersions).set({ artifact: manifest.digest }).where(eq(modelVersions.version, version.version));
    await verifyRelease(tx, version.version);
    await insertAudit(tx, null, { event: "Legacy Node scorers registered", resourceType: "model", resourceId: version.version,
      details: "Captured the three observed Node dataset scorers at cutover", changes: { manifest: manifest.digest, datasets } });
    return "registered";
  });
}
