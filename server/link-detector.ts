import dns from "node:dns/promises";
import net from "node:net";
import { getDomainRecord } from "./reputation-data";

export type LinkVerdict = "MALICIOUS" | "SUSPICIOUS" | "UNREACHABLE" | "INCONCLUSIVE" | "NO_KNOWN_THREATS";
export type DnsStatus = "DOMAIN_RESOLVES" | "DOMAIN_DOES_NOT_RESOLVE" | "DNS_LOOKUP_FAILED" | "DNS_RESULT_INCONCLUSIVE" | "NOT_CHECKED";
export type ReachabilityStatus = "REACHABLE" | "UNREACHABLE" | "BLOCKED" | "INCONCLUSIVE" | "NOT_CHECKED";

type LinkSignal = {
  label: string;
  detail: string;
  tone: "positive" | "warning" | "danger";
};

export type LinkAnalysis = {
  normalizedUrl: string;
  hostname: string;
  verdict: LinkVerdict;
  riskScore: number;
  confidence: number | null;
  signals: LinkSignal[];
  dnsStatus: DnsStatus;
  resolvedAddresses: string[];
  reachability: ReachabilityStatus;
  httpStatus: number | null;
  reputationStatus: "KNOWN_BLOCKED" | "KNOWN_REVIEWED" | "UNAVAILABLE";
  disclaimer: string;
};

const suspiciousTlds = new Set([".click", ".download", ".fit", ".gq", ".tk", ".top", ".work", ".zip"]);
const riskyPathWords = /login|signin|verify|verification|secure|account|payment|wallet|password|confirm|update|unlock/i;
const riskyQueryWords = /redirect|url=|target=|continue=|login|token|password|verify/i;
const ipHost = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const supportedProtocols = new Set(["http:", "https:"]);
const maxRedirects = 3;
const timeoutMs = 3500;

function addSignal(signals: LinkSignal[], label: string, detail: string, tone: LinkSignal["tone"]) {
  signals.push({ label, detail, tone });
}

function isPrivateIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || first >= 224;
}

function isPrivateIpv6(address: string) {
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
}

function isBlockedAddress(address: string) {
  return net.isIP(address) === 4 ? isPrivateIpv4(address) : net.isIP(address) === 6 ? isPrivateIpv6(address) : true;
}

function normalizeInput(input: string) {
  const trimmed = input.trim();
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(candidate);
  if (!supportedProtocols.has(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error("Unsupported or ambiguous web URL");
  }
  return parsed;
}

function baseAnalysis(parsed: URL): Omit<LinkAnalysis, "verdict" | "riskScore" | "confidence" | "signals" | "dnsStatus" | "resolvedAddresses" | "reachability" | "httpStatus" | "reputationStatus"> {
  return {
    normalizedUrl: parsed.toString(),
    hostname: parsed.hostname.toLowerCase(),
    disclaimer: "DNS and reachability checks are advisory. A reachable HTTPS site is not proof that its content or owner is trustworthy.",
  };
}

async function lookupHost(hostname: string) {
  if (net.isIP(hostname)) return { status: isBlockedAddress(hostname) ? "DNS_RESULT_INCONCLUSIVE" as const : "DOMAIN_RESOLVES" as const, addresses: isBlockedAddress(hostname) ? [] : [hostname] };
  try {
    const records = await Promise.race([
      dns.lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("DNS lookup timeout")), timeoutMs)),
    ]);
    const addresses = Array.from(new Set(records.map(record => record.address)));
    return addresses.length ? { status: "DOMAIN_RESOLVES" as const, addresses } : { status: "DOMAIN_DOES_NOT_RESOLVE" as const, addresses: [] };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    return { status: code === "ENOTFOUND" || code === "EAI_NONAME" ? "DOMAIN_DOES_NOT_RESOLVE" as const : "DNS_LOOKUP_FAILED" as const, addresses: [] };
  }
}

async function checkReachability(url: URL, addresses: string[]) {
  if (!addresses.length || addresses.some(isBlockedAddress)) return { status: "BLOCKED" as const, httpStatus: null };
  let current = url;
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    try {
      const response = await fetch(current, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirect === maxRedirects) return { status: "INCONCLUSIVE" as const, httpStatus: response.status };
        const next = new URL(location, current);
        if (!supportedProtocols.has(next.protocol)) return { status: "BLOCKED" as const, httpStatus: response.status };
        const nextLookup = await lookupHost(next.hostname);
        if (nextLookup.status !== "DOMAIN_RESOLVES" || nextLookup.addresses.some(isBlockedAddress)) return { status: "BLOCKED" as const, httpStatus: response.status };
        current = next;
        continue;
      }
      return { status: "REACHABLE" as const, httpStatus: response.status };
    } catch {
      return { status: "UNREACHABLE" as const, httpStatus: null };
    }
  }
  return { status: "INCONCLUSIVE" as const, httpStatus: null };
}

export async function analyzeLink(input: string): Promise<LinkAnalysis> {
  let parsed: URL;
  try {
    parsed = normalizeInput(input);
  } catch {
    const scheme = input.trim().match(/^([a-z][a-z\d+.-]*):/i)?.[1];
    const unsupportedScheme = scheme && !supportedProtocols.has(`${scheme.toLowerCase()}:`);
    return {
      normalizedUrl: input.trim(),
      hostname: "Invalid URL",
      verdict: "INCONCLUSIVE",
      riskScore: 100,
      confidence: null,
      signals: [{
        label: unsupportedScheme ? "Unsupported link scheme" : "Invalid link format",
        detail: unsupportedScheme
          ? `${scheme}: links are not inspected because they can execute actions outside a normal web page.`
          : "The submitted value cannot be parsed as a valid HTTP or HTTPS address.",
        tone: "danger",
      }],
      dnsStatus: "NOT_CHECKED",
      resolvedAddresses: [],
      reachability: "NOT_CHECKED",
      httpStatus: null,
      reputationStatus: "UNAVAILABLE",
      disclaimer: "The URL could not be safely parsed, so its existence and legitimacy could not be verified.",
    };
  }

  const result = baseAnalysis(parsed);
  const signals: LinkSignal[] = [];
  let riskScore = 0;
  const hostname = result.hostname;
  const tld = hostname.includes(".") ? hostname.slice(hostname.lastIndexOf(".")) : "";
  const domainRecord = getDomainRecord(hostname);

  if (parsed.protocol === "https:") addSignal(signals, "Encrypted transport", "The address uses HTTPS; encryption does not establish legitimacy.", "positive");
  else {
    riskScore += 15;
    addSignal(signals, "Unencrypted transport", "The address uses HTTP rather than HTTPS.", "warning");
  }
  if (parsed.username || parsed.password) {
    riskScore += 35;
    addSignal(signals, "Hidden destination", "Credentials before the hostname can obscure the destination.", "danger");
  }
  if (ipHost.test(hostname) || net.isIP(hostname)) {
    riskScore += 30;
    addSignal(signals, "IP address hostname", "The link points directly to an IP address rather than a named domain.", "warning");
  }
  if (hostname.includes("xn--") || /[^\u0000-\u007f]/.test(input)) {
    riskScore += 30;
    addSignal(signals, "Internationalized or punycode hostname", "Look-alike Unicode characters can obscure the apparent domain.", "danger");
  }
  if (domainRecord?.status === "shortener") {
    riskScore += 20;
    addSignal(signals, "Link shortener", "The final destination is hidden behind a shortening service.", "warning");
  } else if (domainRecord?.status === "blocked") {
    riskScore += 60;
    addSignal(signals, "Blocked domain", "This exact domain is present in the local blocklist.", "danger");
  } else if (domainRecord?.status === "verified") {
    addSignal(signals, "Reviewed domain entry", "This exact base domain is in the local reviewed directory; this is not live reputation verification.", "positive");
  } else {
    addSignal(signals, "Reputation unavailable", "The domain is not in the local reviewed directory and no external reputation provider is configured.", "warning");
  }
  if (suspiciousTlds.has(tld)) {
    riskScore += 20;
    addSignal(signals, "High-risk domain ending", `${tld} is a risk indicator used by some deceptive campaigns.`, "warning");
  }
  if (hostname.length > 45 || hostname.split(".").length > 4) {
    riskScore += 15;
    addSignal(signals, "Unusual domain structure", "The hostname is unusually long or deeply nested.", "warning");
  }
  if (riskyPathWords.test(parsed.pathname)) {
    riskScore += 15;
    addSignal(signals, "Sensitive action words", "The path requests a sign-in, verification, payment, or account action.", "warning");
  }
  if (riskyQueryWords.test(parsed.search)) {
    riskScore += 12;
    addSignal(signals, "Redirect or credential parameters", "Query parameters suggest redirection or a credential-focused flow.", "warning");
  }
  if ((hostname.match(/-/g) ?? []).length >= 3) {
    riskScore += 10;
    addSignal(signals, "Look-alike naming pattern", "Several hyphens can indicate an impersonation-style domain.", "warning");
  }

  const lookup = await lookupHost(hostname);
  const reachability = lookup.status === "DOMAIN_RESOLVES" ? await checkReachability(parsed, lookup.addresses) : { status: "NOT_CHECKED" as const, httpStatus: null };
  if (lookup.status === "DOMAIN_DOES_NOT_RESOLVE") {
    riskScore += 35;
    addSignal(signals, "Domain does not resolve", "Domain could not be resolved. The website's existence and legitimacy could not be verified.", "danger");
  } else if (lookup.status === "DNS_LOOKUP_FAILED") {
    addSignal(signals, "DNS verification inconclusive", "Domain verification is inconclusive because the DNS lookup failed.", "warning");
  } else if (lookup.status === "DNS_RESULT_INCONCLUSIVE") {
    addSignal(signals, "Destination blocked from inspection", "The resolved destination is local, private, link-local, or otherwise prohibited for server-side requests.", "danger");
    riskScore += 50;
  } else {
    addSignal(signals, "Domain resolves", "DNS returned a public address for the hostname.", "positive");
  }
  if (reachability.status === "BLOCKED") {
    riskScore += 35;
    addSignal(signals, "Reachability check blocked", "The destination or redirect was blocked by outbound network safety controls.", "danger");
  } else if (reachability.status === "REACHABLE") {
    addSignal(signals, "Website responded", `The website responded with HTTP ${reachability.httpStatus}. This does not establish legitimacy.`, "positive");
  } else if (reachability.status === "UNREACHABLE") {
    addSignal(signals, "Website unreachable", "The domain resolves, but an HTTP response could not be obtained within the safety timeout.", "warning");
  }

  riskScore = Math.min(100, riskScore);
  const hasHardMaliciousSignal = domainRecord?.status === "blocked" || parsed.username !== "" || lookup.status === "DNS_RESULT_INCONCLUSIVE";
  const verdict: LinkVerdict = hasHardMaliciousSignal || riskScore >= 70
    ? "MALICIOUS"
    : lookup.status === "DOMAIN_DOES_NOT_RESOLVE" || reachability.status === "UNREACHABLE"
      ? "UNREACHABLE"
      : lookup.status === "DNS_LOOKUP_FAILED" || lookup.status === "DNS_RESULT_INCONCLUSIVE" || reachability.status === "INCONCLUSIVE"
        ? "INCONCLUSIVE"
        : riskScore >= 30
          ? "SUSPICIOUS"
          : "NO_KNOWN_THREATS";

  return {
    ...result,
    verdict,
    riskScore,
    confidence: null,
    signals,
    dnsStatus: lookup.status,
    resolvedAddresses: lookup.addresses,
    reachability: reachability.status,
    httpStatus: reachability.httpStatus,
    reputationStatus: domainRecord?.status === "blocked" ? "KNOWN_BLOCKED" : domainRecord ? "KNOWN_REVIEWED" : "UNAVAILABLE",
  };
}
