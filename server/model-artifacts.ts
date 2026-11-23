import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { datasetNames, packagedModel, type DatasetModel, type DatasetName } from "./dataset-model";

export const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const finite = z.number().finite();
const unit = finite.min(0).max(1);
const frequency = z.array(z.tuple([z.string(), z.number().int().positive()]));
const statistic = z.object({
  numeric: z.boolean(), fraudMean: finite, legitMean: finite, fraudStd: finite.positive(), legitStd: finite.positive(),
  fraudCount: frequency, legitCount: frequency,
}).strict();

const scorerSchema = z.object({
  format: z.literal(1), scorer: z.literal("feature-statistics-v1"), adapter: z.literal("manual-input-v1"),
  dataset: z.enum(datasetNames), source: z.object({ train: hash, test: hash, metadata: hash }).strict(),
  version: z.string().min(1), features: z.array(z.string()), fraudRate: unit,
  trainRows: z.number().int().positive(), testRows: z.number().int().positive(),
  metrics: z.object({ precision: unit, recall: unit, f1: unit, prAuc: unit }).strict(),
  stats: z.array(z.tuple([z.string(), statistic])),
}).strict();

const manifestSchema = z.object({
  format: z.literal(1), parent: z.string().nullable(), parentRevision: z.number().int().nonnegative(),
  datasets: z.object({ "01_paysim_style": hash, "02_credit_card_style": hash, "03_ieee_cis_style": hash }).strict(),
}).strict();
export type Manifest = z.infer<typeof manifestSchema>;
export type Artifact = { digest: string; kind: "scorer" | "manifest"; payload: string };

// Canonical UTF-8 JSON. Arrays retain their order, including the order of feature accumulation.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error("Non-finite artifact number");
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
    }
    return item;
  });
}

function pack(kind: Artifact["kind"], value: unknown): Artifact {
  const payload = canonical(value);
  return { kind, payload, digest: sha256(payload) };
}
function unpack(a: Artifact, expected: string, kind: Artifact["kind"]) {
  if (a.digest !== expected || a.kind !== kind || sha256(a.payload) !== expected) throw new Error("Artifact integrity check failed");
  const value = JSON.parse(a.payload);
  if (canonical(value) !== a.payload) throw new Error("Noncanonical artifact");
  return value;
}
export const encodeManifest = (value: Manifest) => pack("manifest", manifestSchema.parse(value));
export const decodeManifest = (a: Artifact, expected: string) => manifestSchema.parse(unpack(a, expected, "manifest"));

export function encodeScorer(model: DatasetModel) {
  const { name, stats, ...fields } = model;
  const fileHash = (file: string) => sha256(readFileSync(join("datasets", name, file)));
  const pairs = (map: Map<string, number>) => Array.from(map).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return pack("scorer", { format: 1, scorer: "feature-statistics-v1", adapter: "manual-input-v1", dataset: name,
    source: { train: fileHash("train_80.xlsx"), test: fileHash("test_20.xlsx"), metadata: sha256(canonical(JSON.parse(readFileSync(join("datasets", name, "metadata.json"), "utf8")))) },
    ...fields, stats: model.features.map(key => {
      const stat = stats.get(key)!;
      return [key, { ...stat, fraudCount: pairs(stat.fraudCount), legitCount: pairs(stat.legitCount) }];
    }),
  });
}

export function decodeScorer(a: Artifact, expected: string, dataset: DatasetName): DatasetModel {
  const s = scorerSchema.parse(unpack(a, expected, "scorer"));
  const order = packagedModel(dataset).features;
  if (s.dataset !== dataset || s.features.length !== order.length || s.stats.length !== order.length ||
      !order.every((key, i) => key === s.features[i] && key === s.stats[i][0])) throw new Error("Incompatible dataset or feature order");
  const stats: DatasetModel["stats"] = new Map();
  for (const [key, stat] of s.stats) {
    const fraudCount = new Map(stat.fraudCount), legitCount = new Map(stat.legitCount);
    if (fraudCount.size !== stat.fraudCount.length || legitCount.size !== stat.legitCount.length ||
        stat.numeric && (fraudCount.size || legitCount.size)) throw new Error("Invalid feature counts");
    stats.set(key, { ...stat, fraudCount, legitCount });
  }
  return { name: dataset, version: s.version, features: s.features, fraudRate: s.fraudRate,
    trainRows: s.trainRows, testRows: s.testRows, metrics: s.metrics, stats };
}

// Excludes labels, workbook provenance and evaluation results from the no-change check.
export function inferenceSignature(model: DatasetModel) {
  return canonical([model.fraudRate, model.features.map(key => {
    const s = model.stats.get(key)!;
    return { ...s, fraudCount: Object.fromEntries(s.fraudCount), legitCount: Object.fromEntries(s.legitCount) };
  })]);
}
