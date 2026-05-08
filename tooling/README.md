# Tooling

统一的工程入口目录，负责管理 station、desktop、mobile 三个领域的公共任务编排。

## 目标

- 统一命令语义：lint / test / build / gen / doctor
- 本地与 CI 保持同构
- 通过领域路由减少跨栈心智成本

## 使用

PowerShell:

```powershell
.\tooling\scripts\pt.ps1 list
.\tooling\scripts\pt.ps1 doctor
.\tooling\scripts\pt.ps1 test station
.\tooling\scripts\pt.ps1 build desktop
```

Bash:

```bash
./tooling/scripts/pt.sh list
./tooling/scripts/pt.sh doctor
./tooling/scripts/pt.sh test station
./tooling/scripts/pt.sh build desktop
```

## Skills

`tooling/skills/` is the source of truth for repository engineering skills.
Run `make init-dev` to link these skills into the active IDE, and `make
skill-help` to view the catalog.

- `dev-runtime-handoff`: guides make-based dev startup, deployment/restart
  decisions, and acceptance-test handoff after code changes.
