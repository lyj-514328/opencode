# @opencode/mobile

A cross-platform (**Windows** / **Android**) shell around the OpenCode web UI, built with
[Tauri v2](https://tauri.app). It lives in this fork as a workspace package (`packages/mobile`).

> Personal/unofficial build. It is **not built by the OpenCode team and is not affiliated with
> it**. See the upstream project at [`github.com/anomalyco/opencode`](https://github.com/anomalyco/opencode).

## How it works

- Tauri bundles the OpenCode web UI (built from `packages/app`) into the app.
- The UI is built with `VITE_OPENCODE_SERVER_MODE=none`, so the app opens on its
  "connect to a server" screen instead of assuming its own origin is the server.
- Connect by entering a server address + password, pasting an `opencode pair` link, or
  scanning its QR code.
- The OpenCode server already allows the Tauri origins (`tauri://localhost`,
  `http://tauri.localhost`) in `packages/server/src/cors.ts`, so no extra CORS setup is
  needed for local or LAN servers.

## Prerequisites

- Rust (MSVC toolchain) + Visual Studio C++ build tools
- WebView2 Runtime (preinstalled on Windows 10/11)
- [Bun](https://bun.sh) — installs the workspace and builds the OpenCode web UI
- For Android: Android SDK + NDK, JDK 17+, and the Android rust targets

## Windows

From the repository root:

```bash
bun install                              # once, for the whole workspace
bun run --cwd packages/mobile webui      # build the OpenCode web UI into ./webui
bun run --cwd packages/mobile dev        # run the app (hot-reloads the Rust side)
bun run --cwd packages/mobile build      # installer in src-tauri/target/release/bundle
```

There is also a root convenience script:

```bash
bun run dev:mobile
```

`build` re-runs `webui` first (via `beforeBuildCommand`), so the bundled UI is always fresh.

Start the OpenCode server on the machine you want to control:

```bash
opencode serve --hostname 0.0.0.0 --port 4096   # allow LAN access
opencode pair                                    # one-time link + QR code
```

Then in the app's connect screen, enter the address/password or paste the pairing link.

### Windows portable build

```bash
bun run --cwd packages/mobile portable
# -> packages/mobile/portable/OpenCode Mobile <version>/  +  <name>-<version>-portable.zip
```

`portable` builds the release binary with `--no-bundle` and collects it (plus a short
`README.txt`) into `portable/`, then zips it. The result is a single self-contained `.exe`: no
installer, nothing installed, nothing written next to it — move it anywhere and double-click.

## Android (next step)

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
bun run --cwd packages/mobile android:init    # one-time: creates src-tauri/gen/android
bun run --cwd packages/mobile android:dev     # run on a device/emulator
bun run --cwd packages/mobile android:build   # build APK/AAB
```

Requires `ANDROID_HOME`/`ANDROID_SDK_ROOT` set and the NDK installed.

## CI builds (GitHub Actions)

`.github/workflows/mobile.yml` builds both packages on every push to the `mobile-shell` branch and
on tags matching `mobile-v*`. It can also be started by hand from the **Actions** tab
(*mobile* → *Run workflow*).

- **windows (portable exe)** → artifact `opencode-mobile-windows` (the portable `.zip`)
- **android (apk)** → artifact `opencode-mobile-android` (debug-signed, arm64, installable)

Grab them from the **Artifacts** section of a run. Pushing a `mobile-v*` tag (e.g. `git tag
mobile-v0.1.0 && git push origin mobile-v0.1.0`) additionally attaches both files to a GitHub
Release.

> This workflow uses GitHub-hosted runners on purpose. The other workflows in this repository target
> Blacksmith runners, which only exist on the upstream organization.

## Layout

```
packages/mobile/
  scripts/build-webui.mjs     # builds ../app (packages/app), copies dist -> webui/
  scripts/build-portable.mjs  # release build -> portable/ folder + zip (portable script)
  webui/                      # bundled OpenCode web UI (generated, gitignored)
  portable/                   # portable Windows package (generated, gitignored)
  src-tauri/                  # Rust crate + Tauri config + icons
```

## Customizing later

- UI / interaction changes: edit `packages/app`, then rebuild `webui`.
- Native features (tray, autostart, notifications, deep links): add Rust in `src-tauri/src`
  and Tauri plugins.
- Icons: `bun run --cwd packages/mobile tauri icon <path-to-1024px.png>`.
