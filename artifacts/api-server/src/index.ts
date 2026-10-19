import { createServer } from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { setupWebSocket } from "./bot/websocket";
import { resumeEngines, runCollective } from "./bot/engine";
import { listUsers } from "./auth";

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

// Resume paper bots that were running before a restart.
resumeEngines(listUsers().filter((u) => !u.held).map((u) => u.id));

// Pool every user's settled trades into the community dataset now and every 10 minutes.
setTimeout(runCollective, 20_000);
setInterval(runCollective, 10 * 60_000);

server.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening with WebSocket support");
});
