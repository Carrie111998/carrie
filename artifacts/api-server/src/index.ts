import { createServer } from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { setupWebSocket } from "./bot/websocket";
import { initBrain, resumeEngines, runCollective } from "./bot/engine";
import { isAdmin, listUsers } from "./auth";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);

setupWebSocket(server);

// The shared brain starts from the admin's strategy settings the first time.
initBrain(listUsers().filter((u) => isAdmin(u)).map((u) => u.id));

// Resume paper bots that were running before a restart.
resumeEngines(listUsers().filter((u) => !u.held).map((u) => u.id));

// Pool every user's settled trades into the community dataset now and every 10 minutes.
setTimeout(() => void runCollective(), 20_000);
setInterval(() => void runCollective(), 10 * 60_000);

server.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening with WebSocket support");
});
