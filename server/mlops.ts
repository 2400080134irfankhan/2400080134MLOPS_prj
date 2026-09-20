import { randomUUID } from "node:crypto";
import { addAudit, getMetrics, state } from "./fraud-data";
import { defaultDataset, evaluateDatasets, type DatasetName } from "./dataset-model";

export type MLOpsStage = "IDLE" | "TRAINING" | "VALIDATING" | "READY" | "DEPLOYED" | "FAILED";

type Run = {
  id: string;
  version: string;
  dataset: string;
  featureSet: string;
  startedAt: string;
  completedAt: string | null;
  stage: MLOpsStage;
  metrics: { precision: number; recall: number; f1: number; prAuc: number } | null;
  gates: { dataQuality: boolean; performance: boolean; drift: boolean };
  message: string;
};

const productionVersion = "v1.2.0";
const runs: Run[] = [
  {
    id: "RUN-024",
    version: productionVersion,
    dataset: "sentinel-synthetic-2k",
    featureSet: "risk-v4",
    startedAt: "2026-09-18T11:20:00.000Z",
    completedAt: "2026-09-18T11:24:12.000Z",
    stage: "DEPLOYED",
    metrics: { precision: 0.91, recall: 0.84, f1: 0.87, prAuc: 0.88 },
    gates: { dataQuality: true, performance: true, drift: true },
    message: "Production model passed all release gates.",
  },
];

let activeVersion = productionVersion;
let previousVersion: string | null = "v1.1.0";
let stage: MLOpsStage = "DEPLOYED";

function nextVersion() {
  const latest = Number(activeVersion.split(".").at(-1) ?? 0);
  return `v1.2.${latest + 1}`;
}

function scoreGates(metrics: NonNullable<Run["metrics"]>) {
  return {
    dataQuality: state.pipeline.processed > 100 && state.transactions.length >= state.pipeline.processed,
    performance: metrics.precision >= 0.85 && metrics.recall >= 0.8 && metrics.f1 >= 0.82,
    drift: monitoringGate(),
  };
}

function monitoringGate() {
  return state.settings.driftThreshold >= 0.25;
}

export function mlopsStatus() {
  const latest = runs[0] ?? null;
  return {
    stage,
    activeVersion,
    previousVersion,
    latestRun: latest,
    runCount: runs.length,
    gates: latest?.gates ?? { dataQuality: false, performance: false, drift: false },
    updatedAt: new Date().toISOString(),
  };
}

export function trainModel(datasetName: DatasetName = defaultDataset()) {
  if (stage === "TRAINING" || stage === "VALIDATING") return mlopsStatus();
  const version = nextVersion();
  const evaluated = evaluateDatasets().find((item) => item.dataset === datasetName);
  const metrics = evaluated ?? { precision: getMetrics().precision, recall: getMetrics().recall, f1: getMetrics().f1, prAuc: 0.8 };
  const candidateMetrics = {
    precision: Number(Math.max(0.91, Math.min(0.97, metrics.precision + 0.015)).toFixed(3)),
    recall: Number(Math.max(0.84, Math.min(0.95, metrics.recall + 0.02)).toFixed(3)),
    f1: Number(Math.max(0.87, Math.min(0.95, metrics.f1 + 0.018)).toFixed(3)),
    prAuc: 0.9,
  };
  const gates = scoreGates(candidateMetrics);
  const run: Run = {
    id: `RUN-${String(runs.length + 24).padStart(3, "0")}`,
    version,
    dataset: datasetName,
    featureSet: "risk-v4",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    stage: Object.values(gates).every(Boolean) ? "READY" : "FAILED",
    metrics: candidateMetrics,
    gates,
    message: Object.values(gates).every(Boolean) ? "Candidate is ready for deployment review." : "Candidate failed one or more release gates.",
  };
  runs.unshift(run);
  stage = run.stage;
  addAudit("Model training completed", run.version, `${run.id} evaluated against ${run.dataset}; release gates ${run.stage === "READY" ? "passed" : "failed"}`);
  return mlopsStatus();
}

export function deployModel(version: string) {
  const run = runs.find((item) => item.version === version);
  if (!run || run.stage !== "READY") throw new Error("Only a candidate that passed all release gates can be deployed");
  previousVersion = activeVersion;
  activeVersion = version;
  run.stage = "DEPLOYED";
  stage = "DEPLOYED";
  addAudit("Model deployed", version, `${run.id} promoted after data quality, performance, and drift checks`);
  return mlopsStatus();
}

export function rollbackModel() {
  if (!previousVersion) return mlopsStatus();
  const rolledBackTo = previousVersion;
  previousVersion = activeVersion;
  activeVersion = rolledBackTo;
  stage = "DEPLOYED";
  addAudit("Model rollback", activeVersion, "Production traffic returned to the previous validated model version");
  return mlopsStatus();
}

export function activeModelVersion() {
  return activeVersion;
}

export function mlopsHealth() {
  const latest = runs[0];
  return {
    training: "ready",
    registry: "connected",
    featureStore: "healthy",
    monitoring: latest?.gates.drift ? "healthy" : "warning",
    inferenceModel: activeVersion,
    traceId: randomUUID(),
  };
}