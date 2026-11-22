import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import path from "node:path";
import { access } from "node:fs/promises";
import { createApp } from "./app";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = createApp();
  const server = createServer(app);
  const preferredPort = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(preferredPort) || preferredPort < 1 || preferredPort > 65535) {
    throw new Error("PORT must be an integer from 1 through 65535");
  }
  let port = preferredPort;
  if (process.env.NODE_ENV === "development") {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
    port = await findAvailablePort(preferredPort);
  } else {
    const publicDir = path.join(import.meta.dirname, "public");
    const index = path.join(publicDir, "index.html");
    await access(index);
    app.use(express.static(publicDir));
    app.get("*", (_req, res) => res.sendFile(index));
  }
  server.listen(port, () => console.log(`Listening on port ${port}`));
}

startServer().catch(error => {
  console.error("Startup failed:", error.message);
  process.exitCode = 1;
});
