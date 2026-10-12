// Packages a no-install Windows build of the OpenCode shell.
//
// A Tauri release build embeds the bundled web UI into a single native executable, so a "portable"
// package is just that exe: no installer, nothing installed, nothing written next to it. We build
// with `--no-bundle` (skipping the MSI/NSIS step), then collect the executable and a short readme
// into `portable/` and zip it.
//
// The only external dependency is the WebView2 runtime, which ships with Windows 10/11.
import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const config = JSON.parse(readFileSync(resolve(root, "src-tauri", "tauri.conf.json"), "utf8"))
const productName = config.productName ?? "app"
const version = config.version ?? "0.0.0"
const slug = productName.replace(/\s+/g, "-")

const releaseDir = resolve(root, "src-tauri", "target", "release")
const outRoot = resolve(root, "portable")
const outDir = join(outRoot, `${productName} ${version}`)
const zipPath = join(outRoot, `${slug}-${version}-portable.zip`)

if (process.platform !== "win32") {
  console.error("[portable] This package targets Windows. Run it on Windows.")
  process.exit(1)
}

// 1. Release build without the installer/bundling step. This re-runs `bun run webui` first
//    (build.beforeBuildCommand), so the bundled UI is always fresh.
console.log("[portable] building release binary (first run can take several minutes)...")
const built = spawnSync("bun run tauri -- build --no-bundle", { cwd: root, stdio: "inherit", shell: true })
if (built.error) throw built.error
if (built.status !== 0) process.exit(built.status ?? 1)

// 2. Locate the executable Tauri produced.
const exe = findExecutable(config.mainBinaryName)
if (!exe) {
  console.error(`[portable] no executable found in ${releaseDir}`)
  process.exit(1)
}
console.log(`[portable] using ${exe}`)

// 3. Assemble the portable folder.
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
copyFileSync(exe, join(outDir, `${productName}.exe`))
writeFileSync(join(outDir, "README.txt"), readme(productName, version), "utf8")

// 4. Zip it.
rmSync(zipPath, { force: true })
console.log("[portable] zipping...")
const zipped = spawnSync(
  "powershell",
  [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path ${ps(join(outDir, "*"))} -DestinationPath ${ps(zipPath)} -Force`,
  ],
  { stdio: "inherit" },
)
if (zipped.status !== 0) process.exit(zipped.status ?? 1)

const mb = (path) => `${(statSync(path).size / 1024 / 1024).toFixed(1)} MB`
console.log("")
console.log(`[portable] folder : ${outDir}`)
console.log(`[portable] exe    : ${mb(join(outDir, `${productName}.exe`))}`)
console.log(`[portable] zip    : ${zipPath} (${mb(zipPath)})`)

// Tauri names the bundle's main binary after `mainBinaryName`, which falls back to the product
// name or the crate name depending on the version. Try the known names, then the newest exe.
function findExecutable(mainBinaryName) {
  const names = [mainBinaryName, productName, "opencode-mobile"].filter(Boolean)
  for (const name of names) {
    const candidate = join(releaseDir, `${name}.exe`)
    if (existsSync(candidate)) return candidate
  }
  if (!existsSync(releaseDir)) return
  return readdirSync(releaseDir)
    .filter((file) => file.endsWith(".exe"))
    .map((file) => join(releaseDir, file))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
}

// Single-quote a value for the PowerShell command line.
function ps(value) {
  return `'${value.replace(/'/g, "''")}'`
}

function readme(name, version) {
  return [
    `${name} ${version} - Windows portable build`,
    "=".repeat(44),
    "",
    "This is a single-file, no-install build: nothing is installed and nothing is written next to",
    "the executable. Settings live in your user profile, so you can move or delete the folder freely.",
    "",
    "How to run",
    `  1. Double-click "${name}.exe".`,
    '  2. The app opens on its "connect to a server" screen.',
    "  3. Paste a pairing link from `opencode pair`, or enter the server address and password.",
    "     The connection is remembered, so you only pair once.",
    "",
    "Requirements",
    "  - Windows 10/11 (WebView2 runtime, included with current Windows).",
    "  - An OpenCode server to connect to. On the server machine run:",
    "      opencode serve --hostname 0.0.0.0 --port 4096",
    "      opencode pair",
    "",
    "This is a personal/unofficial build and is not affiliated with the OpenCode team.",
    "",
  ].join("\r\n")
}
