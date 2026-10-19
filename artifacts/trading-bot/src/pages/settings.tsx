import { useEffect, useState, type ReactNode } from "react";
import { Brain, Clock, Coins, Eye, EyeOff, KeyRound, Link2, QrCode, Save, ShieldAlert, Trash2 } from "lucide-react";
import { useBot } from "@/hooks/useBot";
import { api, type BotSettings, type CredentialInfo, type LiveAccount } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Panel, fmtUsd } from "@/components/bits";
import { useToast } from "@/hooks/use-toast";
import { MarketFinder, PredictionWallet } from "@/components/PredictionWallet";
import { ChangePasswordForm } from "@/pages/auth";
import { useAuth } from "@/hooks/useAuth";

const COINS = [
  { symbol: "BTCUSDT", name: "Bitcoin", short: "BTC" },
  { symbol: "ETHUSDT", name: "Ethereum", short: "ETH" },
  { symbol: "BNBUSDT", name: "BNB", short: "BNB" },
];
const SLOTS: { v: BotSettings["interval"]; label: string }[] = [
  { v: "5m", label: "5 min" },
  { v: "15m", label: "15 min" },
  { v: "1h", label: "1 hour" },
];
const RUN_TIMES: { v: number; label: string }[] = [
  { v: 15, label: "15 min" }, { v: 30, label: "30 min" }, { v: 60, label: "1 hr" }, { v: 180, label: "3 hrs" },
  { v: 360, label: "6 hrs" }, { v: 720, label: "12 hrs" }, { v: 0, label: "∞ No limit" },
];

/** Big tappable option buttons (single or multi select). */
function Choice<T extends string | number>({
  options, value, onChange, multi = false,
}: { options: { v: T; label: ReactNode; sub?: string }[]; value: T | T[]; onChange: (v: T) => void; multi?: boolean }) {
  const on = (v: T) => (multi ? (value as T[]).includes(v) : value === v);
  return (
    <div className="flex flex-wrap gap-2" role={multi ? "group" : "radiogroup"}>
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          role={multi ? "checkbox" : "radio"}
          aria-checked={on(o.v)}
          onClick={() => onChange(o.v)}
          className={`min-w-[4.5rem] rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
            on(o.v) ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border bg-card hover:bg-secondary"
          }`}
        >
          {o.label}
          {o.sub && <span className="block text-[11px] font-normal text-muted-foreground">{o.sub}</span>}
        </button>
      ))}
    </div>
  );
}

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

const QUICK_AMOUNTS = [1, 1.5, 2, 5, 10, 25];

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
    <div>
      <div className="space-y-4">
        <div className="rounded-md bg-secondary/60 px-3 py-2 text-xs space-y-1">
          <div>
            Status:{" "}
            {info?.hasCredentials ? (
              <b className="text-emerald-700">key {info.keyPreview} saved ({info.testnet ? "testnet" : "LIVE"})</b>
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
            className="text-red-700"
            disabled={!info?.hasCredentials}
            onClick={() => run("Could not delete keys", async () => setInfo(await api<CredentialInfo>("/credentials", { method: "DELETE" })))}
          >
            <Trash2 className="h-4 w-4 mr-1.5" /> Delete keys
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground flex gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 flex-shrink-0 text-amber-700" />
          Create keys with only "Enable Spot & Margin Trading" — never enable withdrawals — and restrict them to your server's IP. Keys are stored
          on the server only (data/credentials.json) and are never sent back to the browser.
        </p>
      </div>
    </div>
  );
}

export default function Settings() {
  const { settings, saveSettings, run, state } = useBot();
  const { user } = useAuth();
  const admin = Boolean(user?.isAdmin);
  const [draft, setDraft] = useState<BotSettings | null>(settings);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings && !dirty) setDraft(settings);
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
  const toggleCoin = (sym: string) => {
    const has = draft.symbols.includes(sym);
    const next = has ? draft.symbols.filter((x) => x !== sym) : [...draft.symbols, sym];
    if (next.length) set("symbols", COINS.map((c) => c.symbol).filter((c) => next.includes(c)));
  };

  async function save() {
    if (!draft) return;
    await saveSettings(draft); // the server keeps only your own basic settings
    if (admin) await run("Could not save the shared brain", () => api("/brain", { method: "POST", body: draft }));
    setDirty(false);
  }

  const n = (k: keyof BotSettings) => draft[k] as number;
  const coinNames = draft.symbols.map((x) => x.replace("USDT", "")).join(", ");

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Choose what the bot trades and how much. The trading strategy itself is shared by everyone and managed by the admin.
        </p>
      </div>

      <Panel title={<span className="flex items-center gap-2"><Coins className="h-4 w-4 text-primary" /> What to trade</span>}>
        <div className="space-y-5">
          <Field label="Coins" hint="The bot predicts Up or Down for each coin you pick — for paper bets and live bets.">
            <Choice multi options={COINS.map((c) => ({ v: c.symbol, label: c.short, sub: c.name }))} value={draft.symbols} onChange={toggleCoin} />
          </Field>
          <Field label="Prediction slot" hint="Each bet predicts whether the price will be higher or lower when the slot ends.">
            <Choice options={SLOTS.map((x) => ({ v: x.v, label: x.label }))} value={draft.interval} onChange={(v) => set("interval", v)} />
          </Field>
        </div>
      </Panel>

      <Panel title={<span className="flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /> Run time</span>}>
        <Field label="When you press Start, run the bot for" hint="The bot stops by itself when the time is up (live betting too). ∞ runs until you press Stop.">
          <Choice options={RUN_TIMES.map((x) => ({ v: x.v, label: x.label }))} value={draft.runDurationMin} onChange={(v) => set("runDurationMin", v)} />
        </Field>
      </Panel>

      <Panel title="Practice (paper) trading">
        <p className="mb-4 text-xs text-muted-foreground">Pretend bets with no real money — the safe way to see how the bot performs. Every result also teaches the shared brain.</p>
        <div className="mb-4 grid gap-2 sm:grid-cols-2">
          {([
            ["prediction", "Prediction bets", "A pretend Up/Down bet on every slot, paid like Binance Prediction."],
            ["spot", "Spot trades", "Pretend buy/sell positions with stop-loss and take-profit."],
          ] as const).map(([v, title, hint]) => (
            <button
              key={v}
              type="button"
              onClick={() => set("paperMode", v)}
              className={`rounded-xl border p-3 text-left ${draft.paperMode === v ? "border-primary bg-primary/10" : "border-border bg-card"}`}
            >
              <div className="text-sm font-semibold">{title}</div>
              <div className="text-[11px] text-muted-foreground">{hint}</div>
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bet per round (USD)" hint="Same amount every round — never raised after a loss. Minimum $1.">
            <AmountInput value={n("paperTradeAmountUsdt")} onChange={(v) => set("paperTradeAmountUsdt", v)} />
          </Field>
          <Field label="Practice balance (USD)" hint="Used when you reset the practice account.">
            <Num value={n("paperStartBalance")} onChange={(v) => set("paperStartBalance", v)} />
          </Field>
        </div>
      </Panel>

      <Panel title={<span className="flex items-center gap-2"><Link2 className="h-4 w-4 text-primary" /> Real-money trading: connect Binance</span>}>
        <div role="tablist" className="mb-4 grid grid-cols-2 gap-2">
          {([
            ["prediction", QrCode, "Prediction Market", "Scan a QR code with the Binance app"],
            ["spot", KeyRound, "Spot (API key)", "Buy/sell coins with an API key"],
          ] as const).map(([v, Icon, title, hint]) => (
            <button
              key={v}
              role="tab"
              type="button"
              aria-selected={draft.liveVenue === v}
              onClick={() => {
                if (draft.liveVenue === v) return;
                setDraft({ ...draft, liveVenue: v });
                saveSettings({ liveVenue: v });
              }}
              className={`rounded-xl border p-3 text-left ${draft.liveVenue === v ? "border-primary bg-primary/10" : "border-border bg-card"}`}
            >
              <div className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4" /> {title}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
            </button>
          ))}
        </div>
        {draft.liveVenue === "prediction" ? <PredictionWallet /> : <ApiKeys />}
      </Panel>

      {draft.liveVenue === "prediction" ? (
        <Panel title="Real-money bet limits">
          <div className="space-y-5">
            <p className="text-xs text-muted-foreground">Live bets go on {coinNames} — {SLOTS.find((x) => x.v === draft.interval)?.label} slot markets.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Bet per slot (USDT)" hint="Same size every slot — never increased after a loss. Minimum 1 USDT.">
                <AmountInput value={n("predictionBetUsdt")} onChange={(v) => set("predictionBetUsdt", v)} />
              </Field>
              <Field label="Daily loss limit (USDT)" hint="Real betting switches off for the day when you lose this much.">
                <Num value={n("liveDailyLossLimitUsdt")} onChange={(v) => set("liveDailyLossLimitUsdt", v)} />
              </Field>
              <Field label="Max money in open bets (USDT)" hint="No new bets while unsettled bets add up to this.">
                <Num value={n("predictionMaxExposureUsdt")} onChange={(v) => set("predictionMaxExposureUsdt", v)} />
              </Field>
            </div>
            <div className="grid gap-x-8 md:grid-cols-2">
              <Toggle
                label="Test mode (no real bets)"
                hint="Only fetches prices. Turn off when the market check below looks right."
                checked={draft.predictionDryRun}
                onChange={(v) => set("predictionDryRun", v)}
              />
              <Toggle label="Auto-claim winnings" hint="Collects winning bets every 5 minutes." checked={draft.predictionAutoRedeem} onChange={(v) => set("predictionAutoRedeem", v)} />
            </div>
            <div>
              <div className="mb-2 text-sm font-medium">Check the market the bot will use</div>
              <MarketFinder query={draft.predictionSymbol.replace("USDT", "")} />
            </div>
          </div>
        </Panel>
      ) : (
        <Panel title="Real-money trade limits">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Order size (USD)"
              hint={n("liveTradeAmountUsdt") < 5 ? "⚠ Binance rejects orders under ~5 USDT." : "Binance needs at least ~5 USDT per order."}
            >
              <AmountInput value={n("liveTradeAmountUsdt")} onChange={(v) => set("liveTradeAmountUsdt", v)} />
            </Field>
            <Field label="Max open positions"><Num value={n("liveMaxOpenPositions")} onChange={(v) => set("liveMaxOpenPositions", v)} /></Field>
            <Field label="Daily loss limit (USDT)" hint="Real trading switches off when hit."><Num value={n("liveDailyLossLimitUsdt")} onChange={(v) => set("liveDailyLossLimitUsdt", v)} /></Field>
          </div>
        </Panel>
      )}

      {admin && (
        <div className="space-y-5 rounded-2xl border-2 border-dashed border-primary/40 p-3 sm:p-4">
          <div className="flex items-start gap-2">
            <Brain className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <div className="font-semibold">Shared brain — admin only</div>
              <p className="text-xs text-muted-foreground">
                Every user's bot uses these strategy settings. Auto-tune adjusts them from all users' practice and real results; each change is listed on the Learning page.
              </p>
            </div>
          </div>

          <Panel title="Strategy">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Minimum confidence %" hint="Only bet at or above this."><Num value={n("minConfidence")} onChange={(v) => set("minConfidence", v)} min={50} max={95} /></Field>
              <Field label="Minimum ADX (trend filter)" hint="0 = off."><Num value={n("minAdx")} onChange={(v) => set("minAdx", v)} min={0} max={60} /></Field>
              <Field label="Scan every (seconds)"><Num value={n("scanIntervalSec")} onChange={(v) => set("scanIntervalSec", v)} min={10} /></Field>
              <Field label="Prediction horizon (candles)"><Num value={n("predictionHorizon")} onChange={(v) => set("predictionHorizon", v)} min={1} /></Field>
              <Field label="Max bets / positions per round"><Num value={n("maxOpenPositions")} onChange={(v) => set("maxOpenPositions", v)} /></Field>
              <Field label="Assumed share price" hint="0.50 = 50/50 market."><Num value={n("paperPredictionPrice")} onChange={(v) => set("paperPredictionPrice", v)} step={0.01} /></Field>
              <Field label="Fee %"><Num value={n("feePct")} onChange={(v) => set("feePct", v)} step={0.01} /></Field>
              <Field label="Stop-loss (× ATR, spot)"><Num value={n("slAtrMult")} onChange={(v) => set("slAtrMult", v)} step={0.1} /></Field>
              <Field label="Take-profit (× ATR, spot)"><Num value={n("tpAtrMult")} onChange={(v) => set("tpAtrMult", v)} step={0.1} /></Field>
              <Field label="Max hold (candles, spot)"><Num value={n("maxHoldCandles")} onChange={(v) => set("maxHoldCandles", v)} /></Field>
            </div>
            <div className="mt-3"><Toggle label="Allow Down bets / short trades" hint="Auto-tune may switch these off if they lose too often." checked={draft.allowShort} onChange={(v) => set("allowShort", v)} /></div>
          </Panel>

          <Panel title="Auto-tune (learns from all users)">
            <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
              <Toggle label="Auto-tune enabled" hint="Updates the shared brain from everyone's settled trades (checked every 10 minutes)." checked={draft.autoTune} onChange={(v) => set("autoTune", v)} />
              <Field label="Tune after every N new trades (all users)"><Num value={n("autoTuneEvery")} onChange={(v) => set("autoTuneEvery", v)} min={1} /></Field>
              <Toggle label="Tune indicator weights" checked={draft.tuneWeights} onChange={(v) => set("tuneWeights", v)} />
              <Toggle label="Tune minimum confidence" checked={draft.tuneThreshold} onChange={(v) => set("tuneThreshold", v)} />
              <Toggle label="Tune stop-loss / take-profit" checked={draft.tuneRisk} onChange={(v) => set("tuneRisk", v)} />
              <Toggle label="Block weak coins, hours, Down bets, sideways markets" checked={draft.tuneFilters} onChange={(v) => set("tuneFilters", v)} />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Blocked coins" hint="Set by auto-tune; edit to unblock.">
                <Input
                  value={draft.blockedSymbols.join(", ")}
                  onChange={(e) => set("blockedSymbols", e.target.value.split(/[\s,]+/).map((x) => x.toUpperCase()).filter(Boolean))}
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

          <Panel title="Indicators">
            <div className="grid gap-2 md:grid-cols-2">
              {Object.entries(draft.indicators).map(([key, cfg]) => (
                <div key={key} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Switch checked={cfg.enabled} onCheckedChange={(v) => setInd(key, { enabled: v })} aria-label={`Enable ${labels[key] ?? key}`} />
                    <span className="truncate text-sm">{labels[key] ?? key}</span>
                  </div>
                  <Input type="number" inputMode="decimal" step={0.1} className="h-8 w-16 sm:w-20" aria-label={`${labels[key] ?? key} weight`} value={cfg.weight} onChange={(e) => setInd(key, { weight: Number(e.target.value) })} />
                </div>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(draft.indicatorParams).map(([k, v]) => (
                <Field key={k} label={k}>
                  <Num value={v} onChange={(x) => setParam(k, x)} step={k === "bbStd" ? 0.1 : 1} />
                </Field>
              ))}
            </div>
          </Panel>
        </div>
      )}

      <Panel title="Account">
        <div className="max-w-sm">
          <ChangePasswordForm />
        </div>
        <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
          <Button
            variant="secondary"
            onClick={() => confirm("Reset the practice account and delete practice history?") && run("Reset failed", () => api("/reset", { method: "POST", body: { what: "paper" } }))}
          >
            Reset practice account
          </Button>
          {admin && (
            <Button
              variant="secondary"
              onClick={() => confirm("Forget what your own bot has learned? (The shared brain is kept.)") && run("Reset failed", () => api("/reset", { method: "POST", body: { what: "learning" } }))}
            >
              Reset my learning data
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => confirm("Restore your default settings?") && run("Reset failed", () => api("/settings/defaults", { method: "POST" }).then(() => setDirty(false)))}
          >
            Restore defaults
          </Button>
        </div>
      </Panel>

      {dirty && (
        <div className="sticky bottom-20 z-20 flex justify-end md:bottom-4">
          <Button size="lg" onClick={save} className="rounded-full shadow-lg">
            <Save className="mr-1.5 h-4 w-4" /> Save settings
          </Button>
        </div>
      )}
    </div>
  );
}
