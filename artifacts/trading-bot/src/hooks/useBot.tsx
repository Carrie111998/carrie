import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, wsUrl, type BotSettings, type BotState, type Tick, type Trade } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

interface BotContext {
  state: BotState | null;
  settings: BotSettings | null;
  wsConnected: boolean;
  saveSettings: (patch: Partial<BotSettings>) => Promise<void>;
  run: (label: string, fn: () => Promise<unknown>) => Promise<boolean>;
  /** Latest live price of every coin (about once a second). */
  prices: Record<string, Tick>;
  /** Stream live Binance trades for one symbol; returns an unsubscribe function. */
  watchTicks: (symbol: string, fn: (t: Tick) => void) => () => void;
}

const Ctx = createContext<BotContext | null>(null);

export function BotProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [state, setState] = useState<BotState | null>(null);
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [prices, setPrices] = useState<Record<string, Tick>>({});
  const { signOut } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const tickWatch = useRef<{ symbol: string; fn: (t: Tick) => void } | null>(null);

  const sendWatch = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN && tickWatch.current) {
      ws.send(JSON.stringify({ type: "watch", symbol: tickWatch.current.symbol }));
    }
  }, []);

  const watchTicks = useCallback(
    (symbol: string, fn: (t: Tick) => void) => {
      const entry = { symbol, fn };
      tickWatch.current = entry;
      sendWatch();
      return () => {
        if (tickWatch.current === entry) tickWatch.current = null;
      };
    },
    [sendWatch],
  );

  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    api<BotState>("/state").then((st) => !closed && setState(st)).catch(() => {});
    api<BotSettings>("/settings").then((st) => !closed && setSettings(st)).catch(() => {});
    connect();

    function connect() {
      if (closed) return;
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        setWsConnected(true);
        sendWatch(); // re-subscribe to live ticks after a reconnect
      };
      ws.onclose = (e) => {
        setWsConnected(false);
        if (closed) return;
        if (e.code === 4401) {
          signOut();
          return;
        }
        timer = setTimeout(connect, 3000);
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as { type: string; data: unknown };
          if (msg.type === "state") setState(msg.data as BotState);
          else if (msg.type === "price") {
            const t = msg.data as Tick;
            setPrices((p) => ({ ...p, [t.symbol]: t }));
          } else if (msg.type === "tick") {
            const t = msg.data as Tick;
            if (tickWatch.current?.symbol === t.symbol) tickWatch.current.fn(t);
          }
          else if (msg.type === "settings") setSettings(msg.data as BotSettings);
          else if (msg.type === "trade_closed") {
            const t = msg.data as Trade;
            toast({
              title: `${t.mode === "live" ? "LIVE" : "Paper"} ${t.symbol} ${t.result === "win" ? "won" : "lost"}`,
              description: `${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)} USDT · ${t.exitReason.replace("_", " ")}`,
              variant: t.result === "win" ? "default" : "destructive",
            });
          }
        } catch {
          /* ignore malformed */
        }
      };
    }

    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [toast, signOut, sendWatch]);

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        return true;
      } catch (err) {
        toast({ title: label, description: err instanceof Error ? err.message : String(err), variant: "destructive" });
        return false;
      }
    },
    [toast],
  );

  const saveSettings = useCallback(
    async (patch: Partial<BotSettings>) => {
      await run("Could not save settings", async () => {
        setSettings(await api<BotSettings>("/settings", { method: "POST", body: patch }));
      });
    },
    [run],
  );

  return (
    <Ctx.Provider
      value={{ state, settings, wsConnected, prices, saveSettings, run, watchTicks }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useBot() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useBot must be used inside BotProvider");
  return c;
}
