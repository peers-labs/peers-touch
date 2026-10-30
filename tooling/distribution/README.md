# Station 安装与 Desktop 分发

当前是尚未公开演练的源码实现。没有已验证的公开版本、签名公钥或跨平台更新报告，普通用户现在无法安装。

需要 Linux Docker daemon、Docker Compose v2、Python 3、curl 和可用的系统随机源。支持 amd64、arm64；每个安装使用独立项目、数据库卷和身份/附件卷。PostgreSQL 不对主机开放端口。

首个稳定版通过验收并出现在
[GitHub Releases](https://github.com/peers-labs/peers-touch/releases/latest)
后，普通用户使用：

```sh
curl -fL https://github.com/peers-labs/peers-touch/releases/latest/download/install.sh \
  -o peers-install.sh
sh peers-install.sh install
```

这条路径不需要 Agent、Go、Rust、pnpm 或仓库源码。若 Release 尚不存在，命令返回 404，不应改用 `master` 分支脚本绕过发布门禁。

需要锁定特定版本或安装 prerelease 时，使用固定 tag：

```sh
curl -fsSL https://raw.githubusercontent.com/peers-labs/peers-touch/<tag>/tooling/distribution/install.sh \
  | sh -s -- install --version <tag>
```

默认安装目录为 `~/.peers-touch/station`，HTTP 仅监听本机 `127.0.0.1:18080`。用 `--port`、`--libp2p-port` 修改端口，用 `--root` 和 `--project` 指定独立实例。服务端部署使用 Docker context 的本地 Unix socket；远程部署仍走项目 Profile。

脚本从同一完整 tag 下载并校验 `install.sh`、Python owner、compose 和 `station-release.json`；镜像固定 OCI digest。无 `--version` 时仅从完整稳定 Release 发现版本。应用 JWT、数据库口令、Dashboard bootstrap 密码与 Dashboard JWT secret 分别生成，只写 0600 `.env`，重复安装和版本切换不轮换。

联邦部署显式使用 `--federation --base-url <public-origin> --public-addrs <multiaddr> --bootstrap-nodes <seeds>`。必须配置真实外网访问、端口映射和 HTTPS 边界；缺参数会拒绝启动。

安装后的维护命令继续使用固定 tag 的引导脚本：

```sh
sh install.sh backup --version <installed-tag>
sh install.sh upgrade --version <new-tag>
sh install.sh rollback --version <new-tag> --to <old-tag> \
  --restore-backup <backup-directory> --confirm-loss
sh install.sh uninstall --version <installed-tag>
sh install.sh uninstall --version <installed-tag> --purge --confirm-purge <project>
```

升级前停止 Station 写入，备份 PostgreSQL、身份/附件、配置、旧镜像和 schema 身份。失败保留现场；不会自动降级。原位回滚需要 `--compatibility <proof.json>`，其中版本对、schema、镜像及真实旧程序读写报告必须匹配。无兼容证据时用完整备份恢复；恢复在新卷验证后切换，`--confirm-loss` 表示接受备份之后写入不在恢复范围内。

卸载保留数据与备份。`--purge` 只删除登记且标签匹配的当前卷；历史恢复现场和备份保留，删除须独立处理。排障先检查 `state.json` 阶段、容器健康及实际镜像，勿输出 `.env`。

Desktop 一期输出 universal macOS dmg、Windows x64 NSIS、Linux x64 AppImage/deb。OS 安装包没有代码签名：Gatekeeper、SmartScreen 和企业策略可能阻止安装，不能承诺统一的放行操作。Linux AppImage 需可执行权限；锁定 updater `2.0.0` 的 deb 内更新行为尚未实测，deb 用户使用手动安装升级。

更新包必须由 Tauri minisign 签名，公钥烘焙进客户端。当前公钥为空，发布前检查会拒绝：发布操作者需提供真实公钥并显式批准对应配置，私钥仅保存于 GitHub Secret。丢失私钥时不可无声明替换信任根，需另行设计轮换或重新安装。

稳定清单入口为 GitHub `/releases/latest/download/latest.json`，包地址固定 tag。候选或公开但验收未通过的版本不会晋级 latest。

维护者参见 [架构设计](../../docs/architecture/engineering/release-distribution/design.md) 与 [执行计划](../../docs/architecture/engineering/release-distribution/execution-plans/20261021-release-distribution-review/plan.md)。Station Suite 已实现真实 A/B 资产、产品数据、兼容回滚和新卷恢复；尚无 Docker/Release 运行报告。Desktop native updater 的跨平台 install/apply/restart 仍未实现，candidate/public workflow 会以 `RD_NATIVE_UPDATER_RUNTIME_UNPROVEN` 明确失败，因此当前不可发版。

## 试用闭环（非正式发布）

规范操作流程见技能 `pt-desktop-trial-packaging`。`publish-trial.sh` 把一次本地 `make package PRODUCT=desktop ... TARGET=dmg` 的产物发布到目标部署机的 profile 专属目录，并以最小只读 HTTP 服务（systemd 单元 `pt-distribution-<profile>.service`，独立端口）对外提供下载。它不触碰 Station 容器与数据卷，不产出 updater 资产，也不晋级任何 Release。

```sh
make package PRODUCT=desktop FLAVOR=geek CHANNEL=corpstable TARGET=dmg
sh tooling/distribution/publish-trial.sh \
  --profile=corpstable --host=shuxian@10.37.195.98 --port=18380 \
  --dmg=Peers-0.1.0-mac-aarch64.dmg --version=0.1.0 --commit=<sha>
```

远端布局为 `~/.peers-touch/distribution/<profile>/releases/<id>/` 加原子切换的 `current` 软链；安装脚本由 `desktop-install.template.sh` 渲染（SHA-256 校验、拷入 /Applications、清除下载隔离属性）。

试用路径的已知边界：安装包无代码签名；tauri-cli 2.0.1 不会把 `--config` 覆盖的顶层 `identifier` 落到 Info.plist（OS 身份仍取已提交 tauri.conf.json 的值），发布前必须核对构建身份；当 channel 快照不含 `network.default_station` 指令时，使用者需要在首次运行的 StationPicker 手动填入 Station 地址。
