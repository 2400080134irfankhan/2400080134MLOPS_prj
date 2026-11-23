import "dotenv/config";
import { checkDatabaseConnection, getDb, getUserByOpenId } from "../server/db";

async function verify() {
  try {
    const health = await checkDatabaseConnection();
    if (health.status !== "connected") {
      console.error(`Database is ${health.status}. Check DATABASE_URL and server availability.`);
      process.exitCode = 1;
      return;
    }
    await getUserByOpenId("fraud-sentinel-schema-check");
    console.log("MySQL connected. Drizzle can read the users schema.");
  } finally {
    const db = await getDb();
    await db?.$client.promise().end();
  }
}

verify().catch(() => {
  console.error("Database verification failed. Check the users migration and account permissions.");
  process.exitCode = 1;
});
