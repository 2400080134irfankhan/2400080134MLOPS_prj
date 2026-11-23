import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parse } from "dotenv";

// Work only on the ignored local env, preserving unrelated settings and comments.
const file = ".env";
const source = readFileSync(existsSync(file) ? file : ".env.example", "utf8");
const config = parse(source);
const port = config.MYSQL_PORT || "3306";
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error("Set MYSQL_PORT to a valid local TCP port");
}
const localUrl = password => `mysql://fraud_app:${encodeURIComponent(password)}@127.0.0.1:${port}/fraud_sentinel`;
if (config.DATABASE_URL || config.MYSQL_PASSWORD || config.MYSQL_ROOT_PASSWORD) {
  if (config.MYSQL_PASSWORD && config.MYSQL_ROOT_PASSWORD && config.DATABASE_URL === localUrl(config.MYSQL_PASSWORD)) {
    console.log("Local MySQL credentials are already configured.");
  } else {
    throw new Error("Existing database settings found. Review .env privately before changing the local target.");
  }
} else {
  const password = randomBytes(32).toString("hex");
  const settings = {
    MYSQL_PORT: port, MYSQL_PASSWORD: password,
    MYSQL_ROOT_PASSWORD: randomBytes(32).toString("hex"), DATABASE_URL: localUrl(password),
  };
  let updated = source;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  for (const [key, value] of Object.entries(settings)) {
    const assignment = new RegExp(`^(?:export[ \\t]+)?${key}[ \\t]*=[^\\r\\n]*`, "gm");
    if (updated.match(assignment)) updated = updated.replace(assignment, `${key}=${value}`);
    else updated = updated.trimEnd() + newline + `${key}=${value}` + newline;
  }
  writeFileSync(file, updated, { mode: 0o600 });
  console.log("Configured local MySQL in .env.");
}
