import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve, join } from "node:path";
import XLSX from "xlsx";
import { datasetNames, loadRows } from "./dataset-model";
import { registerLegacy, scorerFor, manifestFor } from "./model-db";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createTRPCClient, httpLink } from "@trpc/client";
import { and, count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { SignJWT } from "jose";
import superjson from "superjson";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { alerts, appSettings, auditEvents, users, scanHistory, transactions, modelArtifacts, modelRuns, modelDeploymentState, modelVersions, scoringRequests, pipelineState } from "../drizzle/schema";
import { deleteExpiredScores } from "./transaction-db";
import { deleteExpiredScans } from "./scan-history";
import { createOperationalFixtures, getMetrics, summary } from "./fraud-data";
import { seedOperational } from "./seed-operational";
import type { AppRouter } from "./routers";

const url = process.env.OPERATIONS_TEST_DATABASE_URL;
const secret = randomBytes(32).toString("hex");
const defaults = { lowThreshold: 0.3, highThreshold: 0.7, latencyThreshold: 500, driftThreshold: 0.25 };

describe.skipIf(!url)("MySQL operational procedures", () => {
  let db: ReturnType<typeof drizzle>;
  let server: ChildProcess;
  let endpoint: string;
  let analyst: ReturnType<typeof client>;
  let admin: ReturnType<typeof client>;
  let probe: ReturnType<typeof client>;

  function client(token?: string, address = endpoint) {
    return createTRPCClient<AppRouter>({ links: [httpLink({
      url: address, transformer: superjson, headers: token ? { authorization: "Bearer " + token } : {},
    })] });
  }
  async function signedIn(openId: string, address = endpoint) {
    const token = await new SignJWT({ openId, appId: "operations-test", name: "Ignored JWT label" })
      .setProtectedHeader({ alg: "HS256" }).setExpirationTime("10m").sign(Buffer.from(secret));
    return client(token, address);
  }
  async function launch(datasetDirectory?: string) {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      if (process.env.TEST_SCORER_DIRECTORY) process.chdir(process.env.TEST_SCORER_DIRECTORY);
      const { createApp } = await import("./server/_core/app.ts");
      const server = createApp().listen(0, "127.0.0.1", () => process.send(server.address().port));
    `], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, TEST_SCORER_DIRECTORY: datasetDirectory ?? "", DATABASE_URL: url, NODE_ENV: "development", JWT_SECRET: secret,
        OWNER_OPEN_ID: "", VITE_APP_ID: "operations-test", DEMO_AUTH_ENABLED: "true",
        DEMO_AUTH_EMAIL: "demo@example.invalid", DEMO_AUTH_PASSWORD: secret },
    });
    const port = await new Promise<number>((resolve, reject) => {
      child.once("message", port => resolve(Number(port)));
      child.once("error", reject);
      child.once("exit", () => reject(new Error("Test server exited before startup")));
    });
    return { server: child, endpoint: `http://127.0.0.1:${port}/api/trpc` };
  }
  async function start() {
    ({ server, endpoint } = await launch());
    analyst = await signedIn("integration-analyst");
    admin = await signedIn("integration-admin");
    probe = await signedIn("integration-probe");
  }
  async function stop(child = server) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const closed = once(child, "close");
    child.kill();
    await closed;
  }
  beforeAll(async () => {
    const target = new URL(url!);
    if (target.hostname !== "127.0.0.1" || target.pathname !== "/fraud_sentinel_operations_test") {
      throw new Error("Use a fresh disposable loopback fraud_sentinel_operations_test database");
    }
    db = drizzle(url!);
    expect(await seedOperational(db)).toBe("initialized");
    await db.insert(users).values([
      { openId: "integration-analyst", name: "Integration Analyst" },
      { openId: "integration-admin", name: "Integration Admin", role: "admin" },
      { openId: "integration-probe", name: "Rollback probe", role: "admin" },
    ]);
    await db.execute(sql`CREATE TRIGGER fail_probe_audit BEFORE INSERT ON audit_events FOR EACH ROW
      BEGIN IF NEW.actor_label = 'Rollback probe' AND NEW.event <> 'Model registered' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test failure'; END IF; END`);
    await start();
  }, 30_000);
  afterAll(async () => { await stop(); await db?.$client.promise().end(); });

  it("registers only the approved legacy release once and refuses an unbound rollback", async () => {
    await expect(analyst.transactions.predict.mutate(scoreInput)).rejects.toMatchObject({ data: { code: "CONFLICT" } });
    const pointers = await db.select().from(modelDeploymentState);
    await db.execute(sql`CREATE TRIGGER fail_cutover BEFORE INSERT ON audit_events FOR EACH ROW
      BEGIN IF NEW.event='Legacy Node scorers registered' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test failure'; END IF; END`);
    await expect(registerLegacy(db)).rejects.toThrow();
    expect(await db.select().from(modelArtifacts)).toHaveLength(0);
    expect((await db.select().from(modelVersions)).every(row => row.artifact === null)).toBe(true);
    await db.execute(sql`DROP TRIGGER fail_cutover`);
    expect((await Promise.all([registerLegacy(db), registerLegacy(db)])).sort()).toEqual(["already registered", "registered"]);
    expect(await registerLegacy(db)).toBe("already registered");
    expect(await db.select().from(modelDeploymentState)).toEqual(pointers);
    expect(await db.select({ n: count() }).from(modelArtifacts)).toEqual([{ n: 4 }]);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.event, "Legacy Node scorers registered"))).toHaveLength(1);
    expect((await db.select().from(modelVersions)).filter(v => !v.artifact).map(v => v.version).sort()).toEqual(["baseline-1", "v1.1.0"]);
    const release = await manifestFor(db, "v1.2.0");
    await expect(scorerFor(db, { ...release, datasets: { ...release.datasets, [datasetNames[0]]: "0".repeat(64) } }, datasetNames[0])).rejects.toThrow();
    await expect(admin.mlops.rollback.mutate()).rejects.toMatchObject({ data: { code: "CONFLICT" } });
    const [artifact] = await db.select().from(modelArtifacts).limit(1);
    await expect(db.update(modelArtifacts).set({ payload: "corrupt" }).where(eq(modelArtifacts.digest, artifact.digest))).rejects.toThrow();
    await expect(db.delete(modelArtifacts).where(eq(modelArtifacts.digest, artifact.digest))).rejects.toThrow();
  });
  it("matches literal substring, prediction and risk filters with accurate page totals", async () => {
    const rows = createOperationalFixtures().transactions.slice(0, 1885).reverse();
    for (const search of ["txn-100", rows[0].customerId, rows[0].merchantId, "oRbIt", "%", "_", "!"]) {
      for (const filter of ["ALL", "FRAUD", "LEGITIMATE", "LOW", "MEDIUM", "HIGH"] as const) {
        const filtered = rows.filter(r => (filter === "ALL" || filter === r.riskLevel || filter === r.prediction)
          && [r.id, r.customerId, r.merchantId, r.merchantName].some(s => s.toLowerCase().includes(search.toLowerCase())));
        expect(await analyst.transactions.list.query({ search, filter, page: 2, pageSize: 5 })).toEqual({
          rows: filtered.slice(5, 10), total: filtered.length, pageSize: 5, page: 2,
        });
      }
    }
  }, 30_000);
  it("preserves dashboard, trend, latency, recent ordering and monitoring metrics", async () => {
    const rows = createOperationalFixtures().transactions.slice(0, 1885);
    expect(await analyst.dashboard.summary.query()).toEqual(summary(3, rows, rows.slice(-8).reverse()));
    const expected = getMetrics(rows);
    expect(await analyst.metrics.query()).toEqual(expected);
    expect(await analyst.monitoring.performance.query()).toEqual(expected);
  });
  const scoreInput = {
    amount: 1450, paymentMethod: "private-text", isNewDevice: true, isInternational: true, velocity1h: 8,
    failedAttempts: 3, features: { transaction_type: "TRANSFER", name_orig: "private-origin", velocity_1h: 7, note: "private-note" },
  };
  it("persists sanitized scoring evidence and actor without changing either cursor or stream totals", async () => {
    const before = await analyst.pipeline.status.query();
    const dbCursor = await db.select().from(pipelineState);
    const result = await analyst.transactions.predict.mutate(scoreInput);
    const [user] = await db.select().from(users).where(eq(users.openId, "integration-analyst"));
    const [row] = await db.select().from(scoringRequests);
    expect(row).toMatchObject({
      id: expect.any(Number), createdAt: expect.any(Date), actorKind: "user", actorUserId: user.id, dataset: result.dataset,
      modelVersion: result.modelVersion, artifact: result.modelArtifact, probability: result.probability, prediction: result.prediction,
      riskLevel: result.riskLevel, topRiskFactors: result.topRiskFactors,
    });
    for (const key of ["precision", "recall", "f1", "prAuc"] as const) {
      expect(row.metrics[key]).toBeCloseTo(result.metrics[key], 14);
    }
    expect(row.processingTimeMs).toBeGreaterThanOrEqual(0);
    expect(row.inputs).toEqual({ ...scoreInput, paymentMethod: null, features: { transaction_type: "TRANSFER", velocity_1h: 7 } });
    expect(await analyst.pipeline.status.query()).toEqual(before);
    expect(await db.select().from(pipelineState)).toEqual(dbCursor);
    expect((await db.select({ n: count() }).from(transactions))[0].n).toBe(2000);
    expect((await analyst.transactions.list.query({})).total).toBe(before.processed);
  });
  it("allocates distinct candidates across two processes and durably rejects unchanged refits", async () => {
    const other = await launch();
    try {
      const second = await signedIn("integration-admin", other.endpoint);
      const outcomes = await Promise.all([admin.mlops.train.mutate(), second.models.retrain.mutate()]);
      expect(outcomes.map(s => s.latestRun!.version).sort()).toEqual(["v1.2.1", "v1.2.2"]);
      expect(outcomes.every(s => s.latestRun!.stage === "FAILED")).toBe(true);
      await stop();
      await start();
      for (const s of outcomes) {
        const version = s.latestRun!.version;
        expect((await analyst.models.get.query({ version }))?.status).toBe("Rejected");
        await expect(admin.models.promote.mutate({ version })).rejects.toMatchObject({ data: { code: "CONFLICT" } });
      }
      const before = await db.select().from(modelDeploymentState);
      const counts = () => Promise.all([modelVersions, modelRuns, modelArtifacts, auditEvents].map(t => db.select({ n: count() }).from(t)));
      const n = await counts();
      await expect(probe.mlops.train.mutate()).rejects.toMatchObject({ data: { code: "INTERNAL_SERVER_ERROR" } });
      expect(await db.select().from(modelDeploymentState)).toEqual(before);
      expect(await counts()).toEqual(n);
    } finally { await stop(other.server); }
  }, 30_000);

  it("promotes real fitted artifacts, rejects stale siblings and restores exact outputs after restart and rollback", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fraud-scorer-fixture-"));
    let trainer: ChildProcess | undefined;
    try {
      // Isolated synthetic training inputs. The serving process keeps the original checkout.
      for (const folder of ["datasets", "data/reputation"]) await cp(folder, join(directory, folder), { recursive: true });
      const dataset = datasetNames[0];
      const template = loadRows(dataset, "train_80")[0];
      for (const split of ["train_80", "test_20"]) {
        const rows = Array.from({ length: 60 }, (_, i) => ({ ...template, amount: i % 2 ? 15 : 1450, is_fraud: i % 2 }));
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), "transactions");
        XLSX.writeFile(book, join(directory, "datasets", dataset, split + ".xlsx"));
      }
      const other = await launch(directory);
      trainer = other.server;
      const second = await signedIn("integration-admin", other.endpoint);
      const failing = await signedIn("integration-probe", other.endpoint);
      await expect(failing.mlops.train.mutate()).rejects.toMatchObject({ data: { code: "INTERNAL_SERVER_ERROR" } });
      const first = await second.mlops.train.mutate();
      const sibling = await second.mlops.train.mutate();
      const version = first.latestRun!.version;
      expect(first.latestRun).toMatchObject({ version: "v1.2.3", stage: "READY", metrics: { precision: 1, recall: 1, f1: 1, prAuc: 1 } });
      const scores = () => Promise.all(datasetNames.map(datasetName => analyst.transactions.predict.mutate({ ...scoreInput, datasetName })));
      const before = await scores();
      const pointers = () => db.select().from(modelDeploymentState);
      const pre = await pointers();
      await expect(probe.mlops.deploy.mutate({ version })).rejects.toMatchObject({ data: { code: "INTERNAL_SERVER_ERROR" } });
      expect(await pointers()).toEqual(pre);
      expect((await analyst.models.get.query({ version }))?.status).toBe("Ready");
      await admin.models.promote.mutate({ version });
      await stop();
      await start();
      const after = await scores();
      expect((await analyst.datasets.list.query()).map(d => d.modelVersion)).toEqual(after.map(s => s.modelArtifact));
      expect(after[0].modelVersion).toBe(version);
      expect(after[0].modelArtifact).not.toBe(before[0].modelArtifact);
      expect(after[0].probability).toBe(0);
      expect(before[0].probability).toBeGreaterThan(0);
      for (const i of [1, 2]) expect(after[i]).toEqual({ ...before[i], modelVersion: version });
      expect(await db.select().from(scoringRequests).where(eq(scoringRequests.modelVersion, version))).toHaveLength(3);
      await expect(admin.mlops.deploy.mutate({ version: sibling.latestRun!.version })).rejects.toMatchObject({ data: { code: "CONFLICT" } });
      const deployed = await pointers();
      await expect(probe.mlops.rollback.mutate()).rejects.toMatchObject({ data: { code: "INTERNAL_SERVER_ERROR" } });
      expect(await pointers()).toEqual(deployed);
      await admin.mlops.rollback.mutate();
      await stop();
      await start();
      expect(await scores()).toEqual(before);
      expect((await analyst.mlops.status.query()).previousVersion).toBe(version);
      expect(await db.select().from(auditEvents).where(eq(auditEvents.actorLabel, "Rollback probe"))).toEqual([]);
    } finally {
      if (trainer) await stop(trainer);
      const target = resolve(directory);
      if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("fraud-scorer-fixture-")) throw new Error("Unexpected fixture directory");
      await rm(target, { recursive: true, force: true });
    }
  }, 45_000);
  it("expires only scoring requests strictly older than the 90-day boundary", async () => {
    const [template] = await db.select().from(scoringRequests).limit(1);
    const { id, createdAt, ...fields } = template;
    await db.transaction(async tx => {
      await tx.execute(sql`SET timestamp = UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))`);
      try {
        const before = await tx.select({ n: count() }).from(transactions);
        await tx.insert(scoringRequests).values([-1, 0].map(ms => ({
          ...fields, createdAt: sql`FROM_UNIXTIME(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) - 90 * 86400 + ${ms} / 1000)`,
        })));
        expect(await deleteExpiredScores(tx)).toBe(1);
        expect(await deleteExpiredScores(tx)).toBe(0);
        expect(await tx.select({ n: count() }).from(transactions)).toEqual(before);
      } finally {
        await tx.execute(sql`SET timestamp = DEFAULT`);
      }
    });
  });
  it("returns a scoring error when MySQL rejects the insert", async () => {
    const before = await db.select().from(scoringRequests);
    await db.execute(sql`CREATE TRIGGER fail_score BEFORE INSERT ON scoring_requests FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test failure'`);
    await expect(analyst.transactions.predict.mutate(scoreInput)).rejects.toMatchObject({ data: { code: "INTERNAL_SERVER_ERROR" } });
    expect(await db.select().from(scoringRequests)).toEqual(before);
  });
  it("lists seeded alerts with the original fields, ordering and filters", async () => {
    const all = await analyst.alerts.list.query({});
    expect(all.map(r => r.id)).toEqual(["ALT-001", "ALT-002", "ALT-003", "ALT-004"]);
    expect(Object.keys(all[0]).sort()).toEqual(["affectedMetric", "createdAt", "description", "id", "severity", "status", "type"]);
    expect((await analyst.alerts.list.query({ status: "OPEN" })).map(r => r.id)).toEqual(["ALT-001", "ALT-003"]);
  });
  it("acknowledges concurrent requests once and records the authenticated actor", async () => {
    const input = { id: "ALT-001" };
    await Promise.all([analyst.alerts.acknowledge.mutate(input), analyst.alerts.acknowledge.mutate(input)]);
    expect(await db.select().from(alerts).where(eq(alerts.id, input.id))).toMatchObject([{ status: "ACKNOWLEDGED" }]);
    const [user] = await db.select().from(users).where(eq(users.openId, "integration-analyst"));
    expect(await db.select().from(auditEvents).where(eq(auditEvents.resourceId, input.id))).toMatchObject([{
      actorUserId: user.id, actorLabel: user.name, actorKind: "user", changes: { before: "OPEN", after: "ACKNOWLEDGED" },
    }]);
  });
  it("persists resolution and reflects it in the dashboard and audit list", async () => {
    await analyst.alerts.resolve.mutate({ id: "ALT-001" });
    await analyst.alerts.resolve.mutate({ id: "ALT-001" });
    expect((await analyst.dashboard.summary.query()).activeAlerts).toBe(2);
    const events = (await analyst.audit.list.query()).filter(row => row.resource === "ALT-001");
    expect(events.map(row => row.event)).toEqual(["Alert resolved", "Alert acknowledged"]);
    expect(Object.keys(events[0]).sort()).toEqual(["details", "event", "id", "resource", "timestamp", "user"]);
    expect(events[0].user).toBe("Integration Analyst");
  });
  it("rejects unknown IDs without recording an event", async () => {
    for (const action of [analyst.alerts.resolve, analyst.alerts.acknowledge]) {
      await expect(action.mutate({ id: "absent" })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    }
    expect(await db.select().from(auditEvents).where(eq(auditEvents.resourceId, "absent"))).toEqual([]);
  });
  it("reads seeded settings and rejects unauthorized writes", async () => {
    expect(await analyst.settings.get.query()).toEqual(defaults);
    await expect(client().settings.update.mutate(defaults)).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
    await expect(analyst.settings.update.mutate(defaults)).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });
  it("persists admin settings and records the before and after thresholds", async () => {
    const after = { ...defaults, driftThreshold: 0.15 };
    expect(await admin.settings.update.mutate(after)).toEqual(after);
    expect(await analyst.settings.get.query()).toEqual(after);
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.actorLabel, "Integration Admin"), eq(auditEvents.resourceType, "settings"))))
      .toMatchObject([{ changes: { before: defaults, after } }]);
    expect((await admin.mlops.train.mutate()).gates.drift).toBe(false);
  });
  it("records development demo actions without a users foreign key", async () => {
    const demo = await signedIn("demo-fraud-sentinel");
    await demo.alerts.acknowledge.mutate({ id: "ALT-003" });
    expect(await db.select().from(auditEvents).where(eq(auditEvents.actorKind, "demo")))
      .toMatchObject([{ actorUserId: null, actorLabel: "Demo Analyst" }]);
  });
  it("rolls back both alert and settings updates if the audit insert fails", async () => {
    const before = await db.select().from(appSettings);
    await expect(probe.alerts.resolve.mutate({ id: "ALT-003" })).rejects.toMatchObject({ data: { code: "INTERNAL_SERVER_ERROR" } });
    await expect(probe.settings.update.mutate(defaults)).rejects.toMatchObject({ data: { code: "INTERNAL_SERVER_ERROR" } });
    expect(await db.select().from(appSettings)).toEqual(before);
    expect(await db.select().from(alerts).where(eq(alerts.id, "ALT-003"))).toMatchObject([{ status: "ACKNOWLEDGED" }]);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.actorLabel, "Rollback probe"))).toEqual([]);
  });
  it("stores an attributed URL snapshot without URL secrets or invalid input", async () => {
    const url = "http://127.0.0.1/private-path?token=private-query#private-fragment";
    const live = await analyst.linkDetection.analyze.mutate({ url });
    expect(live.normalizedUrl).toBe(url);
    const [history] = await analyst.linkDetection.history.query();
    expect(history).toEqual({ ...live, normalizedUrl: "http://127.0.0.1/" });
    for (const input of ["http://private-user:private-password@localhost/", "private-scheme:private-payload"]) {
      await analyst.linkDetection.analyze.mutate({ url: input });
    }
    const [user] = await db.select().from(users).where(eq(users.openId, "integration-analyst"));
    const rows = await db.select().from(scanHistory).where(eq(scanHistory.kind, "URL"));
    expect(rows).toHaveLength(3);
    expect(rows.every(row => row.actorUserId === user.id && row.actorKind === "user")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("private-");
  });
  it("stores nested links only inside the email and omits raw message fields", async () => {
    const before = await analyst.linkDetection.history.query();
    const email = await analyst.emailDetection.analyze.mutate({
      sender: "private-mailbox@example.org", subject: "private-subject", content: "private-body http://127.0.0.1/private-link",
      headers: "X-Test: private-header", attachments: ["private-file.zip"], replyTo: "private-reply@example.org",
    });
    expect(email.sender).toBe("private-mailbox@example.org");
    const [history] = await analyst.emailDetection.history.query();
    expect(history).toMatchObject({ sender: "example.org", verdict: email.verdict, links: [{ normalizedUrl: "http://127.0.0.1/" }] });
    expect(await analyst.linkDetection.history.query()).toEqual(before);
    await analyst.emailDetection.analyze.mutate({ sender: "name@private-data.example/path", subject: "", content: "" });
    expect(JSON.stringify(await db.select().from(scanHistory).where(eq(scanHistory.kind, "EMAIL")))).not.toContain("private-");
  });
  it("returns the latest ten for each scan type in stable order", async () => {
    for (let i = 1; i <= 11; i++) {
      await analyst.linkDetection.analyze.mutate({ url: "http://127.0.0." + i });
      await analyst.emailDetection.analyze.mutate({ sender: "a@d" + i + ".test", subject: "", content: "" });
    }
    const descending = Array.from({ length: 10 }, (_, i) => 11 - i);
    expect((await analyst.linkDetection.history.query()).map(r => r.hostname)).toEqual(descending.map(i => "127.0.0." + i));
    expect((await analyst.emailDetection.history.query()).map(r => r.senderDomain)).toEqual(descending.map(i => "d" + i + ".test"));
  });
  it("rejects both scan submissions when their insert fails", async () => {
    await db.execute(sql`CREATE TRIGGER fail_scan BEFORE INSERT ON scan_history FOR EACH ROW
      BEGIN IF NEW.actor_user_id = (SELECT id FROM users WHERE openId='integration-probe')
      THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test failure'; END IF; END`);
    const before = await db.select({ n: count() }).from(scanHistory);
    await expect(probe.linkDetection.analyze.mutate({ url: "invalid:" })).rejects.toMatchObject({ data: { code: "INTERNAL_SERVER_ERROR" } });
    await expect(probe.emailDetection.analyze.mutate({ sender: "invalid", subject: "", content: "" })).rejects.toMatchObject({ data: { code: "INTERNAL_SERVER_ERROR" } });
    expect(await db.select({ n: count() }).from(scanHistory)).toEqual(before);
  });
  it("deletes only scans strictly older than 90 days at millisecond precision", async () => {
    await db.transaction(async tx => {
      await tx.execute(sql`SET timestamp = UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))`);
      try {
        const permanentCounts = () => Promise.all([transactions, alerts, auditEvents, modelVersions].map(table => tx.select({ n: count() }).from(table)));
        const before = await permanentCounts();
        const fixtures = [-1, 0, 1].map((ms, i) => ({
          kind: i === 1 ? "EMAIL" as const : "URL" as const, actorKind: "system" as const,
          verdict: "retention-test", riskScore: 0, formatVersion: 1, result: { ms },
          createdAt: sql`FROM_UNIXTIME(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) - 90 * 86400 + ${ms} / 1000)`,
        }));
        await tx.insert(scanHistory).values(fixtures);
        expect(await deleteExpiredScans(tx)).toBe(1);
        expect(await deleteExpiredScans(tx)).toBe(0);
        const kept = await tx.select({ result: scanHistory.result }).from(scanHistory).where(eq(scanHistory.verdict, "retention-test")).orderBy(scanHistory.id);
        expect(kept).toEqual([{ result: { ms: 0 } }, { result: { ms: 1 } }]);
        expect(await permanentCounts()).toEqual(before);
      } finally {
        await tx.execute(sql`SET timestamp = DEFAULT`);
      }
    });
  });
  it("serves both sanitized histories unchanged after restarting Node", async () => {
    const read = () => Promise.all([analyst.linkDetection.history.query(), analyst.emailDetection.history.query()]);
    const before = await read();
    expect(before.map(rows => rows.length)).toEqual([10, 10]);
    await stop();
    await start();
    expect(await read()).toEqual(before);
  }, 30_000);
  it("serves the same persisted results after a Node process restart", async () => {
    const read = () => Promise.all([analyst.alerts.list.query({}), analyst.audit.list.query(), analyst.settings.get.query()]);
    const before = await read();
    await stop();
    await start();
    expect(await read()).toEqual(before);
  }, 30_000);
  it("preserves running, paused and stopped state across independent Node restarts", async () => {
    const initial = await analyst.pipeline.status.query();
    expect(initial).toEqual(createOperationalFixtures().pipeline);
    const running = await admin.pipeline.start.mutate({ speed: 10 });
    expect(running).toMatchObject({ ...initial, status: "RUNNING", speed: 10, startedAt: expect.any(String) });
    for (const expected of ["RUNNING", "PAUSED", "STOPPED"] as const) {
      if (expected === "PAUSED") await admin.pipeline.pause.mutate();
      if (expected === "STOPPED") await admin.pipeline.stop.mutate();
      const before = await admin.pipeline.step.mutate();
      await stop();
      await start();
      expect(await analyst.pipeline.status.query()).toEqual(before);
      expect(before).toMatchObject({ status: expected, startedAt: running.startedAt, speed: 10 });
      expect((await analyst.transactions.list.query({})).total).toBe(before.cursor);
      expect((await analyst.dashboard.summary.query()).recentTransactions[0].id).toBe(before.lastTransactionId);
      expect((await analyst.monitoring.performance.query()).total).toBe(before.cursor);
      expect((await client().health.query()).pipeline).toBe(expected.toLowerCase());
    }
  }, 30_000);
  it("serializes control and step requests from two Node processes", async () => {
    const other = await launch();
    try {
      const second = await signedIn("integration-admin", other.endpoint);
      const before = await analyst.pipeline.status.query();
      const [stored] = await db.select().from(pipelineState);
      const steps = Array.from({ length: 20 }, (_, i) => (i % 2 ? admin : second).pipeline.step.mutate());
      const [results] = await Promise.all([Promise.all(steps), admin.pipeline.start.mutate({ speed: 2 }), second.pipeline.pause.mutate()]);
      expect(results.map(r => r.cursor).sort((a,b) => a-b)).toEqual(steps.map((_, i) => before.cursor + i + 1));
      expect(new Set(results.map(r => r.lastTransactionId)).size).toBe(20);
      const final = await second.pipeline.status.query();
      expect(await analyst.pipeline.status.query()).toEqual(final);
      expect(final).toMatchObject({ cursor: before.cursor + 20, speed: 2, startedAt: before.startedAt });
      const events = await db.select().from(auditEvents).where(eq(auditEvents.resourceType, "pipeline")).orderBy(auditEvents.eventOrder);
      const recent = events.slice(-22);
      let current = before;
      for (const event of recent) {
        expect(event.actorLabel).toBe("Integration Admin");
        const changes = event.changes as { before: typeof before; after: typeof before };
        expect(changes.before).toEqual(current);
        current = changes.after;
      }
      expect(current).toEqual(final);
      expect(await db.select().from(pipelineState)).toMatchObject([{ revision: stored.revision + 22 }]);
      expect(await db.select({ n: count() }).from(transactions)).toEqual([{ n: 2000 }]);
    } finally {
      await stop(other.server);
    }
  }, 30_000);
  it("rolls back pipeline progress, controls and revision if auditing fails", async () => {
    const before = await db.select().from(pipelineState);
    const run = [() => probe.pipeline.start.mutate({ speed: 7 }), () => probe.pipeline.step.mutate(),
      () => probe.pipeline.stop.mutate(), () => probe.pipeline.pause.mutate()];
    for (const action of run) {
      await expect(action()).rejects.toMatchObject({ data: { code: "INTERNAL_SERVER_ERROR" } });
      expect(await db.select().from(pipelineState)).toEqual(before);
    }
    expect(await db.select().from(auditEvents).where(eq(auditEvents.actorLabel, "Rollback probe"))).toEqual([]);
  });
  it("reads all 2,000 unchanged stream records through paginated API queries", async () => {
    const fixture = createOperationalFixtures();
    const unseen = fixture.transactions.at(-1)!;
    expect(await analyst.transactions.get.query({ id: unseen.id })).toEqual(unseen);
    for (const id of ["missing", unseen.id.toLowerCase(), unseen.id + " "]) {
      expect(await analyst.transactions.get.query({ id })).toBeNull();
    }
    const initial = await analyst.transactions.list.query({});
    expect(initial.total).toBe((await analyst.pipeline.status.query()).cursor);
    for (let i = initial.total; i < fixture.transactions.length; i++) await admin.pipeline.step.mutate();
    const pages = [];
    for (let page = 1; page <= 40; page++) {
      const result = await analyst.transactions.list.query({ page, pageSize: 50 });
      expect(result).toMatchObject({ page, pageSize: 50, total: 2000 });
      pages.push(...result.rows);
    }
    expect(pages).toEqual([...fixture.transactions].reverse());
    expect((await analyst.transactions.list.query({ page: 41, pageSize: 50 })).rows).toEqual([]);
    const finished = await analyst.pipeline.status.query();
    const [row] = await db.select().from(pipelineState);
    expect(await admin.pipeline.step.mutate()).toEqual(finished);
    expect(await db.select().from(pipelineState)).toEqual([row]);
    await stop();
    await start();
    expect(await analyst.pipeline.status.query()).toEqual(finished);
  }, 60_000);
});
