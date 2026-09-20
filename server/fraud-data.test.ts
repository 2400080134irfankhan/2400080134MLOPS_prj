import { describe, expect, it } from "vitest";
import { classify, getMetrics, state } from "./fraud-data";
import { appRouter } from "./routers";
import { mlopsStatus } from "./mlops";
import { listDatasets } from "./dataset-model";

describe("fraud data and risk engine", () => {
  it("seeds a realistic transaction population with required fields", () => {
    expect(state.transactions).toHaveLength(2000);
    expect(state.transactions.every((row) => row.amount > 0)).toBe(true);
    expect(state.transactions.every((row) => row.modelVersion === "v1.2.0")).toBe(true);
    const fraudRate = state.transactions.filter((row) => row.isFraud).length / state.transactions.length;
    expect(fraudRate).toBeGreaterThan(0.005);
    expect(fraudRate).toBeLessThan(0.12);
  });

  it("applies configurable risk band semantics", () => {
    expect(classify(0.12)).toBe("LOW");
    expect(classify(0.3)).toBe("MEDIUM");
    expect(classify(0.69)).toBe("MEDIUM");
    expect(classify(0.7)).toBe("HIGH");
  });

  it("computes bounded operational metrics from processed records", () => {
    const metrics = getMetrics();
    expect(metrics.total).toBe(1885);
    expect(metrics.fraudRate).toBeGreaterThanOrEqual(0);
    expect(metrics.fraudRate).toBeLessThanOrEqual(1);
    expect(metrics.precision).toBeGreaterThanOrEqual(0);
    expect(metrics.precision).toBeLessThanOrEqual(1);
    expect(metrics.recall).toBeGreaterThanOrEqual(0);
    expect(metrics.recall).toBeLessThanOrEqual(1);
    expect(metrics.p95).toBeGreaterThan(0);
  });

  it("returns a fraud decision and contributing factors for an input transaction", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as never, res: {} as never });
    const result = await caller.transactions.predict({ amount: 1450, paymentMethod: "Virtual card", isNewDevice: true, isInternational: true, velocity1h: 8, failedAttempts: 3 });
    expect(result.prediction).toBe("FRAUD");
    expect(result.riskLevel).toBe("HIGH");
    expect(result.probability).toBeGreaterThanOrEqual(0.7);
    expect(result.topRiskFactors.length).toBeGreaterThan(1);
  });

  it("runs an MLOps candidate through release gates before deployment", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as never, res: {} as never });
    const trained = await caller.mlops.train();
    expect(trained.latestRun?.stage).toBe("READY");
    expect(Object.values(trained.gates).every(Boolean)).toBe(true);
    const deployed = await caller.mlops.deploy({ version: trained.latestRun!.version });
    expect(deployed.activeVersion).toBe(trained.latestRun!.version);
    expect((await caller.transactions.predict({ amount: 100, paymentMethod: "Card", isNewDevice: false, isInternational: false, velocity1h: 1, failedAttempts: 0 })).modelVersion).toBe(trained.latestRun!.version);
    expect(mlopsStatus().stage).toBe("DEPLOYED");
  });

  it("loads and evaluates each supplied synthetic dataset", async () => {
    const datasets = listDatasets();
    expect(datasets).toHaveLength(3);
    expect(datasets.every((dataset) => dataset.trainRows === 1600 && dataset.testRows === 400)).toBe(true);
    expect(datasets.every((dataset) => dataset.metrics.f1 >= 0 && dataset.metrics.f1 <= 1)).toBe(true);
    const caller = appRouter.createCaller({ user: null, req: {} as never, res: {} as never });
    const prediction = await caller.transactions.predict({ amount: 850, paymentMethod: "Card", isNewDevice: true, isInternational: true, velocity1h: 8, failedAttempts: 3, datasetName: "02_credit_card_style" });
    expect(prediction.dataset).toBe("02_credit_card_style");
    expect(prediction.modelArtifact).toContain("02_credit_card_style");
  });
});
