import { useCallback, useEffect, useState } from "react";
import { Brain, FlaskConical, Lightbulb, Users, Wand2 } from "lucide-react";
import { useBot } from "@/hooks/useBot";
import { api, type GroupRow } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Empty, Meter, Panel, Stat, fmtDateTime, fmtPct, fmtSigned, pnlClass } from "@/components/bits";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type BrainInfo = {
  updatedAt: number;
  updatedBy: string;
  log: { time: number; source: "admin" | "auto-tune"; by?: string; changes: { param: string; from: unknown; to: unknown; reason?: string }[] }[];
};

function GroupTable({ rows, keyLabel, fmtKey }: { rows: GroupRow[]; keyLabel: string; fmtKey?: (k: string) => string }) {
  if (!rows.length) return <Empty>No data yet.</Empty>;
  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr className="text-left">
            <th className="py-1.5 font-normal">{keyLabel}</th>
            <th className="py-1.5 font-normal text-right">Trades</th>
            <th className="py-1.5 font-normal text-right">Win rate</th>
            <th className="py-1.5 font-normal text-right">P&L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border">
              <td className="py-1.5 font-mono capitalize">{fmtKey ? fmtKey(r.key) : r.key}</td>
              <td className="py-1.5 text-right font-mono">{r.trades}</td>
              <td className={cn("py-1.5 text-right font-mono", r.winRate >= 50 ? "text-emerald-700" : r.winRate < 40 ? "text-red-700" : "")}>
                {fmtPct(r.winRate)}
              </td>
              <td className={cn("py-1.5 text-right font-mono", pnlClass(r.pnl))}>{fmtSigned(r.pnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmtValue(v: unknown) {
  if (Array.isArray(v)) return v.length ? v.join(", ") : "none";
  if (typeof v === "boolean") return v ? "on" : "off";
  return String(v);
}

export default function Learning() {
  const { state, run } = useBot();
  const { toast } = useToast();
  const [brain, setBrain] = useState<BrainInfo | null>(null);
  const loadBrain = useCallback(() => api<BrainInfo>("/brain").then(setBrain).catch(() => {}), []);
  useEffect(() => {
    loadBrain();
    const t = setInterval(loadBrain, 30_000);
    return () => clearInterval(t);
  }, [loadBrain]);
  const L = state?.learning;
  const study = L?.lossStudy;
  const calibrating = state?.status?.calibrating;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">Learning & auto-tune</h1>
          <p className="text-xs text-muted-foreground">
            The bot scores every prediction after it plays out, studies every losing trade, and re-tunes its own settings.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!!calibrating}
            onClick={() => run("Calibration failed", () => api("/learning/calibrate", { method: "POST" }))}
          >
            <FlaskConical className="h-4 w-4 mr-1.5" />
            {calibrating ? `Calibrating ${calibrating.progress}%` : "Calibrate on history"}
          </Button>
          <Button
            onClick={() =>
              run("Auto-tune failed", async () => {
                const r = await api<{ message: string }>("/learning/autotune", { method: "POST" });
                toast({ title: "Shared brain auto-tune", description: r.message });
                loadBrain();
              })
            }
          >
            <Wand2 className="h-4 w-4 mr-1.5" /> Auto-tune now
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Prediction accuracy" value={fmtPct(L?.predictions.accuracy)} sub={`${L?.predictions.total ?? 0} scored`} />
        <Stat label="Recent accuracy" value={fmtPct(L?.predictions.recentAccuracy)} sub="last 200" />
        <Stat label="AI model" value={L?.aiModel.active ? "Active" : "Learning"} sub={`${L?.aiModel.samples ?? 0} / ${L?.aiModel.minSamples ?? 30} samples`} />
        <Stat
          label="Calibration"
          value={L?.calibration ? `${L.calibration.samples}` : "—"}
          sub={L?.calibration ? `samples · ${fmtDateTime(L.calibration.time)}` : "not run yet"}
        />
      </div>

      <Panel title={<span className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> Community learning</span>}>
        {!L?.community?.enabled ? (
          <Empty>Community learning is off — turn it on in Settings → Auto-tune.</Empty>
        ) : !L.community.trades ? (
          <Empty>Collecting… the pooled dataset updates every 10 minutes once users have settled trades.</Empty>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Users" value={L.community.users} />
              <Stat label="Pooled trades" value={L.community.trades.toLocaleString()} />
              <Stat label="Community win rate" value={fmtPct(L.community.winRate)} />
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(L.community.byMode ?? {}).map(([k, m]) => (
                <span key={k} className="rounded bg-secondary px-2 py-1">
                  {k.replace("-", " · ")}: <b>{m.trades}</b> trades, {fmtPct(m.trades ? (100 * m.wins) / m.trades : null)} won
                </span>
              ))}
            </div>
            {!!L.community.insights?.length && (
              <ul className="space-y-1 text-sm">
                {L.community.insights.map((i) => (
                  <li key={i} className="flex gap-2"><span className="text-primary">•</span><span>{i}</span></li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-muted-foreground">
              Settled trades from every user (dummy paper, paper and live) are pooled anonymously — no names, emails or order IDs — to tune
              indicator weights, confidence and filters for everyone. New accounts start with the community's learned settings.
              {L.community.updatedAt ? ` Updated ${fmtDateTime(L.community.updatedAt)}.` : ""}
            </p>
          </div>
        )}
      </Panel>

      <Panel title={<span className="flex items-center gap-2"><Lightbulb className="h-4 w-4 text-amber-700" /> Loss study</span>}>
        {study ? (
          <div className="space-y-4">
            <div className="text-xs text-muted-foreground">
              {study.totalLosses} losses out of {study.totalTrades} paper trades ({fmtPct(study.lossRate)} loss rate)
            </div>
            <ul className="space-y-1.5 text-sm">
              {study.insights.map((i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-amber-700">•</span>
                  <span>{i}</span>
                </li>
              ))}
            </ul>
            {study.byExitReason.length > 0 && (
              <div className="flex flex-wrap gap-2 text-xs">
                {study.byExitReason.map((r) => (
                  <span key={r.reason} className="rounded bg-secondary px-2 py-1">
                    {r.reason.replace("_", " ")}: <b>{r.count}</b>
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <Empty>No trades studied yet.</Empty>
        )}
      </Panel>

      <Panel title={<span className="flex items-center gap-2"><Brain className="h-4 w-4 text-primary" /> Indicator accuracy & weights</span>}>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-xs min-w-[520px]">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1.5 font-normal">Indicator</th>
                <th className="py-1.5 font-normal w-1/3">Accuracy</th>
                <th className="py-1.5 font-normal text-right">Recent</th>
                <th className="py-1.5 font-normal text-right">Samples</th>
                <th className="py-1.5 font-normal text-right">Weight</th>
              </tr>
            </thead>
            <tbody>
              {(L?.indicators ?? []).map((i) => (
                <tr key={i.key} className={cn("border-t border-border", !i.enabled && "opacity-40")}>
                  <td className="py-2">
                    <div className="font-medium">{i.label}</div>
                    <div className="text-[10px] text-muted-foreground capitalize">{i.kind}{!i.enabled && " · disabled"}</div>
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <Meter value={i.samples > 0 ? i.accuracy : null} />
                      <span className="font-mono w-12 text-right">{i.samples > 0 ? fmtPct(i.accuracy) : "—"}</span>
                    </div>
                  </td>
                  <td className="py-2 text-right font-mono">{fmtPct(i.recentAccuracy)}</td>
                  <td className="py-2 text-right font-mono">{i.samples}</td>
                  <td className="py-2 text-right font-mono">{i.weight.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Accuracy = how often the indicator's direction matched what price actually did. Samples are decay-weighted so recent market behaviour counts
          most. Auto-tune raises weights of accurate indicators and lowers weights of misleading ones.
        </p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Win rate by pair">
          <GroupTable rows={study?.bySymbol ?? []} keyLabel="Pair" />
        </Panel>
        <Panel title="Win rate by confidence">
          <GroupTable rows={study?.byConfidence ?? []} keyLabel="Confidence %" />
        </Panel>
        <Panel title="Win rate by hour (UTC)">
          <GroupTable rows={study?.byHour ?? []} keyLabel="Hour" fmtKey={(k) => `${k.padStart(2, "0")}:00`} />
        </Panel>
        <Panel title="Market regime & direction">
          <GroupTable rows={[...(study?.byRegime ?? []), ...(study?.byDirection ?? [])]} keyLabel="Group" />
        </Panel>
      </div>

      <Panel title="Indicators that backed losing trades">
        {study?.misleading.length ? (
          <div className="space-y-2">
            {study.misleading.slice(0, 8).map((m) => (
              <div key={m.indicator} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{m.label}</span>
                <span className="font-mono text-muted-foreground flex-shrink-0">
                  losers {fmtPct(m.lossBacking)} · winners {fmtPct(m.winBacking)} ·{" "}
                  <span className={m.lift > 0 ? "text-red-700" : "text-emerald-700"}>{fmtSigned(m.lift)}</span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No data yet.</Empty>
        )}
      </Panel>

      <Panel title="Shared brain — change history">
        {brain?.log.length ? (
          <div className="space-y-3">
            {brain.log.map((entry) => (
              <div key={entry.time} className="border-l-2 border-primary/50 pl-3">
                <div className="text-xs text-muted-foreground">
                  {fmtDateTime(entry.time)} · {entry.source === "admin" ? `edited by ${entry.by ?? "admin"}` : "auto-tune from all users' trades"}
                </div>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {entry.changes.map((c, i) => (
                    <li key={i}>
                      <span className="font-mono">{c.param}</span>: {fmtValue(c.from)} → <b>{fmtValue(c.to)}</b>{" "}
                      {c.reason && <span className="text-muted-foreground">— {c.reason}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No changes yet. Auto-tune checks all users' new settled trades every 10 minutes.</Empty>
        )}
      </Panel>
    </div>
  );
}
