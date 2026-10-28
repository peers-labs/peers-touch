# Getting Started

> **实验版本，主链路有效。** 本指引随 `make dev-up` 开发者引导持续迭代；其主链路
> （装齐工具链 → 起 Station → 种子数据 → Desktop/Mobile 构建）已在干净 Debian 12 上
> 从零实测通过，平台状态见 §0。
>
> **建议由 Agent 引导执行。** 把本页交给编码 Agent 逐步执行、按每步“期望结果”自检；
> 失败先查 §8，仍不通则带着**原始报错**与你确认，不得猜测性修改配置。人工照做同样可行。
> 唯一需要图形界面的是最后登录发消息一步（§2.3）。
>
> 读完能做：把 Station + Desktop 跑起来，用测试账号登录并发出第一条消息，
> 并建立 Client ↔ Station 的初步架构认知。
>
> 给执行者的三条约定：
> 1. 逐步自检，失败先看 §8；破坏性操作（删 volume、remote 部署、`stable` 环境）须先获明确授权。
> 2. Linux 路径可用 `tooling/scripts/dev-onboarding/accept-onboarding.sh` 做可回撤的
>    机器验收（`all` / `reset` / `teardown`）；它只证明“可装、可起、种子正确、两端可构建”，
>    不跑测试套件、不启 GUI，默认面向公司内网主机（外部复现的 `ACCEPT_*` 变量见 §8）。
> 3. 版本与镜像由引导自动选择，不要手动指定。

---

## 0. 先看：平台支持状态

- **Linux（Debian/Ubuntu）——已验证**：`make dev-up` 全自动装齐工具链并起 Station，
  Desktop 可构建/安装（AppImage/XDG），Docker 用 Engine、无需 Docker Desktop。
  已在干净 Debian 12（x86_64，受限内网）从零实测通过：冷装、冷拉镜像、种子断言、
  Desktop/Mobile 构建检查全绿。
- **macOS——路径已实现，本周期未做整机实测**：须预装 Homebrew 并手动接受一次
  Docker Desktop EULA（见 §1.1）；Station/Desktop/Mobile（iOS 模拟器）全套可用，
  遇问题按附录 A 手动步骤排查。
- **Windows——不支持**：一键引导未实现（安装器直接报 not implemented）。
- **Mobile**：iOS 模拟器见 §3（需 macOS + Xcode）；Android 目前只有打包/验收路径。
- 不想在本机起 Station，可连团队远程开发 Station（§4，需内网权限），本机免 Docker/Go。

## 1. 最低开发环境（`make dev-up` 全自动准备）

**你不需要手动安装工具。** clone 之后 `make dev-up`（见 §2）检查环境、缺什么装什么：
Go 取 `go.mod` 要求的精确版本，Node 取当前 LTS，pnpm 由 corepack 按仓库锁定的
9.12.0 提供，其余取当前稳定版。Linux 走 apt 全自动；macOS 走 Homebrew（须预装）；
Windows 不支持。

> 自举：`make dev-up` 本身是 Node 程序。零依赖机器上 make 会先运行
> `tooling/scripts/local-dev/preflight-node.sh`，仅用 bash/curl/tar 就把 Node LTS
> 装进 `/opt/peers-dev/node`，随后再进入完整引导。不需要先有 Node。

脚本会自动准备这些东西（你无需照着装）：

- Go（按 `go.mod` 版本）、Node.js LTS（含 corepack/pnpm）、Rust（rustup）、
  protoc **+ well-known types**、Python 3、make、git
- Docker 与 Compose v2（Linux 装 Docker Engine；macOS 装 Docker Desktop）
- Linux 上构建 Tauri 客户端所需的系统库（webkit2gtk 4.1 等，见附录 A.2）

安装方式与网络：

- **Linux（Debian/Ubuntu）**：发行版原生 apt + 官方 docker-ce 源，必要时调用 `sudo`
  （要求免密 sudo 或本人可输密码，不缓存密码）。Fedora/RHEL 的 dnf 自动适配未实现，
  按附录 A 手动翻译。
- 国内/受限网络自动用可达镜像：docker-ce 清华源、Go 阿里云、Node npmmirror、
  Rust rsproxy、Go 模块 goproxy.cn；装好即写入对应工具配置。
- 装完做最低版本校验；磁盘/内存不足会在动手前直接报错。

资源前提（脚本只检查、无法替你扩容）：**约 4 GB 可用内存、20 GB 可用磁盘**。
首次要拉基础镜像并编译，网络慢时会久一点。

脚本**替代不了**的四件事：

1. **clone 之前的 git 与凭据**——先有 git 才能 clone，授权走你本机已有的 SSH/HTTPS；
   Linux 首次 `sudo` 安装会提示输本机密码。
2. **macOS 预装 Homebrew**（brew.sh 官方一行命令）；Linux 无此步骤。
3. **macOS 首次手动启动 Docker Desktop 接受 EULA**（见 §1.1）；Linux 无此步骤。
4. **硬件资源**——上面的内存/磁盘是物理前提。

只想体检、不安装：`make dev-up CHECK_ONLY=1`（一次性列出缺什么、哪些过旧）。

### 1.1 Docker：按平台自动准备与人工点

脚本统一使用 **`docker compose`（Compose v2 子命令），不支持 `docker-compose` v1**。

**Linux（Docker Engine，无 EULA，全自动）**

- 缺 Docker 时用发行版官方源安装 `docker-ce` + `docker-compose-plugin`，
  并把当前用户加入 `docker` 组（必要时提示重新登录）。
- daemon 经 `systemctl enable --now docker` 启动；后续 doctor/镜像步骤要求 `docker info` 可用。
  全程无需 GUI、无人工授权。

**macOS（Docker Desktop）**

- 未安装时在已装 Homebrew 的前提下 `brew install --cask docker`；脚本不代装 Homebrew、
  不启动 Docker Desktop。
- 安装后本人手动打开一次 Docker Desktop，接受 EULA、等鲸鱼图标变绿，再重跑
  `make dev-up`（前面步骤幂等跳过）。

本路径只启用 compose 的 `infra`（PostgreSQL 16 + pgvector）与 `station`：
Postgres 不映射宿主端口，仅 compose 网络内可达；不起 Relay、LiveKit（联邦/语音联调不在本页范围）。
走 §4 远程 Station 路径时本机不需要 Docker/Go，Desktop 直连远程即可。

---

## 2. 快速开始（推荐，一键）

clone 之后只有一条命令：先做环境检查，**缺什么装什么**，再把整套环境跑起来。
脚本幂等——已装、已完成的步骤自动跳过，可以反复执行。

### 2.1 一条命令

```bash
git clone git@github.com:peers-labs/peers-touch.git peers-touch
cd peers-touch
make dev-up
```

`make dev-up` 是“先检查、再补齐、最后启动”的引导：

1. **自举与检查**：没有 Node 时先由 `preflight-node.sh`（纯 bash/curl）装 Node LTS；
   再逐项探测 Go、Node、pnpm、Rust、protoc、python3、Docker/Compose、磁盘/内存。
2. **缺啥装啥**：Linux 经 apt（docker-ce 源 + Go/Node/Rust/protoc/Tauri 系统库），
   macOS 经 Homebrew；版本与镜像自动选择。
3. **生成环境绑定**：创建并激活 worktree-local profile（默认 `local`、SLOT 0，
   `PROFILE`/`SLOT` 可覆盖），不依赖同级 `../env` 仓；`tooling/docker/.env` 不存在则
   自动生成（`PEERS_AUTH_SECRET` 随机写入，库口令用本地默认值）。
4. **起服务**：等待 Docker daemon → 预取/构建 Postgres + Station 镜像 → 起容器并健康检查。
   pnpm 依赖在客户端步骤安装，Station 本身在容器内构建。

成功标志：检查清单全绿、Station 健康检查通过
（`http://127.0.0.1:18080/api/oauth/providers` 返回 200）。
**dev-up 不启动 Desktop**——服务器就绪后用 §2.3 的 `make desktop`。

首次安装若把你加入了 docker 用户组，devctl 以 **退出码 3** 结束并提示重新登录
（经 `make dev-up` 跑时 make 自身退出码是 2，以终端提示和 `getent group docker`
的组状态为准）：开一个新终端会话（或重新 SSH）后原样重跑即可，步骤幂等。

### 2.2 常用开关

```bash
make dev-up CHECK_ONLY=1    # 只做环境检查、打印缺失清单，不安装也不启动
make dev-up NO_INSTALL=1    # 检查但不自动安装（我自己管工具链）
make skills IDE=trae        # 安装项目 Skills/可选 Hook（独立命令，dev-up 不代做）
make dev-up PROFILE=local-b SLOT=1   # 多 worktree / 多实例
# 受限网络（内网镜像仓库，例如 hub.byted.org）：
make dev-up IMAGE_REGISTRY=hub.byted.org INSECURE_REGISTRY=hub.byted.org
```

`IMAGE_REGISTRY` 让 Station 的三个镜像（postgres/builder/base）从该仓库取；引导会
自动处理多架构 OCI index 在部分代理上按 digest 取不回的问题（取当前架构的子 manifest
再 retag）。`INSECURE_REGISTRY` 把主机加入 docker daemon 的 insecure-registries。

> 引导只操作本机：安装开发工具、起本地容器，不部署远程环境，不碰 stable。
> GitHub HTTPS 不可达而 SSH 可达时，可从团队 central 裸仓 clone（见 §4）。
> 想手动逐步控制、或一键脚本报错时排查，见附录 A。

### 2.3 看到效果：登录、发消息

最后一步需要图形会话（本机显示器或 Agent 的桌面代操作能力）；无头 Linux 上 harness
只证明到“Station 健康 + 客户端可构建”，不替代这一步。

```bash
make desktop          # 首次会装 pnpm 依赖、生成 proto/applets、编译 Tauri，数分钟到十几分钟
```

应用内使用内置 dev 测试账号（**密码均为 `1`**；PIN 是登录后可选的本地快速登录码，
不是预置口令，首次登录直接跳过设置即可）：

| 账号 | 好友 |
|---|---|
| `alice@p.t` | bob、carol |
| `bob@p.t` | alice、carol、dave |
| `carol@p.t` | alice、bob、dave |
| `dave@p.t` | bob、carol（**与 alice 不是好友**） |

启动时还会初始化 dev 社交关系（10 条好友边）。两个群（Friends/Mixed）是计划中的
fixture：建群命令要求每个成员有已验证设备，无法在仅种子账号的启动阶段创建，当前版本
**不会**自动建群，需要时由登录后的真实设备流程创建。

操作与期望：

1. Desktop 启动后在登录表单输入 `alice@p.t` / `1`，Sign in；提示设置 PIN 时选择跳过。
2. Station 地址由当前 profile 注入，默认自动连上本地 Station（127.0.0.1:18080），无需手选。
3. 在联系人/会话列表打开 **Bob**，发一条单聊消息。期望：消息出现在会话里；
   换用 `bob@p.t` 登录（或查库）能看到同一条消息——这就验证了
   Desktop ↔ Station ↔ PostgreSQL 全链路。设备密钥在首次登录时由客户端自动注册
   （这也是种子阶段无法预置群消息的原因）。

Agent 自检（无需 GUI 的旁证）：Station 侧已有种子断言
（4 账号 / 10 好友边 / 无遗留旧表，见 harness `assert` 阶段）；
消息持久化可只读查 `touch_*` 会话表确认，不要直接写库造数据。

---

## 3. Mobile（iOS 模拟器，可选）

前置：macOS、已装 Xcode 和一个 iOS Simulator runtime，且第 2 节的 Station 已在跑。

```bash
make mobile          # 自动租 slot、确保 Station、起 Vite + tauri ios 模拟器
```

期望：启动 iOS 模拟器并装入 Mobile 应用；如未自动连上，在应用的 Station 选择器填入
`make config` 里的 `PT_STATION_URL`。停止：`make mobile-stop`。

> Android 目前没有等价的开发入口；需要时用
> `pnpm --dir apps/mobile run tauri:android:init` 和 `tauri:android:dev`
> （自备 JDK 17、Android SDK/NDK），日常打包用
> `make package PRODUCT=mobile TARGET=android-apk`。

---

## 4. 连接团队远程开发 Station（可选）

本机 compose（第 2 节）已足够日常开发，**绝大多数新研发不需要这一节**。
只有要做跨站/联邦联调、或想直接连一台已在运行的共享 Station 时才需要它。

远程环境（`one`、`two`、`three` 等）不是每个人自带的，它们定义在一个**独立、加密的
内部仓库** `peers-labs/env` 里。你在本机不会天然有这些 profile。

**怎么拿到这些环境：**

- 申请并克隆环境仓、配置 git-crypt/GPG 解锁：按
  [`env` 仓 README](https://github.com/peers-labs/env) 的 “Encryption Model /
  Restore On A New Machine” 操作（仓库地址、GPG 指纹、授权方式都在那里，本文不重复）。
- 只想连一个属于你自己的远程机：按同一 README 的 Profile 约定**新建一个 profile**，
  不要复用或改动别人的 `three` 等环境。

拿到后，连接方式很简单（详见 env 仓 README，本文不展开）：

```bash
make profiles        # 看你实际拥有哪些 profile
make profile <你的profile>
make config          # 确认 PT_STATION_MODE=remote、PT_STATION_URL 指向该主机
make desktop         # Desktop 直连远程 Station，本机免 Docker/Go
```

**关键语义**：remote profile 下执行 `make station` 会把当前分支的**已提交 HEAD 部署到
远程机器**（未提交改动不会被部署）；只想连接已有环境时不要执行它。名字含 `stable` 的
环境受保护，任何情况下都不要部署或重置。

---

## 5. 日常使用（跑通之后）

```bash
make config          # 看当前连的是哪个 Station、用哪些端口
make station         # 起/就绪 Station（已健康则直接复用）
make desktop         # 起 Desktop（会自动确保 Station 可达）
make status          # 看运行态
make stop            # 停受管服务
make station-logs    # 看 Station 日志
```

数据保留在 Docker volume，重启不丢；只在需要清空时才动 volume（破坏性，先 `make docker-ps` 确认 project）。

---

## 6. 看到效果之后：系统全景速览

跑通的过程已经把整套系统在你机器上拼了一遍，回头看十分钟就能建立整体认知。

### 6.1 运行拓扑：Client ↔ Station

```
┌─────────────────────────────┐         ┌──────────────────────────────────┐
│ Desktop / Mobile（客户端）  │         │ Station（服务端，Go + DDD）       │
│ Tauri 原生壳 + Rust 运行时  │  HTTP/  │ Hertz；按子域拆成多个 subserver   │
│ 内嵌 React/TS Web UI        │◀──────▶ │（actor/auth/social/conversation…）│
└─────────────────────────────┘  WSS    └───────────────┬──────────────────┘
                                                         │
                                                PostgreSQL 16 + pgvector
```

- 运行时只有两跳：**Client ↔ Station**。`model/domain/*.proto` 是两端共享的契约
  定义（Proto-First，禁止手写并行模型），它不是运行时服务，也不是请求链路上的一跳。
- Station 是单体 Go 应用内按 DDD 划分的子域（aggregate/domain service/event），
  不是微服务集群；Postgres 是唯一持久化。
- 联邦场景中间还会有 Relay（跨站路由），本页本地开发不启动。

### 6.2 你刚启动的东西落在哪些进程/容器

`make dev-up` 后只有一个 compose project `pt_local`（compose 文件
`tooling/docker/compose.yml`）：

| 组件 | 形态 | 说明 |
|---|---|---|
| `pt_local-postgres-1` | 容器，仅 compose 网络内可达 | 不映射宿主端口；库名 `peers_touch_local` |
| `pt_local-station-1` | 容器内构建并运行 | 健康端点 `http://127.0.0.1:18080/api/oauth/providers` |
| Desktop | **宿主原生进程**（不是容器） | `make desktop` 启动，profile 把 Station 地址注入 Vite/Tauri |

4 个 dev 账号、好友边、federation 记录是 Station 启动钩子
（`frame/touch/setup.go` → `SeedPresetActors`/`SeedDevFriendships`）写进 Postgres 的；
设备密钥则相反——只在客户端首次登录时注册，所以种子态“有账号、无设备”。

### 6.3 代码地图（第一次改代码时从这里进）

| 路径 | 是什么 |
|---|---|
| `apps/station/` | Station：`app/` 业务子域（DDD subservers），`frame/` 核心框架 |
| `apps/desktop/` | Tauri + React/TS + Rust 客户端 |
| `apps/mobile/` | Tauri v2 Mobile：Web UI + 共享 Rust + 原生插件 |
| `model/domain/` | 唯一契约源（`.proto`），生成产物禁止手改 |
| `packages/` | applet-sdk、官方 applets、locales（UI 文案必须走 i18n） |
| `tooling/` | 开发控制面：`make` 封装 → `tooling/devctl/*.mjs` → `tooling/scripts/` |

### 6.4 工程控制面：开发工具链为什么不在产品请求路径上

系统里有两个严格分离的面（架构总纲 §8）：

- **产品数据面**：Client ↔ Station ↔ PostgreSQL 的真实业务请求，也就是 §6.1 那张图。
- **工程控制面**：约束源码、运行环境和交付证据，但不服务任何用户请求——
  `tooling/`（make → devctl → scripts）、profile/slot/registry、研发 workflow、
  Acceptance Gate、Review/CI。禁止把 workflow/CI 画进或接进产品 data plane。

三个控制面概念：

- **profile**：一次环境绑定（mode `local`/`compose`/`remote` + slot + 端口 + capability）。
  `make dev-up` 自动创建 worktree-local 的 `local` profile，自包含、不依赖外部 env 仓；
  remote 部署 profile 才定义在独立加密的 env 仓。
- **slot**：同一台机器上多 worktree/多实例的隔离编号，端口按 slot 偏移。
- **machine-dev registry**（`~/.peers-touch/dev/`）：登记“哪个目录占用哪个 slot”，
  防止两个 worktree 抢同一套容器/端口；运行日志、pid 也在这下面。

---

## 7. 附录 A：手动步骤详解（一键脚本逐步拆解）

想自己控制每一步、或一键脚本报错时，按下面手动执行，效果与 `make dev-up` 完全一致。
预计首次 15–30 分钟（拉镜像 + 首次编译）。

### A.1 取代码

```bash
git clone git@github.com:peers-labs/peers-touch.git peers-touch
# local/compose 引导不再需要同级 env 仓；仅 remote 部署 profile 需要它
cd peers-touch
```

### A.2 装工具链（按平台，装最新稳定版即可，已装会跳过）

一般不需要手动做这一步，`make dev-up` 会自动完成。以下仅供想自己装的人参考，
版本都取当前稳定版，无需对齐特定号：

macOS（Homebrew）：

```bash
brew install go node protobuf python3 rustup-init
brew install --cask docker            # 装完首次需手动打开接受 EULA
rustup-init -y && source "$HOME/.cargo/env"
corepack enable
```

Linux（Ubuntu/Debian 示例；Fedora/RHEL 的 dnf 自动适配未实现，需自行把下列 apt 步骤翻译成 dnf）：

```bash
sudo apt-get update
sudo apt-get install -y git make python3 ca-certificates curl gnupg uidmap \
  protobuf-compiler libprotobuf-dev
# Docker Engine + compose 插件（清华 docker-ce 源，无 EULA）：
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://mirrors.tuna.tsinghua.edu.cn/docker-ce/linux/debian/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://mirrors.tuna.tsinghua.edu.cn/docker-ce/linux/debian $VERSION_CODENAME stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker "$USER"        # 重新登录后免 sudo 用 docker
sudo systemctl enable --now docker
# Tauri（Desktop/Mobile Rust 侧）Linux 构建系统库：
sudo apt-get install -y build-essential file libwebkit2gtk-4.1-dev libssl-dev \
  libxdo-dev libayatana-appindicator3-dev librsvg2-dev
curl --proto '=https' --tlsv1.2 -sSf https://rsproxy.cn/rustup/dist/$(uname -m)-unknown-linux-gnu/rustup-init -o /tmp/rustup-init
chmod +x /tmp/rustup-init && /tmp/rustup-init -y --default-toolchain stable --profile minimal
corepack enable
```

> Go 不要用发行版自带包（bookworm 的 1.19 远低于 go.mod 要求）：从
> `https://mirrors.aliyun.com/golang/go$(go.mod 版本).linux-<arch>.tar.gz` 安装；
> 引导脚本已自动完成这一步并 `go env -w GOPROXY=https://goproxy.cn,direct`。
> protoc 用 apt 的 3.21 足以跑通本页流程；proto 开发另需更新的 protoc 与固定的
> protoc-gen-go 才能与仓库提交的 `.pb.go` 头部一致，本文不展开。

最后两端都执行：

```bash
pnpm install
```

### A.3 创建并激活本机 profile

```bash
make profile-init local SLOT=0
make profile local SLOT=0
make config          # 期望 PT_STATION_MODE=compose、PT_STATION_URL=http://127.0.0.1:18080
make doctor          # 工具链自检；无 profile 时自动降级为纯工具链模式（不需要先激活 profile）
docker info >/dev/null && docker compose version
```

`profile-init` 与 `profile` 必须用同一 SLOT；多 worktree 用不同 SLOT（端口按 100 偏移），
实际端口以 `make config` 为准。compose profile 的 capability 仅 `station.connect`，
不会被授予部署/重置权限。

### A.4 生成 Compose 环境文件

```bash
cp tooling/docker/.env.example tooling/docker/.env
# 必填两项，一键脚本会自动生成；手动可执行：
#   sed -i '' "s|^PEERS_AUTH_SECRET=.*|PEERS_AUTH_SECRET=$(openssl rand -hex 32)|" tooling/docker/.env
#   sed -i '' "s|^PEERS_DB_PASSWORD=.*|PEERS_DB_PASSWORD=peers_local_dev|" tooling/docker/.env
```

Station 容器的密钥/库口令只从这个 gitignored 的 `.env` 读取；
端口、project 名、库名由激活的 profile 注入。`PT_STATION_URL` 是客户端连接地址，不进容器。

### A.5 启动 Station 与 Desktop

```bash
make station         # 构建镜像 + 起 postgres、station，健康检查通过后就绪
make station-check && make docker-ps
make desktop         # 自动确保 Station 可达；首次装依赖、生成 proto/applets、编译 Tauri
```

首次 Desktop 编译可能数分钟到十几分钟，日志在
`~/.peers-touch/dev/workspaces/<workspaceId>/runtime/<profile>/logs/`
（`desktop-app-tauri.log`、`desktop-app-vite.log`、`desktop-dependencies-install.log`）。
Desktop 会把当前 profile 的 Station 地址注入 Vite/Tauri，默认自动连上，无需界面手选。

### A.6 停止与重启

```bash
make stop                       # 停受管的 Station/Desktop
make station-stop               # 只停 Station
make station && make desktop    # 下次继续
```

---

## 8. 起步排障

| 现象 | 检查 / 处理 |
|---|---|
| `pnpm: command not found` | 引导会经 corepack 提供 pnpm 9.12.x；手动时先 `corepack enable` |
| `make dev-up` 退出码 3（经 make 实际看到 2） | docker 用户组刚加入，当前会话未生效；以终端提示和 `getent group docker` 为准，开新终端/重新 SSH 后原样重跑（幂等） |
| `make doctor` 报 `WORKSPACE_UNREGISTERED` | 已支持无 profile 的纯工具链模式；仍报此错说明运行的是旧版脚本 |
| `make doctor` 有 FAIL | 按输出 remediation 处理，或直接重跑 `make dev-up` 自动补齐；Go 版本以 go.mod 为准 |
| protoc 报 `File not found` / 类型 `is not defined` | Debian 的 `protobuf-compiler` 不含 well-known types，需另装 `libprotobuf-dev`（引导已包含） |
| corepack 报 `/usr/bin/env: 'node': No such file or directory` | sudo 的 secure_path 不含 node；引导已处理，手动时给 sudo 显式 PATH |
| docker 拉镜像报 OCI index / digest `not found` | 受限网络的 registry 代理问题；用 `IMAGE_REGISTRY=<host>`，引导自动按架构取子 manifest |
| apt 下载大文件长时间无进度 | 引导内置 apt 超时/重试；docker-ce 默认走清华源，`BOOTSTRAP_DOCKER_APT` 可换源 |
| profile 选择报 `cannot resolve environment repository` | local/compose profile 不需要同级 `../env`；仍报错说明脚本过旧或当前是 remote deploy 定义 |
| profile/doctor 报 `WORKSPACE_LIFECYCLE_LOCK_INVALID` | `python3` 可能是失效的 venv wrapper；把可用 Python 放到 PATH 前面 |
| `make station` 报 Compose 配置缺失 | 确认 `tooling/docker/.env` 存在（dev-up 自动生成，含 `PEERS_AUTH_SECRET`、`PEERS_DB_PASSWORD`） |
| Station 健康检查不过 | 先 `make station-logs`；确认 Docker daemon 在运行（`docker info`）、端口未被占用 |
| Desktop `cargo check` 报 `frontendDist ../dist does not exist` | 先跑 `pnpm --filter @peers-touch/app-desktop run build` 生成前端产物 |
| 端口被占用 | 用未占用的 `SLOT` 重新 `make profile-init <name> SLOT=n` 和 `make profile <name> SLOT=n` |
| 想验证整套引导是否仍可从零跑通 | `tooling/scripts/dev-onboarding/accept-onboarding.sh all`（干净 Debian 主机 + 免密 sudo；默认走内网主机和 `hub.byted.org`，外部环境用 `ACCEPT_HOST/ACCEPT_REMOTE/ACCEPT_REGISTRY` 覆盖，先 `authorize`；只验证可装可构建，不跑测试和 GUI，`teardown` 完全回撤） |
| 想清空本机数据重来 | compose 数据在 Docker volume；删除 volume 是破坏性操作，先用 `make docker-ps` 确认 project 名 |

更深入的排障与只读查库见 [local-dev-environment.md](global/local-dev-environment.md)；改代码的日常循环见后续 L2 开发指南。

---

## 9. 下一步

- 我要**改代码、跑测试、提交 PR** → 读后续 **L2 开发指南（DEV_GUIDE，规划中）** 与命令速查卡。
- 我想搞懂**架构 / 谁拥有什么 / 为什么** → 从 [docs 导航](README.md) 进入 L3 框架深入。
- 我要**部署、多站联邦、维护机器与缓存** → 读 [L4 运维参考](global/local-dev-environment.md) 与 env 仓。
- 只想把产品跑起来用？到此为止。
