# Release Distribution — 修订复审

评审范围为本目录 `plan.md`、`tasks/RD-T01..RD-T06.md` 和模块六份设计文档。只评审，不实现、不发布；校验是结构证据，不是产品运行证据。

## 必须核对

1. 稳定清单入口可推进，包 URL 固定版本；静态平台键覆盖两个 macOS 架构。
2. candidate 认证下载 draft 真实资产；公开后在新 Suite 无凭证验收；只在通过后推进 latest。updater 测试 URL 投影和正式配置不能混淆。
3. 精确 run ID/attempt/tag/source、场景报告和 digest 检查有明确 producer 与负例；不再把 `gh --jq` 裸字符串喂给 JSON parser或从 run success 推导功能通过。
4. Rust main.rs 中 updater Builder 注册和真实插件调用在 writeSet/doneWhen 中。
5. 升级前完整备份；无兼容证据拒绝原位回滚；新卷恢复、数据读回和失败现场保留。
6. T03/T04/T05 的 `runtimeReuse` 和 attach-only 场景资源 ownership 与 Suite 报告。
7. 完整 SemVer 版本对真实递增；缺场景、缺平台、失败公开验收保持 UNPROVEN。
8. 原 frozen package 保留不修改；formal proof 不因空 Gate 列表豁免；当前仅文档修订授权。

## 校验入口

```sh
make plan-validate PLAN=docs/architecture/engineering/release-distribution/execution-plans/20261021-release-distribution-review/plan.md
python3 tooling/scripts/acceptance-pipeline-audit.py --plan docs/architecture/engineering/release-distribution/execution-plans/20261021-release-distribution-review/plan.md --tasks RD-T03,RD-T04,RD-T05
node tooling/scripts/architecture/module-governance.mjs validate
```

输出 source-backed findings；确认 scope、DAG、契约与失败语义自洽后给出通过或具体仍缺的设计义务。无运行记录时必须写 `NOT_RUN`。

## 本轮复审结果

- Plan digest：`589481179bb6992bd978b9f8e6f3459c4b62e638fd2323b9af229e2d80e29bfd`。
- Plan、T03/T04/T05 复用契约审计、现有模块治理和文档链接/语法校验通过；旧 package digest 保持不变。
- 独立只读复审确认上述五个主问题和 runtimeReuse 已在设计/计划层闭环，未发现可确认的剩余 blocking/major。
- 产品运行、升级/恢复、跨平台安装和正式 Acceptance 均为 `NOT_RUN`；该结论仅针对文档修订，不批准实施或发布。
