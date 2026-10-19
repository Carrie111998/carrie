import { useEffect, useState, type ReactNode } from "react";
import { Activity, Copy, Download, MoreVertical, PlusSquare, Share, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  clearInstallPrompt, detectDevice, getInstallPrompt, installState, isStandalone, onInstallChange, type DeviceKind,
} from "@/lib/device";

export const BLOCK_MESSAGE =
  "This app is available only on Android and iOS smartphones. Please open this link on your mobile phone.";

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-5 text-foreground">
      <div className="w-full max-w-sm space-y-5 rounded-xl border border-card-border bg-card p-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
          <Activity className="h-7 w-7 text-primary" />
        </div>
        <div className="text-lg font-bold">Binance Predict Bot</div>
        {children}
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-left text-sm">
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{n}</span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}

function CopyLink() {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      className="w-full"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(location.href);
          setCopied(true);
        } catch {
          /* clipboard blocked in some in-app browsers */
        }
      }}
    >
      <Copy className="mr-2 h-4 w-4" /> {copied ? "Link copied" : "Copy link"}
    </Button>
  );
}

function AndroidInstall() {
  const [, force] = useState(0);
  const [waiting, setWaiting] = useState(false);
  useEffect(() => onInstallChange(() => force((n) => n + 1)), []);
  const prompt = getInstallPrompt();

  if (installState.installed) {
    return (
      <p className="text-sm">
        Installed. Open <b>Binance Predict Bot</b> from your Home Screen or app drawer to sign up or log in.
      </p>
    );
  }
  return (
    <>
      <p className="text-sm text-muted-foreground">Install the app on your phone, then open it from the Home Screen to sign up or log in.</p>
      {prompt ? (
        <Button
          size="lg"
          className="w-full"
          disabled={waiting}
          onClick={async () => {
            setWaiting(true);
            await prompt.prompt();
            const { outcome } = await prompt.userChoice;
            clearInstallPrompt();
            if (outcome === "accepted") installState.installed = true;
            setWaiting(false);
          }}
        >
          <Download className="mr-2 h-5 w-5" /> Download App
        </Button>
      ) : null}
      <div className="space-y-2 rounded-lg bg-secondary/50 p-3">
        <div className="text-xs font-semibold uppercase text-muted-foreground">
          {prompt ? "Then confirm" : "Add to Home Screen in Chrome"}
        </div>
        <ol className="space-y-2">
          {prompt ? (
            <>
              <Step n={1}>Tap <b>Download App</b> above.</Step>
              <Step n={2}>Tap <b>Install</b> in the box Chrome shows.</Step>
              <Step n={3}>Open the app from your Home Screen.</Step>
            </>
          ) : (
            <>
              <Step n={1}>Tap the menu <MoreVertical className="inline h-4 w-4" /> at the top right of Chrome.</Step>
              <Step n={2}>Tap <b>Install app</b> or <b>Add to Home screen</b>.</Step>
              <Step n={3}>Tap <b>Install</b> to confirm, then open the app from your Home Screen.</Step>
            </>
          )}
        </ol>
      </div>
    </>
  );
}

function IosInstall() {
  return (
    <>
      <p className="text-sm text-muted-foreground">Add the app to your Home Screen, then open it from there to sign up or log in.</p>
      <div className="space-y-2 rounded-lg bg-secondary/50 p-3">
        <div className="text-xs font-semibold uppercase text-muted-foreground">Add to Home Screen in Safari</div>
        <ol className="space-y-2">
          <Step n={1}>Tap the <b>Share</b> button <Share className="inline h-4 w-4" /> in Safari's toolbar (bottom of the screen, or top on some layouts; you may need to tap <b>⋯</b> first).</Step>
          <Step n={2}>Scroll down and tap <b>Add to Home Screen</b> <PlusSquare className="inline h-4 w-4" />.</Step>
          <Step n={3}>Make sure <b>Open as Web App</b> is on if shown, then tap <b>Add</b>.</Step>
          <Step n={4}>Open <b>Binance Predict Bot</b> from your Home Screen.</Step>
        </ol>
      </div>
    </>
  );
}

function OpenIn({ browser, reason }: { browser: "Chrome" | "Safari" | "Chrome or Safari"; reason: string }) {
  return (
    <>
      <p className="text-sm">{reason}</p>
      <p className="text-sm text-muted-foreground">
        Copy this link and open it in <b>{browser}</b> to install the app.
      </p>
      <div className="break-all rounded bg-secondary/50 p-2 text-xs">{location.href}</div>
      <CopyLink />
    </>
  );
}

export default function DeviceGate({ children }: { children: ReactNode }) {
  const [kind] = useState<DeviceKind>(detectDevice);
  const [standalone, setStandalone] = useState(isStandalone);
  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    const update = () => setStandalone(isStandalone());
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  if (kind === "blocked") {
    return (
      <Shell>
        <Smartphone className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="text-sm" role="alert">{BLOCK_MESSAGE}</p>
      </Shell>
    );
  }
  if (standalone) return <>{children}</>;
  if (kind === "webview") {
    return <Shell><OpenIn browser="Chrome or Safari" reason="This page is open inside another app, which can't install it." /></Shell>;
  }
  if (kind === "ios-other") {
    return <Shell><OpenIn browser="Safari" reason="On iPhone the app installs from Safari." /></Shell>;
  }
  if (kind === "android-other") {
    return <Shell><OpenIn browser="Chrome" reason="On Android the app installs from Google Chrome." /></Shell>;
  }
  return <Shell>{kind === "ios-safari" ? <IosInstall /> : <AndroidInstall />}</Shell>;
}
