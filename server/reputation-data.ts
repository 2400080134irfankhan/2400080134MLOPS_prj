import fs from "node:fs";
import path from "node:path";

export type DomainStatus = "verified" | "shortener" | "blocked";

export type DomainRecord = {
  domain: string;
  status: DomainStatus;
  organization: string | null;
};

type ReputationFile = {
  version: string;
  source: string;
  disclaimer: string;
  domains: DomainRecord[];
};

const filePath = path.resolve(process.cwd(), "data", "reputation", "domains.json");
const reputation = JSON.parse(fs.readFileSync(filePath, "utf8")) as ReputationFile;
const records = new Map(reputation.domains.map(record => [record.domain.toLowerCase(), record]));

export function getDomainRecord(hostname: string): DomainRecord | null {
  const normalized = hostname.toLowerCase().replace(/^www\./, "");
  return records.get(normalized) ?? null;
}

export function getReputationMetadata() {
  return { version: reputation.version, source: reputation.source, disclaimer: reputation.disclaimer, domains: records.size };
}
