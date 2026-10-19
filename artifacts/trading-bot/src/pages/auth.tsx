import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Activity, ArrowLeft, Eye, EyeOff, Mail } from "lucide-react";
import { api, type User } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Screen = "login" | "signup" | "signup-otp" | "forgot" | "forgot-otp";

function Shell({ title, subtitle, children, onBack }: { title: string; subtitle?: ReactNode; children: ReactNode; onBack?: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15">
            <Activity className="h-6 w-6 text-primary" />
          </div>
          <div className="text-lg font-bold">Binance Predict Bot</div>
        </div>
        <div className="rounded-lg border border-card-border bg-card p-6 space-y-4">
          <div className="flex items-start gap-2">
            {onBack && (
              <button type="button" onClick={onBack} className="mt-0.5 text-muted-foreground hover:text-foreground" aria-label="Back">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div>
              <h1 className="font-semibold">{title}</h1>
              {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
            </div>
          </div>
          {children}
        </div>
        <p className="mt-4 text-center text-[11px] text-muted-foreground">v{__APP_VERSION__} · Not financial advice. Trade at your own risk.</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    // wrapping label ties the text to its input for screen readers and tap-to-focus
    <Label className="block space-y-1.5 font-normal">
      <span className="text-xs font-medium">{label}</span>
      {children}
    </Label>
  );
}

function PasswordInput({ value, onChange, autoComplete, placeholder }: { value: string; onChange: (v: string) => void; autoComplete: string; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="pr-10"
        required
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function OtpInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="123456"
      className="text-center font-mono text-2xl tracking-[0.5em] h-12"
      autoFocus
      required
    />
  );
}

function ErrorText({ error }: { error: string }) {
  return error ? <p className="text-xs text-red-400" role="alert">{error}</p> : null;
}

function ResendButton({ onResend }: { onResend: () => Promise<void> }) {
  const [wait, setWait] = useState(60);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  return (
    <button
      type="button"
      disabled={wait > 0}
      onClick={async () => {
        await onResend();
        setWait(60);
      }}
      className="text-xs text-primary disabled:text-muted-foreground"
    >
      {wait > 0 ? `Resend code in ${wait}s` : "Resend code"}
    </button>
  );
}

export default function AuthScreen() {
  const { signIn } = useAuth();
  const [screen, setScreen] = useState<Screen>("login");
  const [login, setLogin] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(true);

  useEffect(() => {
    api<{ emailEnabled: boolean }>("/auth/config").then((c) => setEmailEnabled(c.emailEnabled)).catch(() => {});
  }, []);

  const go = (s: Screen) => {
    setError("");
    setCode("");
    setScreen(s);
  };

  async function submit(e: FormEvent, fn: () => Promise<void>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const finish = (r: { user: User; token: string }) => signIn(r.user, r.token);
  const sendSignupCode = () => api("/auth/signup", { method: "POST", body: { username, email, password } });
  const sendResetCode = () => api("/auth/reset", { method: "POST", body: { email } });
  const codeHint = emailEnabled ? (
    <>We sent a 6-digit code to <b className="text-foreground">{email}</b>. It expires in 10 minutes. Check your spam folder too.</>
  ) : screen === "signup-otp" ? (
    <>Email sending isn't set up on this server yet. Enter the default verification code from the admin.</>
  ) : (
    <>Email sending isn't set up on this server yet, so the reset code was written to the server log. Ask the admin for it.</>
  );

  if (screen === "signup-otp" || screen === "forgot-otp") {
    const isSignup = screen === "signup-otp";
    return (
      <Shell title={isSignup ? "Verify your email" : "Reset password"} subtitle={codeHint} onBack={() => go(isSignup ? "signup" : "forgot")}>
        <form
          className="space-y-4"
          onSubmit={(e) =>
            submit(e, async () => {
              if (isSignup) {
                finish(await api("/auth/signup/verify", { method: "POST", body: { email, code } }));
              } else {
                if (password !== confirm) throw new Error("Passwords do not match");
                finish(await api("/auth/reset/verify", { method: "POST", body: { email, code, password } }));
              }
            })
          }
        >
          <div className="flex items-center gap-2 rounded-md bg-secondary/60 px-3 py-2 text-xs">
            <Mail className="h-4 w-4 text-primary flex-shrink-0" />
            <span className="truncate">{email}</span>
          </div>
          <Field label="Verification code">
            <OtpInput value={code} onChange={setCode} />
          </Field>
          {!isSignup && (
            <>
              <Field label="New password">
                <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" placeholder="At least 8 characters" />
              </Field>
              <Field label="Confirm new password">
                <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" />
              </Field>
            </>
          )}
          <ErrorText error={error} />
          <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
            {busy ? "Checking…" : isSignup ? "Verify & create account" : "Set new password"}
          </Button>
          <div className="text-center">
            <ResendButton
              onResend={async () => {
                setError("");
                try {
                  await (isSignup ? sendSignupCode() : sendResetCode());
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
            />
          </div>
        </form>
      </Shell>
    );
  }

  if (screen === "signup") {
    return (
      <Shell title="Create account" subtitle="Each account gets its own bot, settings, API keys and trade history." onBack={() => go("login")}>
        <form
          className="space-y-4"
          onSubmit={(e) =>
            submit(e, async () => {
              if (password !== confirm) throw new Error("Passwords do not match");
              await sendSignupCode();
              go("signup-otp");
            })
          }
        >
          <Field label="Username">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="e.g. carrie" required autoFocus />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" required />
          </Field>
          <Field label="Password">
            <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" placeholder="At least 8 characters" />
          </Field>
          <Field label="Confirm password">
            <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" />
          </Field>
          <ErrorText error={error} />
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Sending code…" : "Sign up — send email code"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Already have an account?{" "}
            <button type="button" className="text-primary" onClick={() => go("login")}>Log in</button>
          </p>
        </form>
      </Shell>
    );
  }

  if (screen === "forgot") {
    return (
      <Shell title="Forgot password" subtitle="Enter your account email and we'll send you a code." onBack={() => go("login")}>
        <form
          className="space-y-4"
          onSubmit={(e) =>
            submit(e, async () => {
              await sendResetCode();
              setPassword("");
              setConfirm("");
              go("forgot-otp");
            })
          }
        >
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
          </Field>
          <ErrorText error={error} />
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Sending…" : "Send code"}
          </Button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell title="Log in" subtitle="Welcome back. Log in to manage your bot.">
      <form
        className="space-y-4"
        onSubmit={(e) => submit(e, async () => finish(await api("/auth/login", { method: "POST", body: { login, password } })))}
      >
        <Field label="Username or email">
          <Input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required autoFocus />
        </Field>
        <Field label="Password">
          <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
        </Field>
        <div className="text-right -mt-2">
          <button type="button" className="text-xs text-primary" onClick={() => go("forgot")}>Forgot password?</button>
        </div>
        <ErrorText error={error} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </Button>
        <div className="relative py-1 text-center text-xs text-muted-foreground">
          <span className="bg-card px-2 relative z-10">New here?</span>
          <div className="absolute inset-x-0 top-1/2 border-t border-border" />
        </div>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => {
            setPassword("");
            setConfirm("");
            go("signup");
          }}
        >
          Create an account
        </Button>
      </form>
    </Shell>
  );
}
