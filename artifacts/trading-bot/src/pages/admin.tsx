import { useCallback, useEffect, useState } from "react";
import { KeyRound, Pause, Pencil, Play, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useBot } from "@/hooks/useBot";
import { api, type AdminUser } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Empty, fmtDateTime, fmtPct, fmtUsd } from "@/components/bits";
import { cn } from "@/lib/utils";

type Pending = { kind: "reset" | "hold" | "resume" | "delete"; user: AdminUser } | null;

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase", className)}>{children}</span>;
}

function EditRow({ user, onSaved, onCancel }: { user: AdminUser; onSaved: () => void; onCancel: () => void }) {
  const { run } = useBot();
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email);
  return (
    <form
      className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run("Could not save user", () => api(`/admin/users/${user.id}`, { method: "PATCH", body: { username, email } }));
        if (ok) onSaved();
      }}
    >
      <Input value={username} onChange={(e) => setUsername(e.target.value)} aria-label="Username" />
      <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
      <div className="flex gap-2">
        <Button type="submit" size="sm">Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} aria-label="Cancel"><X className="h-4 w-4" /></Button>
      </div>
    </form>
  );
}

export default function Admin() {
  const { user: me } = useAuth();
  const { run } = useBot();
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(() => api<AdminUser[]>("/admin/users").then(setUsers).catch(() => setUsers([])), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  if (!me?.isAdmin) return <div className="p-6"><Empty>Admins only.</Empty></div>;

  async function confirmAction() {
    if (!pending) return;
    const { kind, user } = pending;
    const ok = await run("Action failed", async () => {
      if (kind === "reset") {
        const r = await api<{ defaultPassword: string }>(`/admin/users/${user.id}/reset-password`, { method: "POST" });
        toast({ title: `Password reset for ${user.username}`, description: `New password: ${r.defaultPassword} — they must change it at next login.` });
      } else if (kind === "hold" || kind === "resume") {
        await api(`/admin/users/${user.id}/hold`, { method: "POST", body: { held: kind === "hold" } });
        toast({ title: kind === "hold" ? `${user.username} is on hold — all trading stopped` : `${user.username} resumed` });
      } else {
        await api(`/admin/users/${user.id}`, { method: "DELETE" });
        toast({ title: `${user.username} deleted` });
      }
    });
    setPending(null);
    setTyped("");
    if (ok) load();
  }

  const shown = (users ?? []).filter((u) => `${u.username} ${u.email}`.toLowerCase().includes(query.toLowerCase()));
  const held = (users ?? []).filter((u) => u.held).length;

  const dialog: Record<NonNullable<Pending>["kind"], { title: string; body: string; action: string; danger?: boolean }> = {
    reset: { title: "Reset password to 123456?", body: "They'll be logged out everywhere and must choose a new password at their next login.", action: "Reset password" },
    hold: { title: "Put account on hold?", body: "Stops their bot and live trading immediately. They can't use the account until you resume it.", action: "Hold account", danger: true },
    resume: { title: "Resume account?", body: "They can log in and use the bot again. Their bot stays stopped until they start it.", action: "Resume account" },
    delete: { title: "Delete account permanently?", body: "Deletes the user, their bot, all trades, settings, API keys and wallet session. This can't be undone.", action: "Delete forever", danger: true },
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold"><ShieldCheck className="h-5 w-5 text-primary" /> Admin · Manage users</h1>
          <p className="text-xs text-muted-foreground">
            {users ? `${users.length} users · ${held} on hold` : "Loading…"} · only admins can see this page.
          </p>
        </div>
        <div className="flex gap-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or email" className="sm:w-64" />
          <Button variant="secondary" size="icon" onClick={load} aria-label="Refresh"><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>

      {users == null ? (
        <Empty>Loading users…</Empty>
      ) : shown.length === 0 ? (
        <Empty>No users found.</Empty>
      ) : (
        <div className="space-y-3">
          {shown.map((u) => {
            const self = u.id === me.id;
            return (
              <div key={u.id} className={cn("rounded-lg border bg-card p-4", u.held ? "border-amber-500/50" : "border-card-border")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold">{u.username}</span>
                      {u.isAdmin && <Badge className="bg-primary/15 text-primary">admin</Badge>}
                      {u.held && <Badge className="bg-amber-500/20 text-amber-300">on hold</Badge>}
                      {u.mustChangePassword && <Badge className="bg-sky-500/15 text-sky-300">must change password</Badge>}
                      {u.running && <Badge className="bg-emerald-500/15 text-emerald-300">bot running</Badge>}
                      {u.liveEnabled && <Badge className="bg-amber-500/20 text-amber-300">live</Badge>}
                    </div>
                    <div className="mt-0.5 break-all text-sm text-foreground/90">{u.email}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Joined {fmtDateTime(u.createdAt)}
                      {u.heldAt ? ` · held since ${fmtDateTime(u.heldAt)}` : ""}
                      {u.paperTrades != null && ` · ${u.paperTrades} paper trades (${fmtPct(u.paperWinRate)} won) · balance ${fmtUsd(u.paperBalance)}`}
                      {u.liveTrades ? ` · ${u.liveTrades} live trades` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(editing === u.id ? null : u.id)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                    </Button>
                    <Button size="sm" variant="secondary" disabled={self} onClick={() => setPending({ kind: "reset", user: u })}>
                      <KeyRound className="h-3.5 w-3.5 mr-1" /> Reset password
                    </Button>
                    {u.held ? (
                      <Button size="sm" onClick={() => setPending({ kind: "resume", user: u })}>
                        <Play className="h-3.5 w-3.5 mr-1" /> Resume
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" className="text-amber-300" disabled={self} onClick={() => setPending({ kind: "hold", user: u })}>
                        <Pause className="h-3.5 w-3.5 mr-1" /> Hold all trades
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="text-red-400" disabled={self} onClick={() => setPending({ kind: "delete", user: u })}>
                      <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                    </Button>
                  </div>
                </div>
                {editing === u.id && (
                  <EditRow
                    user={u}
                    onCancel={() => setEditing(null)}
                    onSaved={() => {
                      setEditing(null);
                      load();
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={pending != null} onOpenChange={(v) => { if (!v) { setPending(null); setTyped(""); } }}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
          {pending && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{dialog[pending.kind].title}</AlertDialogTitle>
                <AlertDialogDescription>
                  <b>{pending.user.username}</b> ({pending.user.email}). {dialog[pending.kind].body}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {pending.kind === "delete" && (
                <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`Type ${pending.user.username} to confirm`} />
              )}
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={pending.kind === "delete" && typed !== pending.user.username}
                  className={dialog[pending.kind].danger ? "bg-red-500 text-white hover:bg-red-400" : undefined}
                  onClick={confirmAction}
                >
                  {dialog[pending.kind].action}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
