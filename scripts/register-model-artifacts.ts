import "dotenv/config";
import { getDb } from "../server/db";
import { registerLegacy } from "../server/model-db";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  try {
    console.log(await registerLegacy(db));
  } finally {
    await db.$client.promise().end();
  }
}

main().catch(() => {
  console.error("Artifact registration failed. Check migration 0003, immutable content and the approved registry baseline.");
  process.exitCode = 1;
});
