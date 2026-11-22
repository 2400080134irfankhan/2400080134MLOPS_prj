import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

// Run against a built release directory. All identities and settings are disposable.
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const cwd = process.argv[2] ?? process.cwd();
const env = {
  ...process.env, PORT: String(port), NODE_ENV: "production", JWT_SECRET: randomBytes(32).toString("hex"),
  DEMO_AUTH_ENABLED: "false", DATABASE_URL: "mysql://127.0.0.1/unused",
  OAUTH_SERVER_URL: "https://oauth.invalid", VITE_APP_ID: "smoke", CLIENT_ORIGIN: "",
  DOTENV_CONFIG_PATH: ".unused-smoke-env",
};
const entry = ["dist/index.js"];
const startupTimeoutMs = 45_000;
for (const [setting, value] of [["JWT_SECRET", ""], ["DEMO_AUTH_ENABLED", "true"]]) {
  const result = spawnSync(process.execPath, entry, { cwd, env: { ...env, [setting]: value },
    encoding: "utf8", timeout: startupTimeoutMs });
  if (result.error) throw new Error(`Failed to run startup check for ${setting}`, { cause: result.error });
  assert.equal(result.status, 1, setting);
  assert.ok(result.stderr.includes(setting), setting);
}
const server = spawn(process.execPath, entry, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
const closed = once(server, "close");
let output = "";
server.stdout.on("data", chunk => { output += chunk; });
server.stderr.on("data", chunk => { output += chunk; });
const get = path => fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(5000) });
try {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline && !output.includes(`Listening on port ${port}`)) {
    assert.equal(server.exitCode, null, output);
    await delay(100);
  }
  assert.ok(output.includes(`Listening on port ${port}`), output);
  assert.equal((await (await get("/api/health")).json()).status, "ok");
  const html = await (await get("/transactions")).text();
  assert.match(html, /id="root"/);
  const asset = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(asset);
  assert.match((await get(asset)).headers.get("content-type"), /javascript/);
  assert.equal((await get("/api/trpc/dashboard.summary")).status, 401);
  assert.equal((await get("/manus-storage/test")).status, 401);
  assert.equal((await get("/api/unknown")).status, 404);
  assert.equal((await get("/api/oauth/callback")).status, 400);
  const config = await (await get("/api/trpc/auth.demoConfig")).json();
  assert.deepEqual(config.result.data.json, { enabled: false, email: null });
  console.log("Production startup, fail-closed configuration, assets, health and access checks passed.");
} finally {
  server.kill();
  await closed;
}
