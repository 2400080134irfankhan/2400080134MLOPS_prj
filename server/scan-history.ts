import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { scanHistory, type User } from "../drizzle/schema";
import type { EmailAnalysis } from "./email-detector";
import { isBlockedAddress, type LinkAnalysis } from "./link-detector";
import { actorFields, query } from "./operations-db";
import type { getDb } from "./db";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
const cutoff = sql`FROM_UNIXTIME(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) - 90 * 86400)`;

// A detector can return unparsed input as its normalizedUrl or sender.
// Store only a validated hostname and scheme; even path segments can be tokens.
function validDomain(host: string) {
  return host.length <= 253 && host.split(".").every(part =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part));
}

function linkSnapshot(r: LinkAnalysis): LinkAnalysis {
  let normalizedUrl = "Invalid URL";
  let hostname = "Invalid URL";
  if (r.hostname !== "Invalid URL") {
    const url = new URL(r.normalizedUrl);
    if (["http:", "https:"].includes(url.protocol) && (validDomain(url.hostname) || /^\[[a-f\d:]+\]$/i.test(url.hostname))) {
      hostname = url.hostname;
      normalizedUrl = url.protocol + "//" + url.host + "/";
    }
  }
  return {
    normalizedUrl, hostname, verdict: r.verdict, riskScore: r.riskScore, confidence: r.confidence,
    signals: r.signals.map(({ label, detail, tone }) => ({
      label, tone, detail: label === "Unsupported link scheme" ? "Only HTTP and HTTPS links are inspected." : detail,
    })),
    dnsStatus: r.dnsStatus, resolvedAddresses: r.resolvedAddresses.filter(address => !isBlockedAddress(address)),
    reachability: r.reachability, httpStatus: r.httpStatus, reputationStatus: r.reputationStatus, disclaimer: r.disclaimer,
  };
}

function emailSnapshot(r: EmailAnalysis): EmailAnalysis {
  const senderDomain = validDomain(r.senderDomain) ? r.senderDomain : "Invalid address";
  return {
    sender: senderDomain, senderDomain, organization: r.organization, risk: r.risk, verdict: r.verdict,
    riskScore: r.riskScore, confidence: r.confidence, recommendation: r.recommendation,
    signals: r.signals.map(({ label, detail, tone }) => ({
      label, tone, detail: detail.replaceAll(r.senderDomain, senderDomain),
    })),
    links: r.links.map(linkSnapshot), missingEvidence: r.missingEvidence, disclaimer: r.disclaimer,
  };
}

function insertScan(kind: "URL" | "EMAIL", result: LinkAnalysis | EmailAnalysis, user: User) {
  const { actorKind, actorUserId } = actorFields(user);
  return query(async db => {
    await db.insert(scanHistory).values({
      kind, formatVersion: 1, actorKind, actorUserId, verdict: result.verdict, riskScore: result.riskScore, result,
    });
  });
}

export function saveUrlScan(result: LinkAnalysis, user: User) {
  return insertScan("URL", linkSnapshot(result), user);
}

export function saveEmailScan(result: EmailAnalysis, user: User) {
  return insertScan("EMAIL", emailSnapshot(result), user);
}

async function latest(kind: "URL" | "EMAIL") {
  return query(db => db.select({ result: scanHistory.result }).from(scanHistory)
    .where(and(eq(scanHistory.kind, kind), eq(scanHistory.formatVersion, 1), gte(scanHistory.createdAt, cutoff)))
    .orderBy(desc(scanHistory.createdAt), desc(scanHistory.id)).limit(10));
}

export async function listUrlScans() {
  return (await latest("URL")).map(row => row.result as LinkAnalysis);
}

export async function listEmailScans() {
  return (await latest("EMAIL")).map(row => row.result as EmailAnalysis);
}

export async function deleteExpiredScans(db: Pick<Database, "delete">) {
  const [result] = await db.delete(scanHistory).where(lt(scanHistory.createdAt, cutoff));
  return result.affectedRows;
}
