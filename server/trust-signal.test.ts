import { describe, expect, it } from "vitest";
import { analyzeEmail } from "./email-detector";
import { analyzeLink } from "./link-detector";

describe("trust signal analyzers", () => {
  it("recognizes a matching Infosys sender pattern", async () => {
    const result = await analyzeEmail(
      "careers@infosys.com",
      "Your Infosys job offer",
      "Please confirm your joining date through the official careers portal.",
    );
    expect(result.risk).toBe("LOW");
    expect(result.organization).toBe("Infosys");
  });

  it("flags a Gmail impersonation that requests money and identity data", async () => {
    const result = await analyzeEmail(
      "infosys-careers@gmail.com",
      "Urgent offer letter",
      "Pay the processing fee and send your Aadhaar and verification code.",
    );
    expect(result.risk).toBe("HIGH");
    expect(result.signals.some(signal => signal.label === "Organization mismatch")).toBe(true);
  });

  it("marks a suspicious shortened link for review or fraud", async () => {
    const result = await analyzeLink("http://secure-login.example.click/verify?redirect=wallet");
    expect(["SUSPICIOUS", "MALICIOUS", "UNREACHABLE", "INCONCLUSIVE"]).toContain(result.verdict);
    expect(result.signals.some(signal => signal.label === "Link shortener") || result.riskScore > 0).toBe(true);
  });

  it("never marks an unknown HTTPS domain as safe", async () => {
    const result = await analyzeLink("https://khan.com");
    expect(["SUSPICIOUS", "UNREACHABLE", "INCONCLUSIVE", "NO_KNOWN_THREATS"]).toContain(result.verdict);
    expect(result.signals.some(signal => signal.label === "Reputation unavailable")).toBe(true);
  });

  it("reports a reserved non-resolving domain as unverifiable", async () => {
    const result = await analyzeLink("https://nonexistent-example-123456.invalid/");
    expect(result.dnsStatus).toBe("DOMAIN_DOES_NOT_RESOLVE");
    expect(result.verdict).toBe("UNREACHABLE");
    expect(result.signals.some(signal => signal.label === "Domain does not resolve")).toBe(true);
  });

  it("blocks localhost inspection to prevent SSRF", async () => {
    const result = await analyzeLink("http://127.0.0.1:8080/admin");
    expect(result.dnsStatus).toBe("DNS_RESULT_INCONCLUSIVE");
    expect(result.reachability).toBe("NOT_CHECKED");
    expect(result.verdict).toBe("MALICIOUS");
  });

  it("rejects non-web schemes instead of treating them as ordinary links", async () => {
    const result = await analyzeLink("javascript:alert(1)");
    expect(result.verdict).toBe("INCONCLUSIVE");
    expect(result.riskScore).toBe(100);
    expect(result.signals[0]?.label).toBe("Unsupported link scheme");
  });
});
