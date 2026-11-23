import { randomBytes } from "node:crypto";
import { sdk } from "./_core/sdk";
import { COOKIE_NAME, OAUTH_STATE_COOKIE, encodeOAuthState } from "../shared/const";

vi.hoisted(async () => {
  const { randomBytes } = await import("node:crypto");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("JWT_SECRET", randomBytes(32).toString("hex"));
  vi.stubEnv("VITE_APP_ID", "test-app");
  vi.stubEnv("OAUTH_SERVER_URL", "https://oauth.invalid");
  vi.stubEnv("DATABASE_URL", "mysql://localhost/test");
  vi.stubEnv("DEMO_AUTH_ENABLED", "false");
});
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("./pipeline-db", () => ({ controlPipeline: vi.fn(), pipelineStatus: vi.fn() }));
vi.mock("./operations-db", () => ({ recordAudit: vi.fn() }));
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "./_core/app";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "./routers";
import { fetchApi, resolveTrpcUrl } from "../client/src/lib/api";

vi.mock("./db", () => ({
  getUserByOpenId: vi.fn(async (openId: string) => ({ openId, role: openId === "owner" ? "admin" : "user" })),
  upsertUser: vi.fn(),
  checkDatabaseConnection: async () => ({ status: "unconfigured" }),
}));
vi.mock("./scan-history", () => ({
  listEmailScans: async () => [],
  listUrlScans: async () => [],
  saveUrlScan: vi.fn(async () => {}),
  saveEmailScan: vi.fn(async () => {}),
}));

describe("shared serverless Express entry point", () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    vi.stubEnv("CLIENT_ORIGIN", "https://dashboard.example, https://frontend.example/");
    server = createApp().listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    vi.unstubAllEnvs();
  });
  it("serves tRPC JSON and honest unconfigured database status", async () => {
    const response = await fetch(`${base}/api/trpc/health`);
    expect(response.status).toBe(200);
    expect((await response.json()).result.data.json).toMatchObject({ database: "unconfigured", pipeline: "unknown" });
  });
  it("handles credentialed preflight before tRPC", async () => {
    const response = await fetch(`${base}/api/trpc/auth.me`, {
      method: "OPTIONS", headers: { Origin: "https://dashboard.example" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://dashboard.example");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });
  it("does not grant CORS to an unrelated origin", async () => {
    const response = await fetch(`${base}/api/trpc/auth.me`, {
      headers: { Origin: "https://unrelated.example" },
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
  it("allows configured Render frontend origins with a trailing slash", async () => {
    const response = await fetch(`${base}/api/trpc/auth.me`, {
      headers: { Origin: "https://frontend.example/" },
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://frontend.example");
  });
  it("requires a session for scan history", async () => {
    const response = await fetch(`${base}/api/trpc/linkDetection.history`);
    expect(response.status).toBe(401);
  });
  it("returns JSON 404 for unknown API paths instead of the SPA", async () => {
    const response = await fetch(`${base}/api/unknown`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "API route not found" });
  });
  it("exchanges a provider code, issues a secure session and resolves the database role", async () => {
    const exchange = vi.spyOn(sdk, "exchangeCodeForToken").mockResolvedValue({ accessToken: "test-access" } as never);
    vi.spyOn(sdk, "getUserInfo").mockResolvedValue({ openId: "analyst", name: "" } as never);
    const nonce = randomBytes(18).toString("hex");
    const state = encodeOAuthState({ redirectUri: base + "/api/oauth/callback", nonce });
    const callback = base + "/api/oauth/callback?" + new URLSearchParams({ code: "test", state });
    expect((await fetch(callback)).status).toBe(403);
    expect(exchange).not.toHaveBeenCalled();
    const response = await fetch(callback, {
      headers: { Cookie: OAUTH_STATE_COOKIE + "=" + nonce }, redirect: "manual",
    });
    expect(response.status).toBe(302);
    const session = response.headers.getSetCookie().find(value => value.startsWith(COOKIE_NAME + "="))!;
    expect(session).toMatch(/; HttpOnly/i);
    expect(session).toMatch(/; Secure/i);
    const cookie = session.split(";")[0];
    const me = await fetch(base + "/api/trpc/auth.me", { headers: { Cookie: cookie } });
    expect((await me.json()).result.data.json).toMatchObject({ openId: "analyst", role: "user" });
  });
  it("uses the stored role for administrative HTTP requests", async () => {
    for (const [id, expected] of [["analyst", 403], ["owner", 200]] as const) {
      const token = await sdk.createSessionToken(id);
      const response = await fetch(base + "/api/trpc/pipeline.pause", {
        method: "POST", headers: { Cookie: COOKIE_NAME + "=" + token, "Content-Type": "application/json" },
        body: JSON.stringify({ json: null }),
      });
      expect(response.status).toBe(expected);
    }
    const { controlPipeline } = await import("./pipeline-db");
    expect(controlPipeline).toHaveBeenCalledTimes(1);
    expect(controlPipeline).toHaveBeenCalledWith(expect.objectContaining({ role: "admin" }), { action: "pause" });
  });
  it("rejects expired, wrong-app, demo and invalid sessions", async () => {
    for (const token of [
      await sdk.signSession({ openId: "analyst", name: "", appId: "other" }),
      await sdk.signSession({ openId: "analyst", name: "", appId: "test-app" }, { expiresInMs: -5000 }),
      await sdk.createSessionToken("demo-fraud-sentinel"),
      "invalid",
    ]) {
      const response = await fetch(base + "/api/trpc/dashboard.summary", { headers: { Authorization: "Bearer " + token } });
      expect(response.status).toBe(401);
    }
  });
  it("sends both detector mutations through the shared client to Express", async () => {
    const client = createTRPCClient<AppRouter>({ links: [httpBatchLink({
      url: resolveTrpcUrl(`${base}/api/`),
      transformer: superjson,
      fetch: async (input, init) => fetchApi(input, {
        ...init, credentials: "include",
        headers: { ...init?.headers, Cookie: COOKIE_NAME + "=" + await sdk.createSessionToken("analyst"), Origin: "https://dashboard.example" },
      }),
    })] });
    // These deliberately invalid synthetic inputs exercise the real detectors
    // without contacting arbitrary websites or a user's mailbox.
    const link = await client.linkDetection.analyze.mutate({ url: "javascript:alert(1)" });
    const email = await client.emailDetection.analyze.mutate({ sender: "invalid", subject: "Synthetic test", content: "Transport test" });
    expect(link.verdict).toBe("INCONCLUSIVE");
    expect(link.signals[0].label).toBe("Unsupported link scheme");
    expect(email.verdict).toBe("INCONCLUSIVE");
    expect(email.signals[0].label).toBe("Invalid sender address");
    const db = await import("./scan-history");
    expect(db.saveUrlScan).toHaveBeenCalledWith(expect.objectContaining({ normalizedUrl: "javascript:alert(1)" }), expect.any(Object));
    expect(db.saveEmailScan).toHaveBeenCalledWith(expect.objectContaining({ sender: "invalid" }), expect.any(Object));
  });
});
