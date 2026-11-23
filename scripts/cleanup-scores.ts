import { pathToFileURL } from "node:url";
import "dotenv/config";
import { getDb } from "../server/db";
import { deleteExpiredScores } from "../server/transaction-db";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  try {
    console.log("Expired scoring requests deleted:", await deleteExpiredScores(db));
  } finally {
    await db.$client.promise().end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Scoring cleanup failed. Verify database connectivity and scoring_requests privileges.");
    process.exitCode = 1;
  });
}
