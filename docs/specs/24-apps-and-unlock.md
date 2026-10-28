# Phone apps and the full-game unlock

| | |
|---|---|
| Status | draft (the owner, 2026-10-27: wants it to feel like a native app with "more phone accessibility like haptics"; asked that the browser version keeps working; then iOS; then monetisation: "a straightforward demo plus 2-5 dollar full game unlock"; then allowed the native tooling "as long as it doesn't break the web version"; then set the price: "target a 1.99 price, i want it to be a no brainer just to buy") |
| Milestone | M11 (proposed) |
| Size | L, split in four: the platform layer and the Android shell; native haptics and phone behaviour; the demo and the unlock; iOS |
| Depends on | [11-release.md](11-release.md) (the PWA, the build); [13-thunk.md](13-thunk.md) (the feel table's haptic column) |
| Touch parity | This is the phone version: everything here is for two thumbs |

## Summary

Stompy ships three ways from one codebase: the web version (as now), an
Android app and an iOS app. The apps are thin native shells (Capacitor)
around the same `dist/`. They add what a browser can't do well: real haptics
(ticks and thuds, not buzzes), the back button, full screen, keep-awake, and
pausing when you leave. The game is a **free demo** with a **one-time
unlock** for the rest, priced between $2 and $5 in the stores. No ads, no
currency, nothing else to buy.

## Player experience

### The apps

- It opens straight into the game, full screen, landscape, with no browser
  anywhere: a black splash with the icon, then the menu.
- **Haptics** you feel, by kind:
  - footfalls a light tick;
  - landings, punches and big guns a heavy thud;
  - a heavy hit taken a long rumble;
  - menu taps a click.
  On iPhone, where the browser has no vibration at all, this is new.
- **Back** (Android) pauses, or steps back a screen. On the menu it asks
  `LEAVE STOMPY?` (`YES` / `NO`).
- Leaving the app (home, a call) pauses the match and silences it; coming
  back shows the pause screen.
- The screen doesn't sleep in a match.
- **SETTINGS → CONTROLS:** `HAPTICS` becomes `OFF` / `LIGHT` / `FULL` (it's
  on/off now). Reduced motion still turns them off.

### The demo and the unlock

- **Free (the demo):**
  - Act I (missions 1–4) and its chassis.
  - Free Play with those chassis.
  - Multiplayer with those chassis, so friends with the demo can play with
    friends who own it.
- **The full game, one purchase:**
  - Acts II and III and the contracts after.
  - FIRST FACTORY and the build-and-fight missions.
  - Every chassis.
  - The mechlab's FIT.
  - Anything added later.
- **Where it stops:** after mission 4's debrief, one card in the game's
  voice: `THAT'S THE DEMO.` · `THE REST OF STOMPY: $1.99` · `UNLOCK` /
  `LATER`. The same card shows when you pick a locked mission or chassis,
  as the lock line does now: `FULL GAME`.
- `UNLOCK` opens the store's own purchase sheet. Bought: `UNLOCKED. GO
  STOMP.` and the locks lift. `RESTORE` in SETTINGS finds a purchase on a
  new phone.
- **The web version:**
  - **Default:** the free demo, with the same lock line, which says
    `FULL GAME IN THE APP`.
  - The owner may instead keep the web version fully open (see Open
    questions).
- No timers, no nagging. The card shows only at the end of the demo, or
  when you pick something locked.

New text, in full: `LEAVE STOMPY?` · `YES` · `NO` · `THAT'S THE DEMO.` ·
`THE REST OF STOMPY: $1.99` · `UNLOCK` · `LATER` · `FULL GAME` ·
`UNLOCKED. GO STOMP.` · `RESTORE` · `FULL GAME IN THE APP` · `LIGHT` ·
`FULL`

## Design

### One codebase, three shells

- `npm run build` makes `dist/` as now. `npx cap sync` copies it into
  `android/` and `ios/`, the native projects, which build the store apps.
- Nothing in `src/` imports Capacitor. The shells inject `window.Capacitor`;
  **`src/platform/`** is the only code that looks for it, and uses the
  browser when it isn't there:

  | `platform.` | in an app | in a browser |
  |---|---|---|
  | `haptic(kind, k)` | native haptics (Android: haptic constants and amplitude; iOS: impact generators) | `navigator.vibrate(ms)` as now, or nothing |
  | `onBack(fn)` | the back button | none (Esc and the pause button, as now) |
  | `keepAwake(on)` | keep-awake | the Screen Wake Lock API where there is one |
  | `onPause(fn)` / `onResume(fn)` | app state | `visibilitychange`, as now |
  | `owned()` / `buy()` / `restore()` | the store purchase | `false` (the web is the demo) or `true` (if kept open) |
  | `isApp` | true | false |

- **The rule that stops the versions drifting:** `src/platform/` only adds
  device features. The game never asks which platform it's on, except
  through these calls.

### Haptic kinds

The feel table's `haptic` column (`src/data/feel.js`, milliseconds now)
becomes `[kind, k]`:

- the kinds are `tick`, `thud`, `rumble` and `click`;
- `k` is the strength;
- in a browser, `[kind, k]` maps back to the old milliseconds, so the web
  feels as it does now.

| event | kind |
|---|---|
| step, nearStep | tick |
| land, punch, stomp, fireAc, a big hit | thud |
| heavy damage, a fall landing | rumble |
| buttons | click |

Tuning on a real phone is the owner's call. The table is the starting
point.

### The unlock

- `src/data/demo.js`: what the demo holds (missions m01–m04 and the chassis
  unlocked by then). `isUnlocked` and the campaign's lock check also ask
  `platform.owned()`.
- **The purchase:** Google Play Billing and Apple StoreKit, through one
  Capacitor in-app purchase plugin. It's a non-consumable product
  (`stompy.full`). The store remembers it and `restore()` finds it. Nothing
  is stored on our side and there are no accounts.
- **Saves** stay in localStorage as now. A purchase made on one store
  doesn't unlock another store or the web; each store's own restore covers
  your other phones on that store.

### Networking

- iOS refuses unencrypted connections: the relay must be `wss://` (TLS) for
  the apps.
- LAN play on iOS asks for Local Network permission and needs its
  exception in the app's settings (`Info.plist`).
- Android allows `ws://` on the local network with a network security
  config.

### Tooling

The owner, 2026-10-27: "We can allow for tooling as long as it doesn't
break the web version". So the native tooling below is allowed on these
terms, now in CLAUDE.md and `docs/architecture.md`:

- **Nothing in `src/` imports it.** Only `src/platform/` looks for
  `window.Capacitor`, and it falls back to the browser.
- **The web works without it.** `npm run build`, `npm test`, lint, smoke
  and perf all run without the native tooling installed: Capacitor's
  packages are installed for the shells only, and CI's web job doesn't
  need them.
- **The web is checked as it is now** on every PR. The native shells only
  repackage `dist/`.

What's allowed:

- **Dev only:**
  - `@capacitor/cli`, `@capacitor/android` and `@capacitor/ios`;
  - one in-app purchase plugin;
  - one haptics and app plugin set, or a small native plugin of our own.
- **Building:**
  - Android Studio or Gradle to build the Android app (APK/AAB);
  - a Mac with Xcode for iOS (Apple requires it).
- **CI:**
  - The web checks stay as they are.
  - Add a **WebKit run of the smoke test** (Playwright WebKit on Linux).
    That catches Safari problems for the iOS app and for iPhone browser
    players.
  - The native builds are a manual release step to start with.

### Updating the vision

`vision.md`'s non-goals list "Native apps. The PWA is the app."
That line becomes: "Native shells around the same game (Capacitor), never a
second codebase." It also gains a line on money: "A free demo and one
purchase for the full game. No ads, no currency, no other purchases."

## Code touchpoints

- `src/platform/index.js` (new): the calls above, with browser fallbacks.
- `src/audio/sound.js` `thump`: haptics through `platform.haptic`.
- `src/data/feel.js`: the haptic column as `[kind, k]`.
- `src/input/input.js`, `src/ui/screens.js`: back, pause and resume,
  keep-awake, the HAPTICS setting, RESTORE.
- `src/data/demo.js` (new), `src/data/chassis.js` `isUnlocked`,
  `src/ui/campaign.js`: the demo's locks.
- `src/ui/screens.js` / `debrief.js`: the demo card.
- `capacitor.config.json`, `android/`, `ios/` (new): the shells.
- `docs/vision.md`. The tooling rule in `docs/architecture.md` and
  `CLAUDE.md` is already updated, with this spec.

## Acceptance criteria

1. The web version builds and plays as now (the demo locks aside), and every
   existing check passes.
2. The Android app installs from a debug APK, opens full screen to the menu,
   and plays.
3. On a real phone, footfalls tick and landings thud. HAPTICS LIGHT and OFF
   work.
4. Back pauses; on the menu it asks to leave. Home pauses and silences it.
5. Demo: mission 5, the locked chassis and FIRST FACTORY show `FULL GAME`.
   After mission 4, the demo card shows.
6. A test purchase on Google Play's license-testing account unlocks
   everything, and RESTORE on a reinstall brings it back.
7. iOS (part 4): the same on an iPhone, through TestFlight.

## Tests

- `test/platform.test.js`: the browser fallbacks (haptic kinds to
  milliseconds, owned is false). A fake `window.Capacitor` routes the calls.
- `test/demo.test.js`: the demo's locks, and owning lifting them.
- Smoke: a WebKit run of the existing smoke test. The demo card after
  mission 4 (with mission 4 marked won).
- The owner on a real phone: haptics, back, pause, purchase.

## Performance

Nothing per frame beyond the haptic call that's already there.

## Build order

1. **The platform layer and the Android shell:** `src/platform/`, the
   Capacitor config, a debug APK that plays. Haptics still behave as now.
2. **Native feel:** haptic kinds and the HAPTICS setting; back, pause and
   resume; keep-awake; full screen.
3. **The demo and the unlock:** the demo's locks, the card, the purchase,
   RESTORE, and the web as the demo.
4. **iOS:** the shell, haptics, `wss://` and local network, TestFlight.
   Needs a Mac.

## Open questions

- **The price.** Decided: $1.99 in the US, "a no brainer just to buy".
  Each store sets the local equivalent in other countries; the card shows
  the store's own price string (`THE REST OF STOMPY: £1.99`, …), never a
  number written into the game.
- **The web version.** Default: the free demo, pointing to the apps. The
  other option is to keep it fully open as a free sampler and make money
  only on the stores.
- **What's in the demo.** Default: Act I and its chassis, Free Play and
  multiplayer with those chassis. FIRST FACTORY (the build-and-fight
  mission) could be in the demo as the hook instead of Act I's last
  mission.
- **Desktop stores (Steam, itch.io).** Default: later, the same way, with a
  desktop shell.
- **The relay's hosting.** The apps need a public `wss://` relay. Who hosts
  it and where is the owner's to settle before release.
