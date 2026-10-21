# Peers-Touch

Peers-Touch 是一个由用户自己掌控身份、关系、消息与内容的联邦社交产品。每个用户
运行或加入一台 Home Station；不同 Station 通过开放协议互联，Desktop 与 Mobile
作为原生客户端访问自己的数据和社交网络。

## 当前状态

Peers-Touch 仍在开发中，目前没有经过验证的公开稳定版、可直接下载的 Desktop
安装包或托管 Station。普通用户安装路径将在首个稳定 Release 发布后开放。

`AGENTS.md` 和 `tooling/skills/` 仅服务于源码开发，不是用户安装 Peers-Touch 的
前置条件。

## 从源码开发

macOS/Linux 的本地路径会启动一套私有 Compose Station 和原生 Desktop：

```bash
corepack enable
corepack prepare pnpm@9.12.0 --activate
make profile-init local
make profile local
make doctor
make desktop
```

环境要求：

- Node.js 22 与 pnpm 9.12.0；
- Rust、Cargo、`protoc` 和当前系统的 Tauri 前置依赖；
- Docker 与 Docker Compose v2；
- Station 源码开发额外需要 Go 1.24.10。

Windows 使用同一 `devctl` 实现的 PowerShell 入口：

```powershell
.\tooling\dev.ps1 profile init local --slot 0
.\tooling\dev.ps1 profile activate local
.\tooling\dev.ps1 doctor
.\tooling\dev.ps1 desktop start
```

完整开发提纲见 [Develop Peers-Touch](docs/development/README.md)，其中包含环境、
平台阅读顺序、统一研发流程、验证和 Agent 协作。当前命令使用 `make help` 查询。

## 架构入口

- [项目身份](docs/global/project-identity.md)
- [系统架构](docs/global/architecture.md)
- [领域模型](docs/global/domain-model.md)
- [架构总览](docs/architecture/README.md)
- [开发知识库](docs/development/README.md)
- [操作知识](docs/knowledge/README.md)
