import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";
import { state } from "./fraud-data";

vi.mock("./_core/notification", () => ({ notifyOwner: async () => true }));

function caller(role: "user" | "admin" | null) {
  const now = new Date();
  const user = role && {
    role, id: 1, openId: "test", email: null, name: "Test", loginMethod: "oauth",
    createdAt: now, updatedAt: now, lastSignedIn: now,
  };
  return appRouter.createCaller({ user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] });
}

type Action = (client: ReturnType<typeof caller>) => Promise<unknown>;
const analyst: Record<string, Action> = {
  "dashboard.summary": c => c.dashboard.summary(),
  "transactions.list": c => c.transactions.list({}),
  "transactions.get": c => c.transactions.get({ id: state.transactions[0].id }),
  "transactions.predict": c => c.transactions.predict({ amount: 100, paymentMethod: "Card",
    isNewDevice: false, isInternational: false, velocity1h: 1, failedAttempts: 0 }),
  "datasets.list": c => c.datasets.list(),
  "linkDetection.analyze": c => c.linkDetection.analyze({ url: "javascript:void(0)" }),
  "linkDetection.history": c => c.linkDetection.history(),
  "emailDetection.analyze": c => c.emailDetection.analyze({ sender: "invalid", content: "", subject: "" }),
  "emailDetection.history": c => c.emailDetection.history(),
  "pipeline.status": c => c.pipeline.status(),
  "mlops.status": c => c.mlops.status(),
  "mlops.health": c => c.mlops.health(),
  "monitoring.overview": c => c.monitoring.overview(),
  "monitoring.drift": c => c.monitoring.drift(),
  "monitoring.performance": c => c.monitoring.performance(),
  "models.list": c => c.models.list(),
  "models.get": c => c.models.get({ version: "v1.2.0" }),
  "alerts.list": c => c.alerts.list({}),
  "alerts.acknowledge": c => c.alerts.acknowledge({ id: state.alerts[0].id }),
  "alerts.resolve": c => c.alerts.resolve({ id: state.alerts[0].id }),
  "experiments.list": c => c.experiments.list(),
  "audit.list": c => c.audit.list(),
  "settings.get": c => c.settings.get(),
  metrics: c => c.metrics(),
};
const administrator: Record<string, Action> = {
  "pipeline.start": c => c.pipeline.start({ speed: 2 }),
  "pipeline.step": c => c.pipeline.step(),
  "pipeline.pause": c => c.pipeline.pause(),
  "pipeline.stop": c => c.pipeline.stop(),
  "mlops.train": c => c.mlops.train(),
  "mlops.deploy": async c => c.mlops.deploy({ version: (await caller("admin").mlops.train()).latestRun!.version }),
  "mlops.rollback": c => c.mlops.rollback(),
  "models.retrain": c => c.models.retrain(),
  "models.promote": async c => c.models.promote({ version: (await caller("admin").models.retrain()).latestRun!.version }),
  "settings.update": c => c.settings.update({ ...state.settings }),
  "system.notifyOwner": c => c.system.notifyOwner({ title: "Test", content: "Test" }),
};

describe("server authorization", () => {
  it("classifies every registered procedure", () => {
    const paths = [...Object.keys(analyst), ...Object.keys(administrator), "health", "system.health",
      "auth.me", "auth.logout", "auth.demoConfig", "auth.demoSignIn"];
    expect(paths.sort()).toEqual(Object.keys(appRouter._def.procedures).sort());
  });
  it.each(Object.entries(analyst))("%s requires an authenticated identity", async (_path, action) => {
    await expect(action(caller(null))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    for (const role of ["user", "admin"] as const) await action(caller(role));
  });
  it.each(Object.entries(administrator))("%s requires an administrator", async (_path, action) => {
    await expect(action(caller(null))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(action(caller("user"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await action(caller("admin"));
  });
});
