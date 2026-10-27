# AUD-14：默认 Provider/Model 落 Station 与真实状态灯

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AUD-20261025",
  "taskId": "AUD-14",
  "workstreamId": "AUD-SUPPLY",
  "title": "默认 provider/model 显式星标持久化到 Station runtime config，模型状态灯由 check/discover 驱动",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "aud-j14-provider-defaults",
  "closureId": "aud-v10-provider-defaults",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/agent/provider.proto",
    "apps/station/app/subserver/agent/service/provider_runtime_config.go",
    "apps/station/app/subserver/agent/handler/provider_handler.go",
    "apps/desktop/src/components/settings/ProviderMenu.tsx",
    "apps/desktop/src/components/settings/ProviderDetail.tsx",
    "apps/desktop/src/store/provider.ts",
    "packages/locales"
  ],
  "readSet": [
    "apps/station/app/subserver/agent/service/runtime_model_catalog.go",
    "apps/desktop/src/components/settings/CliProviderDetail.tsx",
    "apps/station/app/subserver/agent/catalog/providers.default.yaml"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "aud-14-station-tests",
      "command": "cd apps/station && go test ./app/subserver/agent/... -run Provider",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "aud-14-desktop-check",
      "command": "cd apps/desktop && pnpm run check",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "aud-14-provider-functional",
      "command": "cd apps/desktop && pnpm run test -- provider",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "默认 provider 有显式语义并持久在 Station runtime config（补齐 default provider 字段缺口；default_model 字段既有）；Providers 列表星标与“设为默认”动作读写 Station，重启回读",
    "Topic 级模型选择继承全局默认，创建 Topic 后变更默认不静默改写已选 Topic（沿用 MCA-B16 约束，UI 明示后果）",
    "模型行状态灯由真实 provider check/model discover 结果驱动（可用/失败/未检查三态）；不显示无权威的可用率百分比；凭证缺失/失效状态来自 credential status",
    "CLI profile 的 startup args/env/timeout 保持为该运行时真实配置；Direct profile 不出现这些字段（PRV-B03 全局注入 reject 维持，系统提示词只在 Agent Profile）",
    "CliProviderDetail 中不落库的装饰字段被清理；direct/cli 两档适配器之外不新增 tab",
    "Journey：设默认 provider/model→新建 Topic 默认继承→check 改变状态灯→重启默认保留，make desktop FUNCTIONAL_PASS"
  ],
  "failureBehavior": [
    "check 不得在无密钥时返回成功；外部 provider 不可达时三态显式失败，不缓存为永久失败标签",
    "默认变更不影响历史 Turn 的 provider 归因（不可变）",
    "不引入 sidecar/任务模型字段；不复制 AgentBox 六 CLI tab",
    "Station API 若不支持 default provider 落库，先补 proto/handler 再做 UI，不做本地默认真相"
  ],
  "updatedAt": "2026-10-25T00:00:00.000Z"
}
```

## 完整闭环

推理供给面已真实可调用，缺的是“默认”的 Station 真相与状态灯权威。完成后默认选择跨重启/跨设备一致，模型健康只由真实检查决定，历史归因不被当前配置改写。
