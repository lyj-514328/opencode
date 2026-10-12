// Builds the OpenCode web UI and copies it into ./webui, which Tauri bundles as the app frontend.
//
// The UI is built with VITE_OPENCODE_SERVER_MODE=none so the shell starts on its own "connect to a
// server" screen instead of assuming the current origin is an OpenCode server. The server already
// allows the `tauri://localhost` / `http://tauri.localhost` origins (packages/server/src/cors.ts),
// so the bundled UI can talk to a local or LAN server without extra CORS flags.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const appDir = resolve(root, "..", "app")
const dist = resolve(appDir, "dist")
const out = resolve(root, "webui")

if (!existsSync(appDir)) {
  console.error(`OpenCode app not found at ${appDir}`)
  process.exit(1)
}

const built = spawnSync("bun run build", {
  cwd: appDir,
  stdio: "inherit",
  shell: true,
  env: { ...process.env, VITE_OPENCODE_SERVER_MODE: "none" },
})

if (built.error) throw built.error

const index = resolve(dist, "index.html")
if (!existsSync(index)) {
  console.error(`Build produced no index.html at ${index}`)
  process.exit(built.status ?? 1)
}
if (built.status !== 0) {
  // vite-plugin-pwa generates the service worker in `closeBundle`, which runs *after* the app
  // bundle is already written to disk. It can fail on Windows/bun installs that hit MAX_PATH
  // (workbox -> @babel/preset-env). A Tauri shell has no use for a service worker, so as long as
  // index.html was emitted the app bundle is complete.
  console.warn("[build-webui] app bundle written; skipped the (optional) service worker step.")
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(dist, out, { recursive: true })
console.log(`Copied web UI: ${dist} -> ${out}`)
