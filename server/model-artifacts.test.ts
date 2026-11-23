import { describe, expect, it } from "vitest";
import { datasetNames, packagedModel, predictWithModel, loadRows, scoreRow } from "./dataset-model";
import { decodeScorer, encodeScorer, sha256, decodeManifest, encodeManifest } from "./model-artifacts";

describe("immutable Node scorer snapshots", () => {
  it.each(datasetNames)("exactly reproduces training, held-out and manual predictions for %s", name => {
    const model = packagedModel(name);
    const a = encodeScorer(model);
    const copy = decodeScorer(a, a.digest, name);
    expect(encodeScorer(copy)).toEqual(a);
    for (const split of ["train_80", "test_20"] as const) {
      const rows = loadRows(name, split);
      expect(rows.map(row => scoreRow(row, copy))).toEqual(rows.map(row => scoreRow(row, model)));
    }
    for (const amount of [15, 1500]) {
      const input = { amount, isNewDevice: amount > 1000, isInternational: false, failedAttempts: 2, velocity1h: 6 };
      expect(predictWithModel(copy, input)).toEqual(predictWithModel(model, input));
    }
  });
  it("rejects corruption, unsupported formats, incompatible adapters, altered feature order and mismapped datasets", () => {
    const a = encodeScorer(packagedModel(datasetNames[0]));
    expect(() => decodeScorer({ ...a, payload: a.payload + " " }, a.digest, datasetNames[0])).toThrow();
    expect(() => decodeScorer(a, a.digest, datasetNames[1])).toThrow();
    for (const patch of [{format:2}, {adapter:"future"}, {scorer:"unknown"}, {features:[...packagedModel(datasetNames[0]).features].reverse()}]) {
      const payload = JSON.stringify({ ...JSON.parse(a.payload), ...patch });
      const changed = { ...a, payload, digest: sha256(payload) };
      expect(() => decodeScorer(changed, changed.digest, datasetNames[0])).toThrow();
    }
    const incomplete = { format:1, parent:null, parentRevision:0, datasets:{ [datasetNames[0]]: a.digest } };
    expect(() => encodeManifest(incomplete as never)).toThrow();
    expect(() => decodeManifest(a, a.digest)).toThrow();
  });
});
