# 远程访问部署方案（手机在外网 → opencode server）

> 本文是 `packages/mobile` 的配套部署文档：手机在**外网**（4G/5G、异地）时，如何让这个壳 App
> 连上 opencode server。
>
> 个人自用文档，非官方。上游项目：[`github.com/anomalyco/opencode`](https://github.com/anomalyco/opencode)。

---

## 0. TL;DR

| 方案 | 改 App | 要域名 | 加密 | 一句话 |
| --- | --- | --- | --- | --- |
| **A. HTTP 直连** | 改 NSC 放行明文 | 否 | ❌ | 最快跑通；密码明文传输 |
| **B. 自签 HTTPS + Caddy** | 改 NSC 加信任锚 | 否 | ✅ | **推荐**；证书打进 App |
| **C. 真证书（Let's Encrypt）** | **不用改** | 是 | ✅ | 最干净；Caddy 自动签发续期 |
| **D. `opencode --remote`** | 不用改 | 否 | ✅ | 先花一分钟试；国内可达性未知 |

**结论**：想最快 → A；想安全且没域名 → B；有域名 → C；先试 D。

不推荐的路（理由见 §8）：Cloudflare 免费隧道、Tailscale、改 opencode server 源码加 TLS。

---

## 1. 前提（本文按此假设）

- opencode server 就跑在**云服务器**上（有公网 IP），不是家里 PC。
- 服务器在**国内**。
- **没有**可用域名。
- 手机在**外网**。

> 备案提示：备案是**针对域名**的。只用 `IP:端口` 不涉及备案；国内厂商通常只对 `80/443`
> 上的域名做备案拦截，非标端口一般可用。

---

## 2. 关键事实（已核对源码）

这些是方案成立的基础，列出来避免踩坑：

| 事实 | 出处 |
| --- | --- |
| 服务器**必须有密码**，为空直接启动失败；不设会随机生成并打印 | `packages/server/src/process.ts`、`packages/cli/src/server-process.ts` |
| App 用 **HTTP Basic**：`Authorization: Basic base64("opencode:" + 密码)`，**每个请求都带** | `packages/app/src/runtime/server/api.ts` |
| App 连接页有**两种方式**：`link`（配对链接）/ `password`（地址 + 密码） | `packages/app/src/servers/connect/` |
| 云服务器公网 IP 常是 NAT 映射，网卡上只有私网 IP → 配对链接必须用 `pair --url` 指定公网地址 | `packages/server/src/server-info.ts`（枚举 `networkInterfaces()`） |
| 后台服务默认端口是 `49374`（`0xc0de`，latest 通道） | `packages/cli/src/services/service-config.ts` |
| CORS 已允许 Tauri 源（`tauri://localhost`、`http://tauri.localhost`、`https://tauri.localhost`），且**与服务器地址无关** → 连任意主机都不需要额外 CORS | `packages/server/src/cors.ts` |
| 可用 `opencode service get password` 取回服务密码 | `packages/cli/src/services/service-config.ts` |
| `pair --url <http(s)://...>` 可指定外链地址 | `packages/cli/src/commands/commands.ts` |
| Android `targetSdk = 37`（≥28）→ 明文 HTTP **默认禁用** | Tauri 移动模板 `android/app/build.gradle.kts` |
| Tauri 模板：`defaultConfig` 占位符 `usesCleartextTraffic="false"`，**debug** 构建类型里改成 `"true"` | 同上 |
| **WebView 遵守 NSC**（明文策略 + 信任锚都会作用于 App 内 WebView） | Android `NetworkSecurityPolicy` 文档 / OWASP MASTG-KNOW-0015 |
| 一旦配置了 NSC，manifest 的 `usesCleartextTraffic` 属性**让位于 NSC** | Android 官方文档 |

### 为什么 debug APK 能用、release 不能

Tauri 移动模板（原文）：

```kotlin
android {
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        ...
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            ...
        }
        getByName("release") { ... }   // 保持 false
    }
}
```

manifest 里：`android:usesCleartextTraffic="${usesCleartextTraffic}"`。

所以 **debug 包能连 `http://IP:4096`，release 包不能** —— 这是默认策略，不是漏洞；App 作者可以 opt-in。

> 当前 CI 出的是 **debug** APK，所以**现在就能走 HTTP**。只有在改用签名 release 包
> （签名 / 体积 / 混淆）时才会撞上这个限制。

---

## 3. 方案 A：HTTP 直连（最快跑通）

### 3.1 服务器

```bash
# 让 opencode 监听所有网卡（默认只 127.0.0.1）
opencode service set hostname 0.0.0.0
opencode service set port 4096
opencode service set password '<一串强密码>'
opencode service start
opencode service status            # 确认监听地址
opencode service get password      # 需要时取回密码
```

前台方式（不用后台服务）也可以：

```bash
OPENCODE_PASSWORD='<强密码>' opencode serve --hostname 0.0.0.0 --port 4096
```

然后放行端口 —— **两处都要**：

1. 云厂商**安全组**：入方向放行 `4096/tcp`
2. 系统防火墙：`ufw allow 4096/tcp` 或 `firewall-cmd --add-port=4096/tcp --permanent && firewall-cmd --reload`

### 3.2 手机

App 连接页两种方式二选一：

- **密码方式**（推荐）：切到「密码」，填 `http://<公网IP>:4096` + 密码
- **配对链接**：
  ```bash
  opencode pair --url http://<公网IP>:4096
  ```
  > 必须用 `--url`：云服务器的公网 IP 通常是 NAT 映射，网卡上只有私网 IP，自动生成的链接里会是内网地址，手机打不开。

### 3.3 release 包放行明文（两选一）

**写法一：全局放行**（最省事）

```kotlin
// src-tauri/gen/android/app/build.gradle.kts
getByName("release") {
    manifestPlaceholders["usesCleartextTraffic"] = "true"
}
```

**写法二：只对这台服务器放行**（更推荐）

`src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml`：

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">203.0.113.5</domain>
    </domain-config>
</network-security-config>
```

再在 `<application>` 上加 `android:networkSecurityConfig="@xml/network_security_config"`。

### 3.4 风险（必读）

- 密码是 `base64` 传输 = **明文**，路径上任何人可读、可重放。
- opencode 在服务器上有**文件系统 / 终端 / PTY** 权限 → **密码泄露 ≈ 服务器沦陷**。
- 公网明文 HTTP 会被**端口扫描器**秒发现（登录页暴露）。
- 建议：强密码 + 换非默认端口（如 `40960`）+ 及时更新。

---

## 4. 方案 B：自签 HTTPS + Caddy（推荐，无需域名）

思路：opencode 继续只监听 `127.0.0.1`，由 Caddy 在 `8443` 上终结 TLS。好处是
**端口不对外暴露 opencode 本身**，且全链路加密。

> 自签证书 + App 信任锚是 Android **官方支持**的做法（NSC 的「信任自签证书」用途），
> 且 NSC 会作用于 WebView。

### 4.1 服务器：造一张长期 CA + 叶子证书

分离成「长期 CA（10 年）」和「短期叶子证书」，这样**轮换叶子证书不用重新打包 App**。

```bash
mkdir -p /etc/opencode-tls && cd /etc/opencode-tls

# 1) 长期自签 CA（10 年）—— 这张要打进 App
openssl genrsa -out oc-ca.key 4096
openssl req -x509 -new -nodes -key oc-ca.key -sha256 -days 3650 \
  -subj "/CN=OpenCode Personal CA" -out oc-ca.crt

# 2) 叶子证书（SAN 必须是你的公网 IP）
cat > oc-server.cnf <<'EOF'
[req]
distinguished_name = dn
req_extensions = v3_req
prompt = no
[dn]
CN = opencode
[v3_req]
subjectAltName = @alt
extendedKeyUsage = serverAuth
keyUsage = digitalSignature, keyEncipherment
[alt]
IP.1 = 203.0.113.5
EOF

openssl genrsa -out oc-server.key 2048
openssl req -new -key oc-server.key -config oc-server.cnf -out oc-server.csr
openssl x509 -req -in oc-server.csr -CA oc-ca.crt -CAkey oc-ca.key -CAcreateserial \
  -days 825 -sha256 -extfile oc-server.cnf -extensions v3_req -out oc-server.crt

chmod 600 oc-ca.key oc-server.key
```

### 4.2 服务器：Caddy 反代

`/etc/caddy/Caddyfile`：

```
:8443 {
    tls /etc/opencode-tls/oc-server.crt /etc/opencode-tls/oc-server.key
    reverse_proxy 127.0.0.1:4096 {
        flush_interval -1        # SSE：确保即时 flush（Caddy 默认即 -1，写明更保险）
    }
}
```

```bash
opencode service start           # 保持默认 hostname=127.0.0.1，只让本机 Caddy 访问
systemctl enable --now caddy     # 或用官方仓库/发行版包安装 Caddy
```

安全组只开 **`8443/tcp`**，**不要**开 `4096`（它只在本机被 Caddy 访问）。

| 备选 | SSE 关键配置 |
| --- | --- |
| nginx | `proxy_buffering off; proxy_cache off; proxy_read_timeout 3600s;` |

### 4.3 手机：App 加信任锚

把 `oc-ca.crt` 放进 App 的资源目录（文件名随意，引用时**不含扩展名**）：

```
src-tauri/gen/android/app/src/main/res/raw/opencode_ca.crt
```

`src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml`：

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config>
        <domain includeSubdomains="false">203.0.113.5</domain>
        <trust-anchors>
            <certificates src="@raw/opencode_ca" />
        </trust-anchors>
    </domain-config>
</network-security-config>
```

manifest 里给 `<application>` 加 `android:networkSecurityConfig="@xml/network_security_config"`。

App 连接页填 `https://<公网IP>:8443` + 密码（或用 `opencode pair --url https://<公网IP>:8443`）。

### 4.4 自动化：`gen/android` 是生成的，别手工改

`gen/android` 由 `tauri android init` 生成、**不提交**仓库。所以上面那些 Android
改动要用脚本在 `android:init` **之后**注入。

设计：把源文件提交在包里，脚本负责拷贝 + 打补丁。

```
packages/mobile/
  android/network_security_config.xml   # 源文件（提交）
  android/opencode_ca.crt               # 自签 CA（提交；个人仓库，可接受）
  scripts/patch-android.mjs             # android:init 之后运行
```

`scripts/patch-android.mjs`（草稿，需在 `android:init` 后实跑一次验证）：

```js
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url))) // packages/mobile
const gen = join(root, "src-tauri/gen/android/app/src/main")
const res = join(gen, "res")

mkdirSync(join(res, "xml"), { recursive: true })
mkdirSync(join(res, "raw"), { recursive: true })
copyFileSync(join(root, "android/network_security_config.xml"), join(res, "xml/network_security_config.xml"))
copyFileSync(join(root, "android/opencode_ca.crt"), join(res, "raw/opencode_ca.crt"))

const manifestPath = join(gen, "AndroidManifest.xml")
const manifest = readFileSync(manifestPath, "utf8")
if (!manifest.includes("networkSecurityConfig")) {
  writeFileSync(
    manifestPath,
    manifest.replace(
      /<application\b/,
      `<application\n        android:networkSecurityConfig="@xml/network_security_config"`,
    ),
  )
}
```

接法：`android:build` / `android:dev` 脚本里，`tauri android init` 之后、`tauri android build`
之前跑一次（CI 同理）。因为源文件已提交，重复运行是幂等的。

### 4.5 维护成本

- 叶子证书 825 天过期 → 用 `oc-ca.key` 重签一张即可，**App 不用动**。
- **公网 IP 变了** → 叶子证书的 SAN、以及 NSC 里的 `<domain>` 都要改 → NSC 变了就得**重新打包 App**。
  - 云服务器 IP 一般是固定的，问题不大。
  - 想彻底避免 → 用方案 C（域名）。

---

## 5. 方案 C：真证书（有域名时最干净）

有域名的话，App **完全不用改**，也不涉及信任锚。国内服务器要点是**避开 80/443 的备案端口**，
用 DNS-01 签发证书：

```bash
# acme.sh + DNS API（以 Cloudflare 为例），不占 80/443
curl https://get.acme.sh | sh
export CF_Token="<你的 DNS API Token>"
~/.acme.sh/acme.sh --issue --dns dns_cf -d oc.example.com
```

Caddyfile：

```
oc.example.com:8443 {
    tls /path/to/fullchain.cer /path/to/oc.example.com.key
    reverse_proxy 127.0.0.1:4096 {
        flush_interval -1
    }
}
```

App 填 `https://oc.example.com:8443` + 密码。安全组只开 `8443`。

> 若服务器在**境外**（或你愿意备案）：可以直接用 Caddy 内置 ACME + `:443`，配置更少。

---

## 6. 方案 D：先试 opencode 自带的 `--remote`

opencode 本身就有远程访问能力（OpenTunnel），若能用，直接拿到**真 TLS**、零配置：

```bash
opencode service set hostname 0.0.0.0
opencode service set remote true      # 会用 OpenTunnel 建隧道，首次约一分钟
opencode service start
opencode pair --remote --yes          # 输出 https://xxxx.<隧道域名>/auth/connect/<code> + 二维码
```

- ✅ 真证书 → release 包不用改任何东西；不用开端口、不用域名、不用备案
- ✅ 服务器主动出站连隧道 → 天然穿透 NAT
- ⚠️ OpenTunnel 节点在**境外**，国内可达性/速度不确定，也可能被墙

**建议**：先花一分钟试它。通了就不用往下折腾；不通再走 B。

---

## 7. 关于「改 server 源码加 HTTPS」

结论记录（避免以后重复评估）：**技术可行但不划算**，所以本项目不这么做。

- 改动面约 6 个文件：`packages/server/src/{process.ts,options.ts}`、
  `packages/cli/src/{server-process.ts,commands/commands.ts,commands/handlers/serve.ts,services/service-config.ts}`，
  外加 URL scheme 与测试。自签版约半天到一天。
- **省不掉改 App**：自签证书下手机仍要加 NSC 信任锚。
- **真证书 = 重写 Caddy**：ACME（HTTP-01/TLS-ALPN/DNS-01 + 续期 + 存储）是几百行 + 新依赖；
  国内还要走 DNS-01。
- **会连带破坏 CLI/TUI 自连**：`packages/client/src/effect/service.ts` 靠注册的 `url` 连接服务并
  校验证书 —— 自签会被拒；真证书又因 `https://127.0.0.1` 不在 SAN 里而主机名校验失败。
  还得额外加「loopback 专用信任」逻辑（安全敏感改动）。
- 上游对「远程访问」给的答案本来就是**隧道**（`--remote`），不是进程内 TLS。

除非目标是给上游提 PR 或追求「单进程零依赖」，否则反代 3 行配置更优。

---

## 8. 已经排除的路（含理由）

| 方案 | 为什么不选 |
| --- | --- |
| **Cloudflare Quick Tunnel**（`trycloudflare.com`） | 国内域名常被污染/阻断；**且官方明确不支持 SSE**，而 opencode 实时流就是 SSE |
| **Cloudflare 命名隧道** | 功能可行（支持 SSE），但国内到 CF 边缘不稳；企业版中国网络要付费 + 备案 |
| **Tailscale** | 协调服务器 + DERP 都在境外；打洞失败回退海外中继 → 300ms+ 或不通 |
| **改 server 源码加 TLS** | 见 §7 |

---

## 9. 安全清单

- [ ] 设**强密码**（App 用 HTTP Basic，明文传输时密码等于公开）
- [ ] 换非默认端口，降低被扫概率
- [ ] 服务器安全组**只开必需端口**（B/C 方案下不要开 4096）
- [ ] opencode 尽量只绑 `127.0.0.1`（B/C 方案），由反代对外
- [ ] 及时更新 opencode 与系统
- [ ] 记住：**opencode 在这台机器上有文件系统 / 终端 / PTY 权限**，被攻破 ≈ 服务器沦陷

---

## 10. 待办（准备实施时）

- [ ] 选定方案（建议：先试 D，不行走 B）
- [ ] 提交 `packages/mobile/android/{network_security_config.xml,opencode_ca.crt}`
- [ ] 新增 `packages/mobile/scripts/patch-android.mjs`，接进 `android:build` / `android:dev` 与 CI
- [ ] （可选）CI 从 debug APK 切到签名 release APK：keystore 放 GitHub Secrets
- [ ] （可选）把 Caddy + 证书生成的命令写成 `deploy/` 下的脚本

---

## 附：服务器侧速查

```bash
# 取回服务密码
opencode service get password

# 生成配对链接（公网地址必须显式指定）
opencode pair --url https://<公网IP>:8443    # 方案 B
opencode pair --url http://<公网IP>:4096     # 方案 A

# 安全组 / 防火墙
# A: 放行 4096     B/C: 只放行 8443
```
