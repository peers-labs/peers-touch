# SRCH-D04C：资源解析与消息 anchor 定位

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SRCH-20261022",
  "taskId": "SRCH-D04C",
  "workstreamId": "ANCHOR",
  "title": "搜索结果 ResourceRef → 会话/消息 anchor：等待历史加载后滚动高亮",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "srch-j04c-message-anchor",
  "closureId": "srch-d04c-resource-anchor",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src"
  ],
  "readSet": [
    "apps/desktop/src/components/chat/ChatMessageArea.tsx",
    "apps/desktop/src/hooks/useNavigation.ts",
    "packages/prototypes/desktop/shell/src/Shell.tsx"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "srch-d04c-desktop-check",
      "command": "pnpm --dir apps/desktop run check && pnpm --dir apps/desktop run test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "srch-d04c-anchor-journey",
      "command": "pnpm --dir apps/desktop exec playwright test -c e2e/playwright.config.ts e2e/tests/search-anchor.spec.ts",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "定义类型化搜索打开负载（conversationId/messageId/source=search 等），不按显示名称猜路由；会话/联系人结果打开会话，消息结果携带 messageId anchor",
    "复用 ChatMessageArea 现有 scrollToMessageUlid/highlight 原语：跨会话打开时等待目标会话历史加载（含未就绪/分页），再滚动到目标 ULID 并高亮；目标消息被隐藏/撤回/删除时给出可恢复反馈而非空白定位",
    "打开后关闭 overlay、还焦正确元素；从消息详情返回时保留 query/filter/scroll（S-10）",
    "会话内 SearchMessagesModal 的打开路径与全局 anchor 共用同一解析（复用其现有 setScrollToMessageUlid），不维护第二套定位逻辑；search-anchor.spec.ts 含一条会话内 modal 搜索→定位的回归断言，防止分词查询表达式改动破坏 S-03 局部搜索",
    "FUNCTIONAL_CHECK 证明：全局搜索→跨会话 E2EE 消息→打开即看到高亮目标；同会话结果不触发重载；目标不存在（撤权/撤回）时提示并保留搜索上下文；断网打开已恢复历史仍可定位",
    "anchor 机制是本地导航，不产生 Station 请求"
  ],
  "failureBehavior": [
    "不新建字符串路由表或全局 URL 猜测；ResourceRef 解析集中一处",
    "不在消息未加载时伪造高亮成功，也不把整个会话历史拉完再定位",
    "不修改消息读取权限；能否看到目标仍由会话/消息投影决定",
    "Agent/帖子/知识 anchor 不在本期（Station/内容侧后期），结果类型缺失时不注册假打开"
  ],
  "updatedAt": "2026-10-22T15:30:00.000Z"
}
```

## 完整闭环

生产代码当前不存在 ResourceResolver（全仓零命中），本任务新增这一层但范围严格限定在会话/消息：把 D04 的"打开会话"升级为"打开并定位到具体消息"。这是端侧「找回」任务成立的最后一块；Social/Agent/知识 anchor 等 Station 侧对象在后续计划接入同一解析负载，本任务不预留空实现。
