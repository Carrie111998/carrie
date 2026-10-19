import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, wsUrl, type BotSettings, type BotState, type Trade } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface BotContext {
  state: BotState | null;
  settings: BotSettings | null;
  wsConnected: boolean;
  needsPassword: boolean;
  retryAuth: () => void;
  saveSettings: (patch: Partial<BotSettings>) => Promise<void>;
  run: (label: string, fn: () => Promise<unknown>) => Promise<boolean>;
}

const Ctx = createContext<BotContext | null>(null);

export function BotProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [state, setState] = useState<BotState | null>(null);
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    api<{ required: boolean; ok: boolean }>("/auth")
      .then((a) => {
        if (closed) return;
        if (a.required && !a.ok) {
          setNeedsPassword(true);
          return;
        }
        setNeedsPassword(false);
        api<BotState>("/state").then((s) => !closed && setState(s)).catch(() => {});
        api<BotSettings>("/settings").then((s) => !closed && setSettings(s)).catch(() => {});
        connect();
      })
      .catch(() => {
        timer = setTimeout(() => setAttempt((n) => n + 1), 3000);
      });

    function connect() {
      if (closed) return;
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onopen = () => setWsConnected(true);
      ws.onclose = (e) => {
        setWsConnected(false);
        if (closed) return;
        if (e.code === 4401) {
          setNeedsPassword(true);
          return;
        }
        timer = setTimeout(connect, 3000);
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as { type: string; data: unknown };
          if (msg.type === "state") setState(msg.data as BotState);
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
  }, [attempt, toast]);

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) setNeedsPassword(true);
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
      value={{ state, settings, wsConnected, needsPassword, retryAuth: () => setAttempt((n) => n + 1), saveSettings, run }}
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
