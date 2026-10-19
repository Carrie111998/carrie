import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetBotStatusQueryKey, getGetActiveTradesQueryKey, getGetMarketsQueryKey, getGetAnalysisQueryKey, getGetTradeHistoryQueryKey, getGetTradeStatsQueryKey } from "@workspace/api-client-react";

interface WsMessage {
  type: string;
  data: unknown;
}

export function useWebSocket() {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${window.location.host}/ws`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
        reconnectTimeout.current = null;
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      // Reconnect after 3 seconds
      reconnectTimeout.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onmessage = (e) => {
      try {
        const msg: WsMessage = JSON.parse(e.data);
        
        if (msg.type === "status") {
          queryClient.setQueryData(getGetBotStatusQueryKey(), msg.data);
        } else if (msg.type === "active_trades") {
          queryClient.setQueryData(getGetActiveTradesQueryKey(), msg.data);
        } else if (msg.type === "trade_placed") {
          // Append to active trades
          queryClient.setQueryData(getGetActiveTradesQueryKey(), (old: unknown[] | undefined) => {
            const trades = Array.isArray(old) ? old : [];
            return [...trades, msg.data];
          });
          // Refetch stats
          queryClient.invalidateQueries({ queryKey: getGetTradeStatsQueryKey() });
        } else if (msg.type === "trade_closed") {
          // Remove from active trades
          const closed = msg.data as { id: string };
          queryClient.setQueryData(getGetActiveTradesQueryKey(), (old: unknown[] | undefined) => {
            const trades = Array.isArray(old) ? old : [];
            return trades.filter((t: { id: string }) => t.id !== closed.id);
          });
          // Prepend to history
          queryClient.setQueryData(getGetTradeHistoryQueryKey({}), (old: unknown[] | undefined) => {
            const history = Array.isArray(old) ? old : [];
            return [msg.data, ...history].slice(0, 100);
          });
          queryClient.invalidateQueries({ queryKey: getGetTradeStatsQueryKey() });
        } else if (msg.type === "balance_update") {
          queryClient.setQueryData(getGetBotStatusQueryKey(), (old: Record<string, unknown> | undefined) => ({
            ...(old ?? {}),
            balance: (msg.data as { balance: number }).balance,
          }));
        } else if (msg.type === "analysis_update") {
          queryClient.setQueryData(getGetAnalysisQueryKey(), msg.data);
        } else if (msg.type === "market_update") {
          queryClient.setQueryData(getGetMarketsQueryKey(), msg.data);
        }
      } catch (_) {}
    };
  }, [queryClient]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { connected };
}
