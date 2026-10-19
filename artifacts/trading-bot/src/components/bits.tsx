import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const fmtUsd = (v: number | null | undefined, digits = 2) =>
  v == null ? "—" : `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const fmtSigned = (v: number | null | undefined, suffix = "") =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}${suffix}`;

export const fmtPct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)}%`);

export const fmtPrice = (v: number | null | undefined) =>
  v == null ? "—" : v >= 100 ? v.toFixed(2) : v >= 1 ? v.toFixed(4) : v.toPrecision(4);

export const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const fmtDateTime = (ms: number) =>
  new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function pnlClass(v: number | null | undefined) {
  if (v == null || v === 0) return "text-muted-foreground";
  return v > 0 ? "text-emerald-400" : "text-red-400";
}

export function Panel({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-card-border bg-card", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-2 border-b border-card-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, valueClass }: { label: string; value: ReactNode; sub?: ReactNode; valueClass?: string }) {
  return (
    <div className="rounded-lg border border-card-border bg-card px-3 py-3 min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground truncate">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold font-mono truncate", valueClass)}>{value}</div>
      {sub != null && <div className="text-xs text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}

export function SideBadge({ side }: { side: string }) {
  const map: Record<string, string> = {
    long: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    short: "bg-red-500/15 text-red-300 border-red-500/30",
    neutral: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  };
  return (
    <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase", map[side] ?? map.neutral)}>
      {side}
    </span>
  );
}

export function ModeBadge({ mode }: { mode: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
        mode === "live" ? "bg-amber-500/20 text-amber-300" : "bg-sky-500/15 text-sky-300",
      )}
    >
      {mode}
    </span>
  );
}

/** Horizontal bar 0-100 with a marker at 50. */
export function Meter({ value, className }: { value: number | null | undefined; className?: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const color = value == null ? "bg-slate-600" : v >= 55 ? "bg-emerald-400" : v >= 50 ? "bg-cyan-400" : v >= 45 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className={cn("relative h-2 w-full rounded-full bg-muted overflow-hidden", className)}>
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${v}%` }} />
      <div className="absolute inset-y-0 left-1/2 w-px bg-foreground/30" />
    </div>
  );
}

/** Signed vote bar -1..1 centred on zero. */
export function VoteBar({ value }: { value: number }) {
  const pct = Math.min(50, Math.abs(value) * 50);
  return (
    <div className="relative h-2 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={cn("absolute inset-y-0", value >= 0 ? "bg-emerald-400 left-1/2" : "bg-red-400 right-1/2")}
        style={{ width: `${pct}%` }}
      />
      <div className="absolute inset-y-0 left-1/2 w-px bg-foreground/40" />
    </div>
  );
}

/** Semi-circular accuracy gauge. */
export function Gauge({ value, label }: { value: number | null | undefined; label: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const angle = Math.PI * (1 - v / 100);
  const x = 60 + 48 * Math.cos(angle);
  const y = 60 - 48 * Math.sin(angle);
  const color = value == null ? "#64748b" : v >= 55 ? "#34d399" : v >= 50 ? "#22d3ee" : v >= 45 ? "#fbbf24" : "#f87171";
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 120 70" className="w-40 max-w-full" role="img" aria-label={`${label}: ${value ?? "no data"}`}>
        <path d="M12 60 A48 48 0 0 1 108 60" fill="none" stroke="hsl(var(--muted))" strokeWidth="10" strokeLinecap="round" />
        {value != null && (
          <path d={`M12 60 A48 48 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" />
        )}
        <text x="60" y="56" textAnchor="middle" className="fill-foreground" fontSize="18" fontWeight="700" fontFamily="monospace">
          {value == null ? "—" : `${v.toFixed(0)}%`}
        </text>
      </svg>
      <div className="text-xs text-muted-foreground -mt-1">{label}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-6 text-center text-sm text-muted-foreground">{children}</div>;
}
