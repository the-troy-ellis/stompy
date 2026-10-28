# The phone apps' shells

Stompy's Android (and later iOS) app: a [Capacitor](https://capacitorjs.com)
shell around the same `../dist/` the web version ships
([spec 24](../docs/specs/24-apps-and-unlock.md)). None of this is needed for
the web version: nothing in `src/` imports it, and the root `npm ci`,
`npm run build` and every web check run without it.

## A debug APK without installing anything

GitHub builds one: Actions → **Android** → **Run workflow** (it also runs on
PRs that touch `app/` or `src/platform/`). The run's `stompy-debug-apk`
artifact is a zip with the APK in it. On the phone, allow installs from your
browser or files app and open the APK.

## Building it yourself

Needs Node 22, JDK 21 and the Android SDK (Android Studio installs it).

```sh
npm ci && npm run build        # the web build, in the repo root
cd app && npm ci
npm run apk                    # copies ../dist in and runs Gradle
# the APK: android/app/build/outputs/apk/debug/app-debug.apk
```

`npx cap open android` opens the project in Android Studio, to run it on a
phone over USB.

## What's here

- `capacitor.config.json`: the app id, the name, and `../dist` as the page.
  `allowMixedContent` lets the app (served from `https://localhost`) reach a
  `ws://` arena on the local network.
- `android/`: the native project Capacitor generated, plus landscape only and
  the vibrate permission in `AndroidManifest.xml`. `npx cap sync` copies the
  web build into it; the copy isn't committed.
