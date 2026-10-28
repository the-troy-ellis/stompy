// The device layer (docs/specs/24-apps-and-unlock.md). The phone apps are
// Capacitor shells around the same dist/: the shell injects window.Capacitor,
// and this is the only code that looks for it. Everywhere else the game asks
// these calls, never which platform it's on, and in a browser each one falls
// back to what the browser has. So the web plays exactly as it did.
//
// Part 1 (now): isApp, os, haptic in milliseconds, hidden.
// Native haptic kinds, back, keep-awake (part 2) and the unlock (part 3) come
// later, here.

export function createPlatform(win = typeof window === 'undefined' ? undefined : window) {
  const cap = win?.Capacitor, doc = win?.document, nav = win?.navigator;
  const isApp = !!cap?.isNativePlatform?.();
  return {
    isApp,
    os: isApp ? cap.getPlatform() : 'web',   // 'android', 'ios' or 'web'
    // A buzz of `ms` milliseconds. The Android shell grants VIBRATE, so the
    // web call works there too until part 2's native kinds.
    haptic(ms) { try { nav?.vibrate?.(ms); } catch { /* unsupported */ } },
    // The page out of sight: a background tab, or the app sent home (the
    // WebView hides the page when the app pauses).
    hidden: () => !!doc?.hidden,
  };
}

export const platform = createPlatform();
