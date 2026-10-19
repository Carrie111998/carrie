import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage, Server } from "http";
import { botState } from "./state";
import { logger } from "../lib/logger";

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    logger.info({ ip: req.socket.remoteAddress }, "WebSocket client connected");

    const send = (msg: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    };

    botState.registerWsClient(send);

    // Send current state immediately on connect
    ws.send(JSON.stringify({ type: "status", data: botState.status }));
    ws.send(JSON.stringify({ type: "active_trades", data: Array.from(botState.activeTrades.values()) }));
    if (botState.markets.length > 0) {
      ws.send(JSON.stringify({ type: "market_update", data: botState.markets }));
    }
    ws.send(JSON.stringify({ type: "analysis_update", data: botState.analysis }));

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        logger.debug({ msg }, "WS message received");
        // Clients can request refreshes
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        } else if (msg.type === "request_status") {
          ws.send(JSON.stringify({ type: "status", data: botState.status }));
        }
      } catch (_) {}
    });

    ws.on("close", () => {
      botState.unregisterWsClient(send);
      logger.info("WebSocket client disconnected");
    });

    ws.on("error", (err) => {
      botState.unregisterWsClient(send);
      logger.warn({ err }, "WebSocket error");
    });
  });

  logger.info("WebSocket server set up at /ws");
}
