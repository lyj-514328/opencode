// Prepares the generated Android project for a signed *release* build.
//
// `tauri android init` recreates `src-tauri/gen/android` on every run, so the signing config the
// Tauri docs describe (a `signingConfigs` block wired into the `release` build type) cannot live in
// git — it has to be (re)applied afterwards. This script writes `keystore.properties` and patches
// `app/build.gradle.kts`, and is safe to run repeatedly.
//
// Keystore input (one of):
//   ANDROID_KEYSTORE_BASE64   base64 of the .jks (CI; decoded to $RUNNER_TEMP or the temp dir)
//   ANDROID_KEYSTORE_PATH     path to a local .jks
// Plus:
//   ANDROID_KEYSTORE_PASSWORD  keystore and key password
//   ANDROID_KEY_ALIAS          key alias inside the keystore
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const gradle = resolve(root, "src-tauri", "gen", "android", "app", "build.gradle.kts")
const properties = resolve(root, "src-tauri", "gen", "android", "keystore.properties")

if (!existsSync(gradle)) {
  console.error(`[signing] ${gradle} not found. Run \`tauri android init\` first.`)
  process.exit(1)
}

const keystore = resolveKeystore()
writeKeystoreProperties(keystore)
patchGradle()

function resolveKeystore() {
  if (process.env.ANDROID_KEYSTORE_BASE64) {
    const path = join(process.env.RUNNER_TEMP ?? tmpdir(), "opencode-mobile-release.jks")
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, Buffer.from(process.env.ANDROID_KEYSTORE_BASE64, "base64"))
    return path
  }
  if (process.env.ANDROID_KEYSTORE_PATH) return resolve(process.env.ANDROID_KEYSTORE_PATH)
  console.error("[signing] set ANDROID_KEYSTORE_BASE64 (CI) or ANDROID_KEYSTORE_PATH (local)")
  process.exit(1)
}

function writeKeystoreProperties(keystore) {
  const password = requireEnv("ANDROID_KEYSTORE_PASSWORD")
  const alias = requireEnv("ANDROID_KEY_ALIAS")
  writeFileSync(
    properties,
    [
      `storeFile=${keystore}`,
      `storePassword=${password}`,
      `keyAlias=${alias}`,
      `keyPassword=${password}`,
      "",
    ].join("\n"),
  )
  console.log(`[signing] wrote ${properties}`)
}

function patchGradle() {
  const source = readFileSync(gradle, "utf8")
  if (source.includes('signingConfigs.getByName("release")')) {
    console.log("[signing] build.gradle.kts already patched")
    return
  }

  // Mirrors https://v2.tauri.app/distribute/sign/android/. `rootProject.file("keystore.properties")`
  // resolves to src-tauri/gen/android, where the properties file is written above.
  const signingConfigs = [
    "    signingConfigs {",
    '        create("release") {',
    "            val keystoreProperties = Properties()",
    '            val keystorePropertiesFile = rootProject.file("keystore.properties")',
    "            if (keystorePropertiesFile.exists()) {",
    "                keystoreProperties.load(FileInputStream(keystorePropertiesFile))",
    "            }",
    '            keyAlias = keystoreProperties.getProperty("keyAlias")',
    '            keyPassword = keystoreProperties.getProperty("keyPassword")',
    '            storeFile = keystoreProperties.getProperty("storeFile")?.let { file(it) }',
    '            storePassword = keystoreProperties.getProperty("storePassword")',
    "        }",
    "    }",
  ].join("\n")

  let patched = replaceOnce(
    source,
    "import java.util.Properties",
    "import java.io.FileInputStream\nimport java.util.Properties",
  )
  patched = replaceOnce(patched, "    buildTypes {", `${signingConfigs}\n    buildTypes {`)
  // The template leaves release on the default "false"; flip it so release builds can reach a plain
  // HTTP server too, matching the old debug APK.
  patched = replaceOnce(
    patched,
    '        getByName("release") {',
    [
      '        getByName("release") {',
      '            signingConfig = signingConfigs.getByName("release")',
      '            manifestPlaceholders["usesCleartextTraffic"] = "true"',
    ].join("\n"),
  )

  writeFileSync(gradle, patched)
  console.log(`[signing] patched ${gradle}`)
}

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`[signing] missing ${name}`)
    process.exit(1)
  }
  return value
}

// Replace a unique literal anchor, failing loudly if the generated project no longer matches.
function replaceOnce(text, find, replace) {
  const occurrences = text.split(find).length - 1
  if (occurrences !== 1) {
    console.error(`[signing] expected exactly one ${JSON.stringify(find)}, found ${occurrences}`)
    process.exit(1)
  }
  const index = text.indexOf(find)
  return text.slice(0, index) + replace + text.slice(index + find.length)
}
