import { useEffect, useState, type ReactNode } from "react";
import { Eye, EyeOff, KeyRound, Save, ShieldAlert, Trash2 } from "lucide-react";
import { useBot } from "@/hooks/useBot";
import { api, type BotSettings, type CredentialInfo, type LiveAccount } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Panel, fmtUsd } from "@/components/bits";
import { useToast } from "@/hooks/use-toast";

const INTERVALS: BotSettings["interval"][] = ["1m", "3m", "5m", "15m", "30m", "1h", "4h"];

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5 min-w-0">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Num({ value, onChange, step = 1, min, max }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      value={Number.isFinite(value) ? value : ""}
      step={step}
      min={min}
      max={max}
      onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
    />
  );
}

const QUICK_AMOUNTS = [1, 2, 5, 10, 25, 50];

/** USD amount with quick-pick chips; never below the 1 USD minimum. */
function AmountInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex">
        <span className="inline-flex items-center rounded-l-md border border-r-0 border-input bg-secondary px-3 text-sm text-muted-foreground">$</span>
        <Input
          type="number"
          inputMode="decimal"
          min={1}
          step={0.5}
          className="rounded-l-none"
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
          onBlur={() => onChange(Number.isFinite(value) ? Math.max(1, value) : 1)}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {QUICK_AMOUNTS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => onChange(a)}
            className={`rounded border px-2 py-0.5 text-xs ${value === a ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
          >
            ${a}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-3 py-1">
      <span>
        <span className="text-sm">{label}</span>
        {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function ApiKeys() {
  const { run, state } = useBot();
  const { toast } = useToast();
  const [info, setInfo] = useState<CredentialInfo | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [testnet, setTestnet] = useState(true);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const acct = state?.status?.liveAccount;

  useEffect(() => {
    api<CredentialInfo>("/credentials").then((i) => { setInfo(i); setTestnet(i.testnet); }).catch(() => {});
  }, []);

  const report = (r: LiveAccount) =>
    toast(
      r.ok
        ? { title: "Connected to Binance", description: `${r.testnet ? "Testnet" : "Live"} account · ${fmtUsd(r.usdt)} USDT free` }
        : { title: "Binance check failed", description: r.error, variant: "destructive" },
    );

  async function save() {
    setBusy(true);
    await run("Could not save API keys", async () => {
      report(await api<LiveAccount>("/credentials", { method: "POST", body: { apiKey, apiSecret, testnet } }));
      setInfo(await api<CredentialInfo>("/credentials"));
      setApiKey("");
      setApiSecret("");
    });
    setBusy(false);
  }

  return (
    <Panel title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-amber-400" /> Binance API</span>}>
      <div className="space-y-4">
        <div className="rounded-md bg-secondary/60 px-3 py-2 text-xs space-y-1">
          <div>
            Status:{" "}
            {info?.hasCredentials ? (
              <b className="text-emerald-400">key {info.keyPreview} saved ({info.testnet ? "testnet" : "LIVE"})</b>
            ) : (
              <b className="text-muted-foreground">no key saved</b>
            )}
          </div>
          {acct && <div>Last check: {acct.ok ? `OK · ${fmtUsd(acct.usdt)} USDT free${acct.canTrade ? "" : " · trading NOT permitted"}` : acct.error}</div>}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="API key">
            <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={info?.hasCredentials ? "Enter to replace saved key" : "Binance API key"} autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="API secret key">
            <div className="flex gap-2">
              <Input
                type={show ? "text" : "password"}
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="Binance secret key"
                autoComplete="new-password"
                spellCheck={false}
              />
              <Button type="button" size="icon" variant="ghost" onClick={() => setShow(!show)} aria-label={show ? "Hide secret" : "Show secret"}>
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </Field>
        </div>
        <Toggle
          label="Use Binance Spot Testnet"
          hint="Recommended first. Create free testnet keys at testnet.binance.vision. Turn off only for real-money trading."
          checked={testnet}
          onChange={setTestnet}
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={busy || !apiKey || !apiSecret}>
            <Save className="h-4 w-4 mr-1.5" /> Save & test keys
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !info?.hasCredentials}
            onClick={async () => {
              setBusy(true);
              await run("Test failed", async () => report(await api<LiveAccount>("/credentials/test", { method: "POST" })));
              setBusy(false);
            }}
          >
            Test connection
          </Button>
          <Button
            variant="ghost"
            className="text-red-400"
            disabled={!info?.hasCredentials}
            onClick={() => run("Could not delete keys", async () => setInfo(await api<CredentialInfo>("/credentials", { method: "DELETE" })))}
          >
            <Trash2 className="h-4 w-4 mr-1.5" /> Delete keys
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground flex gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
          Create keys with only "Enable Spot & Margin Trading" — never enable withdrawals — and restrict them to your server's IP. Keys are stored
          on the server only (data/credentials.json) and are never sent back to the browser.
        </p>
      </div>
    </Panel>
  );
}

export default function Settings() {
  const { settings, saveSettings, run, state } = useBot();
  const [draft, setDraft] = useState<BotSettings | null>(settings);
  const [symbolsText, setSymbolsText] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings && !dirty) {
      setDraft(settings);
      setSymbolsText(settings.symbols.join(", "));
    }
  }, [settings, dirty]);

  if (!draft) return <div className="p-6 text-sm text-muted-foreground">Loading settings…</div>;

  const set = <K extends keyof BotSettings>(k: K, v: BotSettings[K]) => {
    setDraft({ ...draft, [k]: v });
    setDirty(true);
  };
  const setInd = (key: string, patch: Partial<{ enabled: boolean; weight: number }>) => {
    setDraft({ ...draft, indicators: { ...draft.indicators, [key]: { ...draft.indicators[key], ...patch } } });
    setDirty(true);
  };
  const setParam = (key: string, v: number) => {
    setDraft({ ...draft, indicatorParams: { ...draft.indicatorParams, [key]: v } });
    setDirty(true);
  };
  const labels = Object.fromEntries((state?.learning?.indicators ?? []).map((i) => [i.key, i.label]));

  async function save() {
    if (!draft) return;
    const symbols = symbolsText.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    await saveSettings({ ...draft, symbols });
    setDirty(false);
  }

  const n = (k: keyof BotSettings) => draft[k] as number;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Settings</h1>
          <p className="text-xs text-muted-foreground">Auto-tune may change some of these automatically — every change is logged on the Learning page.</p>
        </div>
      </div>

      <ApiKeys />

      <Panel title="Markets & prediction">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3">
            <Field label="Trading pairs" hint="Binance Spot symbols, comma separated (e.g. BTCUSDT, ETHUSDT). USDT pairs recommended.">
              <Textarea rows={2} value={symbolsText} onChange={(e) => { setSymbolsText(e.target.value); setDirty(true); }} className="font-mono text-xs" />
            </Field>
          </div>
          <Field label="Candle interval">
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={draft.interval}
              onChange={(e) => set("interval", e.target.value as BotSettings["interval"])}
            >
              {INTERVALS.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </Field>
          <Field label="Scan every (seconds)"><Num value={n("scanIntervalSec")} onChange={(v) => set("scanIntervalSec", v)} min={10} /></Field>
          <Field label="Prediction horizon (candles)" hint="How far ahead predictions are scored."><Num value={n("predictionHorizon")} onChange={(v) => set("predictionHorizon", v)} min={1} /></Field>
          <Field label="Minimum confidence %" hint="Only trade signals at or above this."><Num value={n("minConfidence")} onChange={(v) => set("minConfidence", v)} min={50} max={95} /></Field>
          <Field label="Minimum ADX (trend filter)" hint="0 = off. 20+ skips sideways markets."><Num value={n("minAdx")} onChange={(v) => set("minAdx", v)} min={0} max={60} /></Field>
        </div>
      </Panel>

      <Panel title="Paper trading & risk">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Paper start balance (USDT)" hint="Applied after Reset paper account."><Num value={n("paperStartBalance")} onChange={(v) => set("paperStartBalance", v)} /></Field>
          <Field label="Bet amount type">
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={draft.paperTradeMode}
              onChange={(e) => set("paperTradeMode", e.target.value as BotSettings["paperTradeMode"])}
            >
              <option value="fixed">Fixed USD per trade</option>
              <option value="percent">% of paper balance</option>
            </select>
          </Field>
          {draft.paperTradeMode === "fixed" ? (
            <Field label="Bet amount per trade (USD)" hint="Minimum and standard bet is 1 USD.">
              <AmountInput value={n("paperTradeAmountUsdt")} onChange={(v) => set("paperTradeAmountUsdt", v)} />
            </Field>
          ) : (
            <Field label="Trade size (% of balance)" hint="Never less than 1 USD per trade."><Num value={n("paperTradeSizePct")} onChange={(v) => set("paperTradeSizePct", v)} step={0.5} /></Field>
          )}
          <Field label="Max open paper positions"><Num value={n("maxOpenPositions")} onChange={(v) => set("maxOpenPositions", v)} /></Field>
          <Field label="Stop-loss (× ATR)"><Num value={n("slAtrMult")} onChange={(v) => set("slAtrMult", v)} step={0.1} /></Field>
          <Field label="Take-profit (× ATR)"><Num value={n("tpAtrMult")} onChange={(v) => set("tpAtrMult", v)} step={0.1} /></Field>
          <Field label="Max hold (candles)"><Num value={n("maxHoldCandles")} onChange={(v) => set("maxHoldCandles", v)} /></Field>
          <Field label="Fee per side %"><Num value={n("feePct")} onChange={(v) => set("feePct", v)} step={0.01} /></Field>
          <div className="sm:col-span-2 flex items-end">
            <Toggle label="Allow short trades (paper only)" hint="Binance Spot live trading is always long-only." checked={draft.allowShort} onChange={(v) => set("allowShort", v)} />
          </div>
        </div>
      </Panel>

      <Panel title="Live trading safety">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Live order size (USD)"
            hint={n("liveTradeAmountUsdt") < 5 ? "⚠ Binance rejects orders under ~5 USDT on most pairs." : "Binance requires at least ~5 USDT per order on most pairs."}
          >
            <AmountInput value={n("liveTradeAmountUsdt")} onChange={(v) => set("liveTradeAmountUsdt", v)} />
          </Field>
          <Field label="Max open live positions"><Num value={n("liveMaxOpenPositions")} onChange={(v) => set("liveMaxOpenPositions", v)} /></Field>
          <Field label="Daily loss limit (USDT)" hint="Live trading switches off when hit."><Num value={n("liveDailyLossLimitUsdt")} onChange={(v) => set("liveDailyLossLimitUsdt", v)} /></Field>
        </div>
      </Panel>

      <Panel title="Auto-tune">
        <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
          <Toggle label="Auto-tune enabled" hint="Learn from results and update settings automatically." checked={draft.autoTune} onChange={(v) => set("autoTune", v)} />
          <Field label="Run after every N closed trades"><Num value={n("autoTuneEvery")} onChange={(v) => set("autoTuneEvery", v)} min={1} /></Field>
          <Toggle label="Tune indicator weights" checked={draft.tuneWeights} onChange={(v) => set("tuneWeights", v)} />
          <Toggle label="Tune minimum confidence" checked={draft.tuneThreshold} onChange={(v) => set("tuneThreshold", v)} />
          <Toggle label="Tune stop-loss / take-profit" checked={draft.tuneRisk} onChange={(v) => set("tuneRisk", v)} />
          <Toggle label="Block weak pairs, hours, shorts, ranging markets" checked={draft.tuneFilters} onChange={(v) => set("tuneFilters", v)} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Blocked pairs" hint="Set by auto-tune; edit to unblock.">
            <Input
              value={draft.blockedSymbols.join(", ")}
              onChange={(e) => set("blockedSymbols", e.target.value.split(/[\s,]+/).map((s) => s.toUpperCase()).filter(Boolean))}
              className="font-mono text-xs"
            />
          </Field>
          <Field label="Blocked hours (UTC)">
            <Input
              value={draft.blockedHours.join(", ")}
              onChange={(e) => set("blockedHours", e.target.value.split(/[\s,]+/).filter(Boolean).map(Number))}
              className="font-mono text-xs"
            />
          </Field>
        </div>
      </Panel>

      <Panel title="Indicators & prediction tools">
        <div className="grid gap-2 md:grid-cols-2">
          {Object.entries(draft.indicators).map(([key, cfg]) => (
            <div key={key} className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <Switch checked={cfg.enabled} onCheckedChange={(v) => setInd(key, { enabled: v })} aria-label={`Enable ${labels[key] ?? key}`} />
                <span className="text-sm truncate">{labels[key] ?? key}</span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="hidden sm:inline text-[11px] text-muted-foreground">weight</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  step={0.1}
                  className="h-8 w-16 sm:w-20"
                  value={cfg.weight}
                  onChange={(e) => setInd(key, { weight: Number(e.target.value) })}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {Object.entries(draft.indicatorParams).map(([k, v]) => (
            <Field key={k} label={k}>
              <Num value={v} onChange={(x) => setParam(k, x)} step={k === "bbStd" ? 0.1 : 1} />
            </Field>
          ))}
        </div>
      </Panel>

      <Panel title="Data">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => confirm("Reset the paper account and delete paper trade history?") && run("Reset failed", () => api("/reset", { method: "POST", body: { what: "paper" } }))}
          >
            Reset paper account
          </Button>
          <Button
            variant="secondary"
            onClick={() => confirm("Forget everything the bot has learned?") && run("Reset failed", () => api("/reset", { method: "POST", body: { what: "learning" } }))}
          >
            Reset learning
          </Button>
          <Button
            variant="ghost"
            onClick={() => confirm("Restore all default settings?") && run("Reset failed", () => api("/settings/defaults", { method: "POST" }).then(() => setDirty(false)))}
          >
            Restore default settings
          </Button>
        </div>
      </Panel>

      {/* Sticky save bar */}
      <div className="sticky bottom-20 md:bottom-4 z-20 flex justify-end">
        <Button size="lg" onClick={save} disabled={!dirty} className="shadow-lg">
          <Save className="h-4 w-4 mr-1.5" /> {dirty ? "Save settings" : "Saved"}
        </Button>
      </div>
    </div>
  );
}
