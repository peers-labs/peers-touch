# MCP Development Service - Trae Agent集成指南

## 🚀 快速开始

### 1. 启动MCP服务（两种方式）
```bash
cd station/mcp-dev
go build -o mcp-dev.exe
./mcp-dev.exe
```
服务将在端口**18888**启动（HTTP 测试用）。

或构建并使用STDIO适配器（推荐给Trae）：
```bash
cd station/mcp-dev
go build -o mcp-stdio.exe ./cmd/mcp-stdio
```

### 2. 配置Trae Agent
在Trae配置文件中添加（STDIO 进程模式，推荐）：
```json
{
  "mcpServers": {
    "peers-dev-mcp": {
      "command": "E:/Projects/peers-touch/peers-touch/station/mcp-dev/mcp-stdio.exe",
      "args": [],
      "env": {},
      "capabilities": {
        "tools": {"listChanged": true},
        "prompts": {"listChanged": true}
      }
    }
  }
}
```

如果你的Trae支持“HTTP/SSE”类型的MCP服务器，也可以直接填入URL：`http://localhost:18888`。

### 3. 重启Trae Agent
配置完成后重启Trae以应用更改。

## 🛠️ 可用工具

| 工具名称 | 功能描述 | 必需参数 |
|---------|---------|---------|
| `generate_code` | 基于模板生成代码 | `project_id`, `template_name` |
| `check_compliance` | 检查代码合规性 | `code`, `project_id` |
| `get_project_context` | 获取项目上下文 | `project_id` |
| `list_templates` | 列出可用模板 | 无 |
| `fix_code` | 修复合规问题 | `code`, `project_id` |

## 💡 使用示例

### 生成代码
```
使用peers-dev-mcp生成Go HTTP服务，项目ID为peers-touch，包名"user_service"，服务名"UserService"
```

### 检查合规性
```
使用peers-dev-mcp检查以下代码是否符合项目标准：
[你的代码]
```

### 获取项目信息
```
使用peers-dev-mcp获取peers-touch项目的上下文信息
```

## 📋 可用提示

- **code_generation**: 生成带合规检查的代码
- **compliance_check**: 代码合规检查  
- **project_analysis**: 项目结构分析

## 🔍 故障排除

### 端口冲突
- 服务已自动切换到端口18888
- 确保配置中使用正确端口

### 连接失败
- 检查服务是否运行：`Invoke-WebRequest http://localhost:18888/health`
- 验证端口是否被占用
- 查看服务日志获取详细信息

### 工具调用失败
- 检查项目ID是否正确（使用`peers-touch`）
- 验证参数格式
- 确保模板存在

### 一直显示 Preparing...
- 使用STDIO模式：请将Trae的命令改为`mcp-stdio.exe`（不是`mcp-dev.exe`）。
- 使用HTTP模式：确认Trae支持HTTP类型并配置URL为`http://localhost:18888`。
- 若仍旧卡住，查看Trae日志与系统进程，确保未卡在权限或路径错误。

## 📁 项目文件

- `trae_agent_config.json` - 配置文件模板
- `test_trae_integration.ps1` - 集成测试脚本
- `examples/project_context.json` - 项目上下文配置
- `examples/code_templates.json` - 代码模板配置
- `examples/compliance_rules.json` - 合规规则配置

## ✅ 状态验证

运行测试脚本验证集成：
```powershell
.\test_trae_integration.ps1
```

**预期输出**：所有测试通过，显示服务运行正常。

---
**状态**: ✅ 集成完成 | **端口**: 18888 | **项目ID**: peers-touch