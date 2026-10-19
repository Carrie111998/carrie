import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage, Server } from "http";
import { getEngine } from "./engine";
import { userFromToken } from "../auth";
import { logger } from "../lib/logger";
import { liveStream, SYMBOL_RE } from "../market";

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

    // live price ticks for the one symbol this browser is charting
    let unwatch: (() => void) | null = null;
    const stopWatching = () => {
      unwatch?.();
      unwatch = null;
    };

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string; symbol?: string };
        if (msg.type === "ping") send("pong", null);
        else if (msg.type === "watch") {
          stopWatching();
          const sym = String(msg.symbol ?? "").toUpperCase();
          if (SYMBOL_RE.test(sym)) unwatch = liveStream.subscribe(sym, (t) => send("tick", t));
        }
      } catch {
        /* ignore */
      }
    });
    ws.on("close", () => {
      unsubscribe();
      stopWatching();
    });
    ws.on("error", (err) => {
      unsubscribe();
      stopWatching();
      logger.warn({ err }, "WebSocket error");
    });
  });

  logger.info("WebSocket server set up at /ws");
}
