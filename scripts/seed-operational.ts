import "dotenv/config";
import { getDb } from "../server/db";
import { operationalSeedVersion } from "../server/fraud-data";
import { seedOperational } from "../server/seed-operational";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  try {
    console.log(operationalSeedVersion, await seedOperational(db));
  } finally {
    await db.$client.promise().end();
  }
}

main().catch(() => {
  console.error("Seed failed. Verify connectivity, migrations and conflicting fixture IDs. No partial seed was committed.");
  process.exitCode = 1;
});
