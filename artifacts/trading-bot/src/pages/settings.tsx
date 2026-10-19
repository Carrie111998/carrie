import { useState, useEffect } from "react";
import { useGetSettings, useUpdateSettings, type BotSettings } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Save, Brain, CheckSquare, Square } from "lucide-react";
import { cn } from "@/lib/utils";

type FormState = {
  tradeTime: number;
  tradeAmount: number;
  tradeAmountType: string;
  maxActiveTrades: number;
  riskLevel: string;
  balanceType: string;
  marketCategories: string[];
  tradingMode: string;
  enableRsi: boolean;
  enableMacd: boolean;
  enableBollinger: boolean;
  enableEma: boolean;
  enableVolume: boolean;
  rsiWeight: number;
  macdWeight: number;
  bollingerWeight: number;
  emaWeight: number;
  volumeWeight: number;
  enableFinnhub: boolean;
  finnhubWeight: number;
  enableTwelveData: boolean;
  twelveDataWeight: number;
  enableGemini: boolean;
  geminiWeight: number;
  enableAlpaca: boolean;
  alpacaWeight: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  bollingerPeriod: number;
  bollingerStdDev: number;
  emaFast: number;
  emaSlow: number;
};

const CATEGORIES = [
  { key: "otc", label: "OTC", desc: "OTC markets (3s/5s/10s)" },
  { key: "forex", label: "Forex", desc: "Major & minor currency pairs" },
  { key: "crypto", label: "Crypto", desc: "BTC, ETH, LTC" },
  { key: "stocks", label: "Stocks", desc: "AAPL, MSFT, TSLA, AMZN" },
  { key: "indices", label: "Indices", desc: "DJI30, Nikkei, ASX200" },
];

function WeightInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1.5 w-24">
      <Input
        type="number"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
        className="bg-slate-800 border-slate-600 text-white text-xs h-7 w-16 text-center"
      />
      <span className="text-xs text-slate-500">%</span>
    </div>
  );
}

function ParamInput({
  label, value, onChange, min, max, step = 1,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-slate-400 text-xs">{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const n = step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value);
          if (isNaN(n)) return onChange(min);
          onChange(Math.min(max, Math.max(min, n)));
        }}
        className="bg-slate-800 border-slate-600 text-white text-sm h-8"
      />
    </div>
  );
}

function MethodRow({
  enabled, onToggle, label, desc, weight, onWeightChange,
}: {
  enabled: boolean; onToggle: (v: boolean) => void;
  label: string; desc: string;
  weight: number; onWeightChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-800 last:border-0">
      <div className="flex-1 min-w-0 mr-3">
        <div className="text-sm text-white font-medium">{label}</div>
        <div className="text-xs text-slate-500 truncate">{desc}</div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {enabled && <WeightInput value={weight} onChange={onWeightChange} />}
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          className="data-[state=checked]:bg-emerald-600"
        />
      </div>
    </div>
  );
}

export default function Settings() {
  const { toast } = useToast();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: settings, isLoading } = useGetSettings({ query: { refetchInterval: 30000 } as any });
  const updateMut = useUpdateSettings({
    mutation: {
      onSuccess: () => toast({ title: "Settings saved", description: "Bot settings updated." }),
      onError: () => toast({ title: "Save failed", variant: "destructive" }),
    },
  });

  const [form, setForm] = useState<FormState>({
    tradeTime: 60,
    tradeAmount: 1.0,
    tradeAmountType: "fixed",
    maxActiveTrades: 5,
    riskLevel: "mid",
    balanceType: "demo",
    marketCategories: ["otc", "forex", "crypto", "stocks", "indices"],
    tradingMode: "both",
    enableRsi: true,
    enableMacd: true,
    enableBollinger: true,
    enableEma: true,
    enableVolume: true,
    rsiWeight: 20,
    macdWeight: 20,
    bollingerWeight: 20,
    emaWeight: 20,
    volumeWeight: 20,
    enableFinnhub: false,
    finnhubWeight: 20,
    enableTwelveData: false,
    twelveDataWeight: 20,
    enableGemini: false,
    geminiWeight: 20,
    enableAlpaca: false,
    alpacaWeight: 20,
    rsiPeriod: 14,
    rsiOversold: 30,
    rsiOverbought: 70,
    macdFast: 12,
    macdSlow: 26,
    macdSignal: 9,
    bollingerPeriod: 20,
    bollingerStdDev: 2,
    emaFast: 9,
    emaSlow: 21,
  });

  useEffect(() => {
    if (settings) {
      setForm({
        tradeTime: settings.tradeTime ?? 60,
        tradeAmount: settings.tradeAmount ?? 1.0,
        tradeAmountType: (settings as FormState).tradeAmountType ?? "fixed",
        maxActiveTrades: settings.maxActiveTrades ?? 5,
        riskLevel: settings.riskLevel ?? "mid",
        balanceType: settings.balanceType ?? "demo",
        marketCategories: (settings as FormState).marketCategories ?? ["otc", "forex", "crypto", "stocks", "indices"],
        tradingMode: (settings as FormState).tradingMode ?? "both",
        enableRsi: settings.enableRsi ?? true,
        enableMacd: settings.enableMacd ?? true,
        enableBollinger: settings.enableBollinger ?? true,
        enableEma: settings.enableEma ?? true,
        enableVolume: settings.enableVolume ?? true,
        rsiWeight: (settings as FormState).rsiWeight ?? 20,
        macdWeight: (settings as FormState).macdWeight ?? 20,
        bollingerWeight: (settings as FormState).bollingerWeight ?? 20,
        emaWeight: (settings as FormState).emaWeight ?? 20,
        volumeWeight: (settings as FormState).volumeWeight ?? 20,
        enableFinnhub: (settings as FormState).enableFinnhub ?? false,
        finnhubWeight: (settings as FormState).finnhubWeight ?? 20,
        enableTwelveData: (settings as FormState).enableTwelveData ?? false,
        twelveDataWeight: (settings as FormState).twelveDataWeight ?? 20,
        enableGemini: (settings as FormState).enableGemini ?? false,
        geminiWeight: (settings as FormState).geminiWeight ?? 20,
        enableAlpaca: (settings as FormState).enableAlpaca ?? false,
        alpacaWeight: (settings as FormState).alpacaWeight ?? 20,
        rsiPeriod: (settings as FormState).rsiPeriod ?? 14,
        rsiOversold: (settings as FormState).rsiOversold ?? 30,
        rsiOverbought: (settings as FormState).rsiOverbought ?? 70,
        macdFast: (settings as FormState).macdFast ?? 12,
        macdSlow: (settings as FormState).macdSlow ?? 26,
        macdSignal: (settings as FormState).macdSignal ?? 9,
        bollingerPeriod: (settings as FormState).bollingerPeriod ?? 20,
        bollingerStdDev: (settings as FormState).bollingerStdDev ?? 2,
        emaFast: (settings as FormState).emaFast ?? 9,
        emaSlow: (settings as FormState).emaSlow ?? 21,
      });
    }
  }, [settings]);

  const toggleCategory = (key: string) => {
    setForm((f) => {
      const cats = f.marketCategories.includes(key)
        ? f.marketCategories.filter((c) => c !== key)
        : [...f.marketCategories, key];
      return { ...f, marketCategories: cats };
    });
  };

  const handleSave = () => {
    updateMut.mutate({ data: form as BotSettings });
  };

  if (isLoading) {
    return <div className="p-6 text-slate-400">Loading settings...</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-slate-400 mt-0.5">Configure trade parameters and analysis methods</p>
      </div>

      {/* Trade Config */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-white">Trade Configuration</CardTitle>
          <CardDescription className="text-xs text-slate-500">
            OTC markets support 3s/5s/10s. Normal markets require minimum 60s.
          </CardDescription>
        </CardHeader>
        <Separator className="bg-slate-800 mb-4" />
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-slate-300 text-xs">Trade Duration</Label>
              <Select
                value={String(form.tradeTime)}
                onValueChange={(v) => setForm((f) => ({ ...f, tradeTime: Number(v) }))}
              >
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="3">3 seconds (OTC only)</SelectItem>
                  <SelectItem value="5">5 seconds (OTC only)</SelectItem>
                  <SelectItem value="10">10 seconds (OTC only)</SelectItem>
                  <SelectItem value="60">1 minute</SelectItem>
                  <SelectItem value="120">2 minutes</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300 text-xs">Trade Amount</Label>
              <div className="flex gap-2">
                <div className="flex rounded-md border border-slate-600 overflow-hidden text-xs">
                  <button
                    onClick={() => setForm((f) => ({ ...f, tradeAmountType: "fixed" }))}
                    className={cn("px-2.5 py-1.5 transition-colors", form.tradeAmountType === "fixed"
                      ? "bg-slate-600 text-white" : "text-slate-400 hover:bg-slate-800")}
                  >
                    $
                  </button>
                  <button
                    onClick={() => setForm((f) => ({ ...f, tradeAmountType: "percentage" }))}
                    className={cn("px-2.5 py-1.5 transition-colors", form.tradeAmountType === "percentage"
                      ? "bg-slate-600 text-white" : "text-slate-400 hover:bg-slate-800")}
                  >
                    %
                  </button>
                </div>
                <Input
                  type="number"
                  min={form.tradeAmountType === "fixed" ? 1 : 0.1}
                  max={form.tradeAmountType === "percentage" ? 100 : undefined}
                  step={form.tradeAmountType === "fixed" ? 0.5 : 0.1}
                  value={form.tradeAmount}
                  onChange={(e) => setForm((f) => ({ ...f, tradeAmount: parseFloat(e.target.value) || 1 }))}
                  className="bg-slate-800 border-slate-600 text-white flex-1"
                />
              </div>
              <p className="text-xs text-slate-600">
                {form.tradeAmountType === "percentage" ? "% of account balance per trade" : "Fixed USD amount per trade"}
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300 text-xs">Max Simultaneous Trades</Label>
              <Select
                value={String(form.maxActiveTrades)}
                onValueChange={(v) => setForm((f) => ({ ...f, maxActiveTrades: Number(v) }))}
              >
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300 text-xs">Risk Level</Label>
              <Select
                value={form.riskLevel}
                onValueChange={(v) => setForm((f) => ({ ...f, riskLevel: v }))}
              >
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="low">Low — Strong signals only (≥70%)</SelectItem>
                  <SelectItem value="mid">Mid — Moderate signals (≥55%)</SelectItem>
                  <SelectItem value="high">High — Any signal (≥40%)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-slate-300 text-xs">Account Type</Label>
            <Select
              value={form.balanceType}
              onValueChange={(v) => setForm((f) => ({ ...f, balanceType: v }))}
            >
              <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="demo">Demo Account</SelectItem>
                <SelectItem value="real">Real Account</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Market Categories */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-white">Market Categories</CardTitle>
          <CardDescription className="text-xs text-slate-500">
            Select which market types to scan and trade. Unchecked categories are skipped during analysis.
          </CardDescription>
        </CardHeader>
        <Separator className="bg-slate-800 mb-4" />
        <CardContent>
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => setForm((f) => ({ ...f, marketCategories: CATEGORIES.map(c => c.key) }))}
              className="text-xs text-slate-400 hover:text-white transition-colors"
            >
              Select all
            </button>
            <span className="text-slate-700">·</span>
            <button
              onClick={() => setForm((f) => ({ ...f, marketCategories: [] }))}
              className="text-xs text-slate-400 hover:text-white transition-colors"
            >
              Clear
            </button>
          </div>
          <div className="space-y-1">
            {CATEGORIES.map(({ key, label, desc }) => {
              const selected = form.marketCategories.includes(key);
              return (
                <button
                  key={key}
                  onClick={() => toggleCategory(key)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors",
                    selected ? "bg-slate-800 border border-emerald-700/40" : "bg-slate-800/40 border border-transparent hover:bg-slate-800"
                  )}
                >
                  {selected
                    ? <CheckSquare className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                    : <Square className="h-4 w-4 text-slate-500 flex-shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <div className={cn("text-sm font-medium", selected ? "text-white" : "text-slate-400")}>{label}</div>
                    <div className="text-xs text-slate-500">{desc}</div>
                  </div>
                  {selected && (
                    <Badge className="bg-emerald-900/40 text-emerald-300 border-emerald-700 text-[10px]" variant="outline">
                      Active
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Trading Mode */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-white">Trading Mode</CardTitle>
          <CardDescription className="text-xs text-slate-500">
            Choose which engine drives trade selection.
          </CardDescription>
        </CardHeader>
        <Separator className="bg-slate-800 mb-4" />
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {[
              { key: "technical", label: "Technical Only", desc: "RSI, MACD, Bollinger, EMA, Volume" },
              { key: "ai", label: "AI Only", desc: "Mathematical confluence scored by AI" },
              { key: "both", label: "Technical + AI", desc: "Blend indicators with AI scoring" },
            ].map(({ key, label, desc }) => {
              const active = form.tradingMode === key;
              return (
                <button
                  key={key}
                  onClick={() => setForm((f) => ({ ...f, tradingMode: key }))}
                  className={cn(
                    "text-left rounded-md border px-3 py-2.5 transition-colors",
                    active
                      ? "bg-slate-800 border-emerald-600 ring-1 ring-emerald-600/40"
                      : "bg-slate-800/40 border-slate-700 hover:bg-slate-800"
                  )}
                >
                  <div className={cn("text-sm font-medium", active ? "text-white" : "text-slate-300")}>{label}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
                </button>
              );
            })}
          </div>
          {form.tradingMode === "ai" && (
            <p className="text-xs text-purple-300/80 mt-3">
              AI scores the JSON payload of each candidate's technical indicators to rate
              probability. Enable at least one AI method below.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Technical Prediction Methods */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-white">Technical Indicators</CardTitle>
          <CardDescription className="text-xs text-slate-500">
            Toggle and set relative weight (0–100%) for each indicator in the combined score.
          </CardDescription>
        </CardHeader>
        <Separator className="bg-slate-800 mb-4" />
        <CardContent className="space-y-0">
          <MethodRow
            enabled={form.enableRsi} onToggle={(v) => setForm((f) => ({ ...f, enableRsi: v }))}
            label="RSI" desc="Relative Strength Index — overbought/oversold detection"
            weight={form.rsiWeight} onWeightChange={(v) => setForm((f) => ({ ...f, rsiWeight: v }))}
          />
          <MethodRow
            enabled={form.enableMacd} onToggle={(v) => setForm((f) => ({ ...f, enableMacd: v }))}
            label="MACD" desc="Moving Average Convergence Divergence — trend + momentum"
            weight={form.macdWeight} onWeightChange={(v) => setForm((f) => ({ ...f, macdWeight: v }))}
          />
          <MethodRow
            enabled={form.enableBollinger} onToggle={(v) => setForm((f) => ({ ...f, enableBollinger: v }))}
            label="Bollinger Bands" desc="Volatility bands — breakout and reversal detection"
            weight={form.bollingerWeight} onWeightChange={(v) => setForm((f) => ({ ...f, bollingerWeight: v }))}
          />
          <MethodRow
            enabled={form.enableEma} onToggle={(v) => setForm((f) => ({ ...f, enableEma: v }))}
            label="EMA" desc="Exponential Moving Average 9/21 crossover — trend direction"
            weight={form.emaWeight} onWeightChange={(v) => setForm((f) => ({ ...f, emaWeight: v }))}
          />
          <MethodRow
            enabled={form.enableVolume} onToggle={(v) => setForm((f) => ({ ...f, enableVolume: v }))}
            label="Volume" desc="Volume analysis — trade confirmation signal"
            weight={form.volumeWeight} onWeightChange={(v) => setForm((f) => ({ ...f, volumeWeight: v }))}
          />
        </CardContent>
      </Card>

      {/* Indicator Parameters */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-white">Indicator Parameters</CardTitle>
          <CardDescription className="text-xs text-slate-500">
            Fine-tune the calculation inputs for each technical indicator.
          </CardDescription>
        </CardHeader>
        <Separator className="bg-slate-800 mb-4" />
        <CardContent className="space-y-5">
          <div>
            <div className="text-xs font-medium text-slate-300 mb-2">RSI</div>
            <div className="grid grid-cols-3 gap-3">
              <ParamInput label="Period" value={form.rsiPeriod} min={2} max={100}
                onChange={(v) => setForm((f) => ({ ...f, rsiPeriod: v }))} />
              <ParamInput label="Oversold" value={form.rsiOversold} min={1} max={49}
                onChange={(v) => setForm((f) => ({ ...f, rsiOversold: v }))} />
              <ParamInput label="Overbought" value={form.rsiOverbought} min={51} max={99}
                onChange={(v) => setForm((f) => ({ ...f, rsiOverbought: v }))} />
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-slate-300 mb-2">MACD</div>
            <div className="grid grid-cols-3 gap-3">
              <ParamInput label="Fast" value={form.macdFast} min={2} max={100}
                onChange={(v) => setForm((f) => ({ ...f, macdFast: v }))} />
              <ParamInput label="Slow" value={form.macdSlow} min={3} max={200}
                onChange={(v) => setForm((f) => ({ ...f, macdSlow: v }))} />
              <ParamInput label="Signal" value={form.macdSignal} min={2} max={100}
                onChange={(v) => setForm((f) => ({ ...f, macdSignal: v }))} />
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-slate-300 mb-2">Bollinger Bands</div>
            <div className="grid grid-cols-2 gap-3">
              <ParamInput label="Period" value={form.bollingerPeriod} min={2} max={100}
                onChange={(v) => setForm((f) => ({ ...f, bollingerPeriod: v }))} />
              <ParamInput label="Std Dev" value={form.bollingerStdDev} min={0.5} max={5} step={0.1}
                onChange={(v) => setForm((f) => ({ ...f, bollingerStdDev: v }))} />
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-slate-300 mb-2">EMA Crossover</div>
            <div className="grid grid-cols-2 gap-3">
              <ParamInput label="Fast" value={form.emaFast} min={2} max={100}
                onChange={(v) => setForm((f) => ({ ...f, emaFast: v }))} />
              <ParamInput label="Slow" value={form.emaSlow} min={3} max={200}
                onChange={(v) => setForm((f) => ({ ...f, emaSlow: v }))} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI Prediction Methods */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-purple-400" />
            <CardTitle className="text-sm font-medium text-white">AI Prediction Methods</CardTitle>
          </div>
          <CardDescription className="text-xs text-slate-500">
            External data sources used to enhance signal scoring. API keys are configured via environment secrets.
          </CardDescription>
        </CardHeader>
        <Separator className="bg-slate-800 mb-4" />
        <CardContent className="space-y-0">
          {[
            {
              enableKey: "enableFinnhub" as const,
              weightKey: "finnhubWeight" as const,
              label: "Finnhub",
              desc: "News sentiment & real-time market data (finnhub.io)",
              envKey: "FINNHUB_API_KEY",
            },
            {
              enableKey: "enableTwelveData" as const,
              weightKey: "twelveDataWeight" as const,
              label: "Twelve Data",
              desc: "Technical indicators from external feed (twelvedata.com)",
              envKey: "TWELVE_DATA_API_KEY",
            },
            {
              enableKey: "enableGemini" as const,
              weightKey: "geminiWeight" as const,
              label: "Google Gemini",
              desc: "AI-powered signal prediction via Gemini 1.5 Flash",
              envKey: "GEMINI_API_KEY",
            },
            {
              enableKey: "enableAlpaca" as const,
              weightKey: "alpacaWeight" as const,
              label: "Alpaca",
              desc: "Market news sentiment via Alpaca data API",
              envKey: "ALPACA_API_KEY",
            },
          ].map(({ enableKey, weightKey, label, desc }) => (
            <div key={enableKey} className="flex items-center justify-between py-2.5 border-b border-slate-800 last:border-0">
              <div className="flex-1 min-w-0 mr-3">
                <div className="flex items-center gap-2">
                  <div className="text-sm text-white font-medium">{label}</div>
                </div>
                <div className="text-xs text-slate-500">{desc}</div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {form[enableKey] && (
                  <WeightInput value={form[weightKey]} onChange={(v) => setForm((f) => ({ ...f, [weightKey]: v }))} />
                )}
                <Switch
                  checked={form[enableKey]}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, [enableKey]: v }))}
                  className="data-[state=checked]:bg-purple-600"
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={updateMut.isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white w-full sm:w-auto">
        {updateMut.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
        Save Settings
      </Button>
    </div>
  );
}
