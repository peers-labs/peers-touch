# SRCH-D05：受信任功能直达 catalog

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SRCH-20261022",
  "taskId": "SRCH-D05",
  "workstreamId": "FUNCTIONS",
  "title": "Shell/Settings 功能 descriptor catalog：别名匹配、eligibility 过滤、打开原操作面",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "srch-j05-function-open",
  "closureId": "srch-d05-function-shortcuts",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src",
    "docs/architecture/domains/search/prototype/README.md"
  ],
  "readSet": [
    "docs/client/common/ui-identity",
    "packages/prototypes/desktop/shell/src/search/searchMock.ts",
    "docs/architecture/domains/search/product.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 1200,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "srch-d05-catalog-unit",
      "command": "pnpm --dir apps/desktop exec vitest run src/services/search-function-catalog.test.ts",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "srch-d05-function-open-journey",
      "command": "pnpm --dir apps/desktop exec playwright test -c e2e/playwright.config.ts e2e/tests/search-functions.spec.ts",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "功能 descriptor 是单一登记源：id、标题、i18n key、别名/用途关键词、eligibility 谓词、真实 navigation/action target、所属模块；Shell 与 Settings 不各自维护第二份清单",
    "首批只登记生产中真实存在的 target：隐私与安全（Settings security 分区）、身份与站台（federation/network 分区）、存储与空间（storage 分区）、新建 Agent（openAgentCreateFlow，Shell 完成 openProfile action 接线）；通知/免打扰分区尚不存在，不登记",
    "coordinator 的 FunctionCatalogPort 由该 catalog 适配；匹配名称/别名/用途，结果无信任区标记，明确区别于内容结果",
    "打开动作只导航到原模块页面或表单；任何创建/发送/删除必须在原操作面由用户再次确认，搜索不直接写业务",
    "平台不支持或当前账号不可用的入口经 eligibility 过滤后不显示，而不是禁用占位",
    "FUNCTIONAL_CHECK 证明：别名（如‘隐私/站台/存储’自然词）命中正确设置分区；点击进入对应 Settings 分区或 Agent 新建流程；取消 Agent 新建不残留数据；搜索本身无业务写入。confirmed 原型中的‘通知与免打扰’行在生产目录中不存在，落地以本清单为准并回写 prototype README 已知差异"
  ],
  "failureBehavior": [
    "不用显示名称字符串猜路由；target 必须是类型化导航目标",
    "不登记 Applet/第三方功能（本期 non-goal），也不把 web-search Applet 作为来源",
    "不把 token、密码、secret 或配置值纳入可搜文本",
    "catalog 缺真实 target 时宁可不登记，不制造成功空跳转"
  ],
  "updatedAt": "2026-10-22T15:30:00.000Z"
}
```

## 完整闭环

输入是 D04 已稳定的 overlay 与 D03 的 FunctionCatalogPort；输出是用户在同一搜索框中一步到达设置与 Agent 操作面的真实能力。功能结果与内容结果共用行结构但语义不同：它是本地导航，不带来源信任标记，也不执行副作用。
