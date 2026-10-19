import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage, Server } from "http";
import { getEngine } from "./engine";
import { userFromToken } from "../auth";
import { logger } from "../lib/logger";

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? "/ws", "http://localhost");
    const user = userFromToken(url.searchParams.get("token"));
    if (!user) {
      ws.close(4401, "Please log in");
      return;
    }
    const engine = getEngine(user.id);

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
