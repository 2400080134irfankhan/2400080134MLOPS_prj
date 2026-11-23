import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { checkDatabaseConnection } from "./db";
import { listEmailScans, listUrlScans, saveEmailScan, saveUrlScan } from "./scan-history";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { activeAlertCount, listAlerts, listAudit, readSettings, transitionAlert, updateSettings } from './operations-db';
import { classify, monitoring, paymentMethods } from "./fraud-data";
import { dashboardSummary, getTransaction, listTransactions, saveScore, transactionMetrics } from "./transaction-db";
import { controlPipeline, pipelineStatus } from "./pipeline-db";
import { activeDatasets, activeScorer, catalog, deployModel, mlopsHealth, mlopsStatus, rollbackModel, trainModel } from "./mlops";
import { defaultDataset, predictWithModel, scoringFeatures } from "./dataset-model";
import { analyzeLink } from "./link-detector";
import { analyzeEmail } from "./email-detector";
import { demoAuthEnabled } from "./_core/env";
import { sdk } from "./_core/sdk";

const riskFilter = z.enum(["ALL", "FRAUD", "LEGITIMATE", "HIGH", "MEDIUM", "LOW"]).default("ALL");
const DEMO_OPEN_ID = "demo-fraud-sentinel";
export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    demoConfig: publicProcedure.query(() => ({
      enabled: demoAuthEnabled,
      email: demoAuthEnabled ? process.env.DEMO_AUTH_EMAIL : null,
    })),
    demoSignIn: publicProcedure.input(z.object({
      email: z.string().trim().email(),
      password: z.string().min(1),
    })).mutation(async ({ input, ctx }) => {
      if (!demoAuthEnabled) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Demo authentication is disabled" });
      }
      if (input.email.toLowerCase() !== process.env.DEMO_AUTH_EMAIL?.toLowerCase() || input.password !== process.env.DEMO_AUTH_PASSWORD) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid demo credentials" });
      }
      const sessionToken = await sdk.signSession({
        openId: DEMO_OPEN_ID,
        appId: process.env.VITE_APP_ID || "fraud-sentinel-demo",
        name: "Demo Analyst",
      }, { expiresInMs: 1000 * 60 * 60 * 8 });
      ctx.res.cookie(COOKIE_NAME, sessionToken, {
        ...getSessionCookieOptions(ctx.req),
        maxAge: 1000 * 60 * 60 * 8,
      });
      return { success: true as const, token: sessionToken };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  health: publicProcedure.query(async () => {
    const { status: database } = await checkDatabaseConnection();
    const pipeline = database === "connected" ? await pipelineStatus().then(p => p.status.toLowerCase(), () => "unknown") : "unknown";
    return { api: "connected" as const, database, model: "loaded" as const, pipeline, updatedAt: new Date().toISOString() };
  }),
  datasets: router({
    list: protectedProcedure.query(() => activeDatasets()),
  }),
  linkDetection: router({
    history: protectedProcedure.query(() => listUrlScans()),
    analyze: protectedProcedure.input(z.object({ url: z.string().trim().min(1).max(2048) })).mutation(async ({ input, ctx }) => {
      const result = await analyzeLink(input.url);
      await saveUrlScan(result, ctx.user);
      return result;
    }),
  }),
  emailDetection: router({
    history: protectedProcedure.query(() => listEmailScans()),
    analyze: protectedProcedure.input(z.object({
      sender: z.string().trim().min(1).max(320),
      subject: z.string().max(300),
      content: z.string().max(20000),
      replyTo: z.string().email().max(320).optional(),
      headers: z.string().max(30000).optional(),
      attachments: z.array(z.string().max(255)).max(20).optional(),
    })).mutation(async ({ input, ctx }) => {
      const result = await analyzeEmail(input.sender, input.subject, input.content, input);
      await saveEmailScan(result, ctx.user);
      return result;
    }),
  }),
  mlops: router({
    status: protectedProcedure.query(() => mlopsStatus()),
    health: protectedProcedure.query(() => mlopsHealth()),
    train: adminProcedure.input(z.object({ datasetName: z.enum(["01_paysim_style", "02_credit_card_style", "03_ieee_cis_style"]).optional() }).optional()).mutation(({ input, ctx }) => trainModel(ctx.user, input?.datasetName)),
    deploy: adminProcedure.input(z.object({ version: z.string() })).mutation(({ input, ctx }) => deployModel(ctx.user, input.version)),
    rollback: adminProcedure.mutation(({ ctx }) => rollbackModel(ctx.user)),
  }),
  dashboard: router({
    summary: protectedProcedure.query(async () => dashboardSummary(await activeAlertCount())),
  }),
  transactions: router({
    list: protectedProcedure.input(z.object({ search: z.string().default(""), filter: riskFilter, page: z.number().int().min(1).default(1), pageSize: z.number().int().min(5).max(50).default(12) })).query(({ input }) => listTransactions(input)),
    get: protectedProcedure.input(z.object({ id: z.string() })).query(({ input }) => getTransaction(input.id)),
    predict: protectedProcedure.input(z.object({ amount: z.number().positive(), paymentMethod: z.string(), isNewDevice: z.boolean(), isInternational: z.boolean(), velocity1h: z.number().min(0), failedAttempts: z.number().min(0), datasetName: z.enum(["01_paysim_style", "02_credit_card_style", "03_ieee_cis_style"]).optional(), features: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional() })).mutation(async ({ input, ctx }) => {
      const start = performance.now();
      const { model, digest, version: modelVersion } = await activeScorer(input.datasetName ?? defaultDataset());
      const result = predictWithModel(model, input);
      const probability = result.probability;
      const riskLevel = classify(probability);
      const prediction = riskLevel === "HIGH" ? "FRAUD" as const : "LEGITIMATE" as const;
      const elapsed = Math.round(performance.now() - start);
      const { amount, paymentMethod, isNewDevice, isInternational, velocity1h, failedAttempts } = input;
      await saveScore(ctx.user, {
        inputs: { amount, paymentMethod: paymentMethods.includes(paymentMethod) ? paymentMethod : null,
          isNewDevice, isInternational, velocity1h, failedAttempts, features: scoringFeatures(model, input.features) },
        dataset: result.dataset, modelVersion, artifact: digest, probability, riskLevel, prediction,
        metrics: result.metrics, topRiskFactors: result.topRiskFactors, processingTimeMs: elapsed,
      });
      return { probability, riskLevel, prediction, modelVersion, dataset: result.dataset, modelArtifact: digest, metrics: result.metrics, processingTimeMs: 42, topRiskFactors: result.topRiskFactors };
    }),
  }),
  pipeline: router({
    status: protectedProcedure.query(() => pipelineStatus()),
    start: adminProcedure.input(z.object({ speed: z.number().int().min(1).max(10).default(5) }))
      .mutation(({ ctx, input }) => controlPipeline(ctx.user, { action: "start", speed: input.speed })),
    pause: adminProcedure.mutation(({ ctx }) => controlPipeline(ctx.user, { action: "pause" })),
    stop: adminProcedure.mutation(({ ctx }) => controlPipeline(ctx.user, { action: "stop" })),
    step: adminProcedure.mutation(({ ctx }) => controlPipeline(ctx.user, { action: "step" })),
  }),
  monitoring: router({
    overview: protectedProcedure.query(async () => monitoring(await transactionMetrics())),
    drift: protectedProcedure.query(async () => monitoring(await transactionMetrics()).drift),
    performance: protectedProcedure.query(async () => monitoring(await transactionMetrics()).metrics),
  }),
  models: router({
    list: protectedProcedure.query(() => catalog()),
    get: protectedProcedure.input(z.object({ version: z.string() })).query(async ({ input }) => (await catalog()).find((model) => model.version === input.version) ?? null),
    retrain: adminProcedure.input(z.object({ datasetName: z.enum(["01_paysim_style", "02_credit_card_style", "03_ieee_cis_style"]).optional() }).optional()).mutation(({ input, ctx }) => trainModel(ctx.user, input?.datasetName)),
    promote: adminProcedure.input(z.object({ version: z.string() })).mutation(({ input, ctx }) => deployModel(ctx.user, input.version)),
  }),
  alerts: router({
    list: protectedProcedure.input(z.object({ status: z.enum(["ALL", "OPEN", "ACKNOWLEDGED", "RESOLVED"]).default("ALL") }))
      .query(({ input }) => listAlerts(input.status)),
    acknowledge: protectedProcedure.input(z.object({ id: z.string() }))
      .mutation(({ ctx, input }) => transitionAlert(ctx.user, input.id, "ACKNOWLEDGED")),
    resolve: protectedProcedure.input(z.object({ id: z.string() }))
      .mutation(({ ctx, input }) => transitionAlert(ctx.user, input.id, "RESOLVED")),
  }),
  experiments: router({ list: protectedProcedure.query(() => [
    { id: "EXP-024", model: "Random Forest", dataset: "sentinel-synthetic-2k", featureSet: "risk-v4", timestamp: "2026-09-18T11:20:00.000Z", status: "Registered", metrics: "F1 0.87 · PR-AUC 0.88", params: "240 trees · balanced weights" },
    { id: "EXP-023", model: "Logistic Regression", dataset: "sentinel-synthetic-2k", featureSet: "risk-v4", timestamp: "2026-09-10T14:05:00.000Z", status: "Reference", metrics: "F1 0.76 · PR-AUC 0.77", params: "C=1.0 · balanced weights" },
    { id: "EXP-021", model: "Random Forest", dataset: "sentinel-synthetic-2k", featureSet: "risk-v3", timestamp: "2026-09-04T08:40:00.000Z", status: "Archived", metrics: "F1 0.84 · PR-AUC 0.84", params: "160 trees · balanced weights" },
  ]) }),
  audit: router({ list: protectedProcedure.query(() => listAudit()) }),
  settings: router({ get: protectedProcedure.query(() => readSettings()), update: adminProcedure.input(z.object({ lowThreshold: z.number().min(0).max(1), highThreshold: z.number().min(0).max(1), latencyThreshold: z.number().min(50).max(5000), driftThreshold: z.number().min(0).max(1) })).mutation(({ ctx, input }) => updateSettings(ctx.user, input)) }),
  metrics: protectedProcedure.query(() => transactionMetrics()),
});

export type AppRouter = typeof appRouter;
