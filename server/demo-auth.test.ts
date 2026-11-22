import { expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import { sdk } from "./_core/sdk";
import type { TrpcContext } from "./_core/context";

vi.hoisted(async () => {
  const { randomBytes } = await import("node:crypto");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VITE_APP_ID", "");
  vi.stubEnv("JWT_SECRET", randomBytes(32).toString("hex"));
  vi.stubEnv("DEMO_AUTH_ENABLED", "true");
  vi.stubEnv("DEMO_AUTH_EMAIL", "analyst@example.invalid");
  vi.stubEnv("DEMO_AUTH_PASSWORD", randomBytes(24).toString("hex"));
});

it("signs in a development demo user with configured credentials and grants analyst access", async () => {
  const req = { headers: {}, protocol: "http" } as TrpcContext["req"];
  const res = { cookie: vi.fn() } as unknown as TrpcContext["res"];
  const client = appRouter.createCaller({ req, res, user: null });
  const { enabled, email } = await client.auth.demoConfig();
  expect(enabled).toBe(true);
  await expect(client.auth.demoSignIn({ email: email!, password: "incorrect" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  const { token } = await client.auth.demoSignIn({ email: email!, password: process.env.DEMO_AUTH_PASSWORD! });
  req.headers.authorization = "Bearer " + token;
  const user = await sdk.authenticateRequest(req);
  expect(user.role).toBe("user");
  const signedIn = appRouter.createCaller({ req, res, user });
  await signedIn.dashboard.summary();
  await expect(signedIn.pipeline.pause()).rejects.toMatchObject({ code: "FORBIDDEN" });
});
