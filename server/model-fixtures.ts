export type MLOpsStage = "IDLE" | "TRAINING" | "VALIDATING" | "READY" | "DEPLOYED" | "FAILED";

export type Run = {
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

export const productionVersion = "v1.2.0";
export const initialRun: Run = {
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
};

export const previousSeedVersion = "v1.1.0";
