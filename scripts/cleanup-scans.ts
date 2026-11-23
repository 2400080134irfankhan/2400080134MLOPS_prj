import { pathToFileURL } from "node:url";
import "dotenv/config";
import { getDb } from "../server/db";
import { deleteExpiredScans } from "../server/scan-history";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  try {
    console.log("Expired scan history rows deleted:", await deleteExpiredScans(db));
  } finally {
    await db.$client.promise().end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Scan cleanup failed. Verify database connectivity and scan_history privileges.");
    process.exitCode = 1;
  });
}
