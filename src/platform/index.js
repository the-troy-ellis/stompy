// The device layer (docs/specs/24-apps-and-unlock.md). The phone apps are
// Capacitor shells around the same dist/: the shell injects window.Capacitor,
// and this is the only code that looks for it. Everywhere else the game asks
// these calls, never which platform it's on, and in a browser each one falls
// back to what the browser has. So the web plays exactly as it did.
//
// Part 1 (now): isApp, os, haptic in milliseconds, hidden. The Steam Deck
// app (Electron, deck/) adds window.stompyShell, read only by onShellUpdate;
// rumble is the Gamepad API's own.
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
    // The Steam Deck app (deck/, docs/specs/40-steam-deck.md) downloads its next
    // build while you play; when it's in place, `cb(apply)` is called once, and
    // `apply()` restarts the app into it. Nothing happens anywhere else.
    onShellUpdate(cb) {
      const shell = win?.stompyShell;
      if (!shell?.onUpdateReady) return;
      shell.onUpdateReady(() => cb(() => shell.restart()));
    },
    // Rumble in the controller (the Steam Deck's, docs/specs/40-steam-deck.md):
    // the feel table's haptic column (`ms`, 8 for a footfall to 110 for a
    // blast-off) as a dual-rumble pulse on the first pad that has one. Short
    // pulses on the weak motor, big ones bring in the strong motor and last a
    // little longer; the pad plays one effect at a time, the newest winning.
    rumble(ms) {
      try {
        const pads = nav?.getGamepads?.() || [];
        for (const gp of pads) {
          const act = gp?.vibrationActuator;
          if (!act?.playEffect) continue;
          act.playEffect('dual-rumble', rumbleOf(ms))?.catch?.(() => {});
          return true;
        }
      } catch { /* no pad, or no rumble on it */ }
      return false;
    },
  };
}

// A dual-rumble effect for a haptic of `ms`: the duration in ms and the two
// motors' strengths, 0..1. Pure, for the tests.
export function rumbleOf(ms) {
  const k = Math.max(0, Math.min(1, ms / 100));
  return { duration: Math.round(Math.max(30, Math.min(220, ms * 2))), weakMagnitude: Math.min(1, k * 2.5), strongMagnitude: Math.max(0, (k - 0.2) * 1.25), startDelay: 0 };
}

export const platform = createPlatform();
