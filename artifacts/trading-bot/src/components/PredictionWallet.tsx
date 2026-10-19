import { useCallback, useEffect, useState } from "react";
import { ExternalLink, LogOut, RefreshCw, Search, Smartphone, Wallet } from "lucide-react";
import QRCode from "qrcode";
import { useBot } from "@/hooks/useBot";
import { api, type MarketSearch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtUsd } from "@/components/bits";
import { cn } from "@/lib/utils";

interface WalletInfo {
  status: string;
  signin: { state: "waiting" | "success" | "failed"; pairingCode?: string; url?: string; expireAt?: number; error?: string } | null;
}

/** The sign-in link as a QR code — the same payload Binance's own CLI renders. */
function SigninQr({ url }: { url: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(url, { width: 240, margin: 2, errorCorrectionLevel: "M" }).then(setSrc).catch(() => setSrc(""));
  }, [url]);
  if (!src) return null;
  return <img src={src} alt="QR code to sign in with the Binance App" width={240} height={240} className="rounded-md bg-white p-1" />;
}

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

/** Connect / show the Binance Agentic Wallet used for Prediction Market bets. */
export function PredictionWallet() {
  const { run, state } = useBot();
  const [info, setInfo] = useState<WalletInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const acct = state?.status?.liveAccount;

  const load = useCallback(() => api<WalletInfo>("/prediction/wallet").then(setInfo).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load]);

  // poll while waiting for the user to confirm in the Binance App
  const waiting = info?.signin?.state === "waiting" && info.status !== "CONNECTED";
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [waiting, load]);

  const connected = info?.status === "CONNECTED";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-secondary/60 px-3 py-2 text-sm">
        <span className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-amber-400" />
          Agentic Wallet:{" "}
          <b className={connected ? "text-emerald-400" : "text-muted-foreground"}>
            {info == null ? "checking…" : connected ? "connected" : info.status.startsWith("ERROR") ? info.status : "not connected"}
          </b>
        </span>
        {connected && (
          <span className="font-mono text-xs">
            Prediction balance: <b className="text-amber-300">{acct?.venue === "prediction" && acct.ok ? `${fmtUsd(acct.usdt)} USDT` : "—"}</b>
          </span>
        )}
      </div>

      {waiting && info?.signin?.url && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <SigninQr url={info.signin.url} />
            <div className="space-y-2">
              <div>
                <b>On a computer:</b> open the Binance App on your phone → tap the scan icon (top left) → scan this QR code.
              </div>
              <div>
                <b>On your phone:</b> tap the button to open the Binance App directly.
              </div>
              <a
                href={info.signin.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-2 font-semibold text-black"
              >
                <Smartphone className="h-4 w-4" /> Open in Binance App <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <div>
                Then check the pairing code matches and confirm:{" "}
                <b className="font-mono text-lg tracking-widest text-foreground">{info.signin.pairingCode}</b>
              </div>
              <div className="text-xs text-muted-foreground">
                Waiting for confirmation… {info.signin.expireAt ? `QR code expires at ${hhmm(info.signin.expireAt)}.` : ""}
              </div>
            </div>
          </div>
        </div>
      )}
      {info?.signin?.state === "failed" && !connected && (
        <div className="text-xs text-red-300">Sign-in failed: {info.signin.error}. Try again.</div>
      )}

      <div className="flex flex-wrap gap-2">
        {!connected ? (
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await run("Could not start sign-in", async () => {
                await api("/prediction/signin", { method: "POST" });
                await load();
              });
              setBusy(false);
            }}
          >
            <Wallet className="h-4 w-4 mr-1.5" /> {waiting ? "Get a new QR code" : "Show QR code to connect"}
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await run("Refresh failed", () => api("/prediction/refresh", { method: "POST" }));
                setBusy(false);
              }}
            >
              <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh balance
            </Button>
            <Button
              variant="ghost"
              className="text-red-400"
              onClick={() => run("Sign-out failed", async () => {
                await api("/prediction/signout", { method: "POST" });
                await load();
              })}
            >
              <LogOut className="h-4 w-4 mr-1.5" /> Disconnect wallet
            </Button>
          </>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        No API key needed. You need a Binance account with an MPC Wallet, then an Agentic Wallet created in the Binance App. Bets are paid in
        USDT on BSC from that wallet. In the Binance App (Agentic Wallet → Settings) set a small daily limit, e.g. $50.
      </p>
    </div>
  );
}

/** Shows which Binance prediction market the bot would bet on for the current slot. */
export function MarketFinder({ query }: { query: string }) {
  const { run } = useBot();
  const [q, setQ] = useState(query);
  const [res, setRes] = useState<MarketSearch | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setQ(query), [query]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="BTC" />
        <Button
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await run("Market search failed", async () => setRes(await api<MarketSearch>(`/prediction/markets?query=${encodeURIComponent(q)}`)));
            setBusy(false);
          }}
        >
          <Search className="h-4 w-4 mr-1.5" /> {busy ? "Searching…" : "Find markets"}
        </Button>
      </div>
      {res && !res.ok && <div className="text-xs text-red-300">{res.error}</div>}
      {res?.ok && (
        <div className="space-y-2 text-xs">
          <div className={cn("rounded-md px-3 py-2", res.match ? "bg-emerald-500/10 text-emerald-200" : "bg-red-500/10 text-red-200")}>
            {res.match ? (
              <>
                ✓ Current slot (ends {hhmm(res.slotEnd!)}) → <b>{res.match.title}</b>. UP bets buy “{res.match.up?.label ?? "not found"}”, DOWN bets buy “
                {res.match.down?.label ?? "not found"}”.
              </>
            ) : (
              <>✗ No market found that ends at {res.slotEnd ? hhmm(res.slotEnd) : "—"} — bets will be skipped. Try another search word (e.g. “Bitcoin”).</>
            )}
          </div>
          <div className="text-muted-foreground">{res.count} markets found. Soonest to end:</div>
          <div className="max-h-64 overflow-y-auto divide-y divide-border rounded-md border border-border">
            {(res.markets ?? []).map((m) => (
              <div key={m.marketTopicId} className="px-3 py-2">
                <div className="font-medium">{m.title || `Market ${m.marketTopicId}`}</div>
                <div className="text-muted-foreground">
                  ends {m.endTime ? new Date(m.endTime).toLocaleString() : "?"} · outcomes: {m.outcomes.map((o) => o.label || "?").join(", ") || "—"}
                </div>
              </div>
            ))}
          </div>
          <details>
            <summary className="cursor-pointer text-muted-foreground">Raw response (for troubleshooting)</summary>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-secondary/60 p-2 text-[10px]">{res.raw}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
