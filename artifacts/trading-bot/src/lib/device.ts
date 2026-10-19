// Client-side device and install detection. This only decides what the user
// sees; the server enforces its own checks on every auth request.

export type DeviceKind =
  | "android-chrome"
  | "android-other" // phone, but a browser that can't install the app (Samsung, Firefox…)
  | "ios-safari"
  | "ios-other" // phone, Chrome/Firefox/Edge on iOS
  | "webview" // in-app browser (Facebook, Instagram, TikTok, Android WebView…)
  | "blocked"; // desktop, laptop, tablet or unknown

type UAData = { mobile?: boolean; platform?: string };

export function detectDevice(): DeviceKind {
  const nav = navigator as Navigator & { userAgentData?: UAData; standalone?: boolean };
  const ua = nav.userAgent;
  const touch = (nav.maxTouchPoints ?? 0) > 0 || "ontouchstart" in window;
  const uaData = nav.userAgentData;
  const platform = (uaData?.platform ?? nav.platform ?? "").toLowerCase();

  // Tablets: iPad (including iPadOS that reports itself as a Mac) and others.
  const iPadAsMac = /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua) || iPadAsMac) return "blocked";

  const iPhone = /iPhone|iPod/.test(ua) || platform === "iphone" || platform === "ipod";
  const android = /Android/.test(ua) || platform === "android";

  let phone = false;
  if (iPhone) phone = touch;
  else if (android) {
    if (uaData?.mobile !== undefined) phone = uaData.mobile;
    else if (/Mobile/.test(ua)) phone = true;
    else {
      // Android without "Mobile" is usually a tablet; only the screen breaks the tie,
      // so phones with unusual sizes still get through via the UA checks above.
      const short = Math.min(screen.width, screen.height);
      phone = touch && short > 0 && short < 600;
    }
  }
  if (!phone) return "blocked";

  const standalone = isStandalone();
  if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|TikTok|musical_ly|Snapchat|Twitter|LinkedInApp|MicroMessenger|; wv\)/i.test(ua)) {
    return "webview";
  }
  if (iPhone) {
    if (/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua)) return "ios-other";
    // iOS in-app views have AppleWebKit but no "Safari/" token; the installed app does the same, so allow that case.
    if (!/Safari\//.test(ua) && !standalone) return "webview";
    return "ios-safari";
  }
  if (/SamsungBrowser|Firefox|OPR|EdgA|UCBrowser|YaBrowser|MiuiBrowser|HuaweiBrowser/.test(ua)) return "android-other";
  return /Chrome\//.test(ua) ? "android-chrome" : "android-other";
}

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches
  );
}

// Chrome fires beforeinstallprompt once, possibly before React mounts, so catch it here.
export type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
export const installState = { installed: false };

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e as InstallPrompt;
  listeners.forEach((l) => l());
});
window.addEventListener("appinstalled", () => {
  deferred = null;
  installState.installed = true;
  listeners.forEach((l) => l());
});

export const getInstallPrompt = () => deferred;
export const clearInstallPrompt = () => {
  deferred = null;
};
export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
