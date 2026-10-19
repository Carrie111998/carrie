import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage, Server } from "http";
import { engine } from "./engine";
import { checkPassword } from "../routes";
import { logger } from "../lib/logger";

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? "/ws", "http://localhost");
    if (!checkPassword(url.searchParams.get("password"))) {
      ws.close(4401, "Password required");
      return;
    }

    const send = (type: string, data: unknown) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, data }));
    };
    const unsubscribe = engine.subscribe(send);
    send("state", engine.publicState());
    send("settings", engine.settings);

    ws.on("message", (raw) => {
      try {
        if (JSON.parse(raw.toString()).type === "ping") send("pong", null);
      } catch {
        /* ignore */
      }
    });
    ws.on("close", () => unsubscribe());
    ws.on("error", (err) => {
      unsubscribe();
      logger.warn({ err }, "WebSocket error");
    });
  });

  logger.info("WebSocket server set up at /ws");
}
