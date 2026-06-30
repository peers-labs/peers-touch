# Agent 模块 E2E 验证提示词

## 项目背景

Peers-Touch 当前正在做 Agent 入口、Agent Profile、Agent Canvas 编排与 Workspace OSS / 配置拆解重构。验收目标不是“路由能打开”，而是用户真实可用：页面必须按原型功能与布局行为对齐，空间不足时滚动或覆盖展开，不能挤压到不可操作。

## 项目与文档

| 类型 | 路径 |
|------|------|
| 项目根目录 | /Users/bytedance/Documents/Projects/peers-touch/peers-touch |
| 原型落地计划 | docs/architecture/agent/execution-plans/20260623-agent-prototype-landing.md |
| Agent 入口架构 | docs/architecture/agent/agent-entry-architecture-rebuild.md |
| Agent 编排架构 | docs/architecture/agent/agent-orchestration-architecture.md |
| Agent Workspace OSS 架构 | docs/architecture/agent/agent-workspace-oss-architecture.md |

## 原型基准

| 页面 | 原型路径 | 生产路径 |
|------|----------|----------|
| Agent Chat | packages/prototypes/desktop/shell/src/AgentChatPage.tsx | apps/desktop/src/pages/AgentChatPage.tsx |
| Agent Profile | packages/prototypes/desktop/shell/src/AgentProfilePage.tsx | apps/desktop/src/pages/AgentProfilePage.tsx |
| Agent Canvas | packages/prototypes/agent-canvas/src/AgentCanvasPage.tsx | apps/desktop/src/pages/AgentCanvasPage.tsx |

## 启动方式

```bash
cd /Users/bytedance/Documents/Projects/peers-touch/peers-touch
make desktop-web
```

必要时再用标准流程验证 Station / Tauri：

```bash
make station
make desktop
```

- Profile 配置在 `.local/dev/profiles/one.env`
- Web 端口通常是 `http://localhost:3211`
- 不要绕开 Makefile 自己拼环境变量，除非 Makefile/profile 明确失效

## 必须通过的静态检查

```bash
cd /Users/bytedance/Documents/Projects/peers-touch/peers-touch/apps/desktop
pnpm run check
```

如果验证后端变更：

```bash
cd /Users/bytedance/Documents/Projects/peers-touch/peers-touch/apps/station
go test ./app/subserver/agent/...
```

## UI 用户验收矩阵

| 场景 | 视口 | 必验项 |
|------|------|--------|
| 正常桌面 | 1440x900 | Agent Chat、Profile、Canvas 与原型的布局结构一致 |
| DevTools 宽度 | 947x898 左右 | Profile 不能挤压成不可读；底部内容必须能滚到 |
| 窄桌面 | 1180x800 以下 | Builder 默认折叠为可点击 rail；展开后完整显示且可输入 |
| 低高度 | 1280x650 | Profile 中间内容、Builder 消息区、Builder composer 都能滚动/可见 |

## Agent Chat 验收

1. 打开 `http://localhost:3211/#/agent`
2. 左侧必须是 My Agents roster，不是旧的 Topic/Agent picker 混合侧栏
3. Agent roster 支持展开/折叠；折叠后仍能选择 Agent
4. 中间 Topic list 独立存在，不挤占主 Chat
5. Chat header 展示 Agent、runtime/model/effort/tools/search 等原型信息
6. Agent Chat 输入框必须是原型简洁 composer，不出现旧工具栏（search/memory/upload/voice/tools/more 等旧入口）

## Agent Profile 验收

1. 打开 `http://localhost:3211/#/agent-profile`
2. 左侧必须是 My Agents roster，支持搜索、选择、展开/折叠
3. 中间编辑区必须有最小可用宽度；空间不足时页面/区域滚动，不能把表单和卡片压成窄条
4. Configure 模式必须覆盖 SOUL / AGENTS、Capabilities、Workspace
5. Activity 模式必须覆盖 Tasks、Memories、Agent Events
6. 垂直滚动必须能到达页面底部所有内容，不能出现“下面内容看不见也滚不到”
7. Provider → Model · Effort 行必须可操作，不被截断
8. inline title/description 编辑与 AI rewrite 按钮必须可见可操作

## Agent Builder 验收

1. Profile 右侧 Builder 在宽屏下完整显示标题、上下文摘要、suggestions、输入框、发送按钮
2. 在 DevTools / 窄视口下 Builder 默认折叠成 48px rail，rail 必须可点击展开
3. 展开后 Builder 必须覆盖在右侧完整显示，不允许只露出一条窄边或宽度为 0
4. Builder 消息区内容较多时内部滚动，composer 固定可见
5. 输入建议问题后能填入 composer；输入文本后发送按钮状态正确

## Agent Canvas 验收

1. 打开 `http://localhost:3211/#/agent-orchestration`
2. Agent library、engine matching、prompt、run state、inspector 与原型结构一致
3. Run 后能创建 Station collaboration task 或明确展示后端错误
4. SSE/事件投影可用时节点状态能更新；不可用时 get fallback 不应卡死 UI
5. Stop 取消 task，Reset 清空本地画布；两者语义不能混淆
6. Result panel 展示 Final Result、Agent Contributions、GoalKeeper Coverage、Risks & Next Step

## 质量红线

- 不能只用“页面能打开、元素存在”作为通过标准
- 任何内容区 `scrollHeight > clientHeight` 时，必须有可用滚动路径
- 任何主操作按钮、输入框、折叠/展开控件都不能被裁剪到不可点击
- 窄视口下优先滚动、折叠或覆盖展开，不允许继续压缩核心表单
- 验收报告必须包含截图或 DOM 度量：viewport、关键容器 client/scroll size、Builder bounding box
- 如果主 worktree 变更未提交，`make station` 部署的远端 Station 可能不是当前改动，必须在报告里说明

## 建议 DOM 检查

在浏览器控制台或自动化脚本中检查：

```js
[...document.querySelectorAll('aside, main, textarea, button')].map((el) => {
  const r = el.getBoundingClientRect();
  return {
    tag: el.tagName,
    text: (el.textContent || '').slice(0, 40),
    x: r.x,
    y: r.y,
    w: r.width,
    h: r.height,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    overflow: getComputedStyle(el).overflow,
  };
});
```

验收失败时直接标 FAIL，并指出具体页面、视口、容器和不可用控件。
