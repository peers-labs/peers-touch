# Recovery Identity Resilience：预期效果与验证

> **Plan**: RIR-20261105
> **Owner**: Architecture Team

## Outcome Comparison Contract

```json
{
  "kind": "peers-touch-outcome-comparison-contract",
  "schemaVersion": 1,
  "planId": "RIR-20261105",
  "plannedSectionDigest": "sha256:0a721c1c3fe0c4f04b4d2f30081c1d10b8b93ee8d114414bfabd8b16336333fb",
  "criteria": [
    {"id": "RIR-O01", "dimension": "user-experience", "title": "擦机可恢复与僵尸设备一处可治", "taskIds": ["RIR-03", "RIR-04", "RIR-06", "RIR-07"], "gateIds": ["rg2-reinstall-survival", "rg3-zombie-non-blocking"]},
    {"id": "RIR-O02", "dimension": "product-capability", "title": "短语即身份根的恢复身份双端可用", "taskIds": ["RIR-01", "RIR-02", "RIR-03", "RIR-04", "RIR-07"], "gateIds": ["rg1-fresh-device", "rg2-reinstall-survival", "rg5-desktop-convergence", "rg7-clean-archive-restore"]},
    {"id": "RIR-O03", "dimension": "architecture", "title": "恢复身份单一真源与平行路径删除", "taskIds": ["RIR-02", "RIR-03", "RIR-04", "RIR-08"], "gateIds": []},
    {"id": "RIR-O04", "dimension": "technology", "title": "保险库防回滚、类型化阻断与防截屏合同", "taskIds": ["RIR-01", "RIR-02", "RIR-04", "RIR-05", "RIR-07"], "gateIds": ["rg4-rotation-history", "rg6-opaque-remote-blocking"]},
    {"id": "RIR-O05", "dimension": "quality-operations", "title": "exact-source Gates、构建门与无隐式生成器结构证明", "taskIds": ["RIR-01", "RIR-02", "RIR-03", "RIR-04", "RIR-05", "RIR-06", "RIR-07", "RIR-08"], "gateIds": ["rg1-fresh-device", "rg2-reinstall-survival", "rg3-zombie-non-blocking", "rg4-rotation-history", "rg5-desktop-convergence", "rg6-opaque-remote-blocking", "rg7-clean-archive-restore"]}
  ]
}
```

## Planned Outcome Comparison

### RIR-O01：擦机可恢复与僵尸设备一处可治

SOURCE_FACT：Mobile 生产路径无法生成恢复短语，单设备擦除后无法重新 enroll
同一 PTID；设备仅能显式撤销而 Desktop 客户端禁止撤销非当前设备、Mobile
无设备传输，耗尽池造成永久阻断且报错不指明设备。
目标是重装后凭短语完成 vault 取回、re-enroll 与历史恢复（RG-2），并在
Settings 看到设备列表、按名撤销僵尸（RG-3），阻断报错按 self/远程分级。
预期消除「一台死设备卡死全部私密发布」与客服介入恢复；不改变服务端展开
受众的匿名性，也不提供首跑引导（独立产品合同）。

### RIR-O02：短语即身份根的恢复身份双端可用

SOURCE_FACT：内容恢复 master 只在 Desktop 聊天归档建备份时落盘，Mobile
仅有 acceptance 随机种子；生产 Mobile 作者自身 recovery 槽即不可用。
目标是 Desktop 与 Mobile 都能通过生产命令创建/轮换/恢复 Recovery
Identity，READY 后私密发布对自池可用，归档降级为消费者（RG-1、RG-5、
RG-7）。预期单设备无第二硬件、无归档即可恢复；不承诺恢复从未存在
recovery 槽的历史内容。

### RIR-O03：恢复身份单一真源与平行路径删除

SOURCE_FACT：聊天归档反向引导 actor 恢复身份；双端各有一个 harness 随机
短语生成器；身份 seed 的另一个载体是聊天归档内嵌副本。
目标是 vault 成为唯一身份恢复权威，core 为唯一生命周期实现，归档两条
master 播种分支与两个随机生成器在切割提交内删除（RIR-08 零命中证明）。
预期无双 bootstrap、无兼容开关、无平行领域合同；既有 keyring 行零迁移。

### RIR-O04：保险库防回滚、类型化阻断与防截屏合同

SOURCE_FACT：claim 在首个耗尽 principal 即失败且错误身份在首层被丢弃；
Actor Identity 路由无设备持有证明包装；Mobile Web 无防截屏能力。
目标是 vault PUT 同事务 CAS+epoch 单调、GET JWT-only、PUT 需新设备证明；
claim prescan 行锁聚合并输出枚举资格分级 typed proto，联邦仅 code/上界
（RG-4 旧 blob 拒绝、RG-6 差分不可区分）；Mobile 新增 native secure-view。
预期 Station 永不明文接触保险库，发送方学不到远程受众成员，短语展示不被
截屏采集；不做服务端自动休眠。

### RIR-O05：exact-source Gates、构建门与无隐式生成器结构证明

SOURCE_FACT：现有 acceptance 恢复证据走平行随机路径，不能证明生产创建或
重装恢复；无生产构建无隐式生成器的结构门。
目标是 RG-1…RG-7 全部为 exact-source Journey（含双 iOS 模拟器与受控
Station），RG-8 为双端结构性 source gate，各 Task 聚焦门（go build/test、
cargo、tsc、vite、文档索引）先行。
预期未运行 Gate 保持 UNPROVEN，签名发布证据不在本计划；开发期检查不被
当作正式 Acceptance。

## Actual Outcome Results

计划冻结时尚无执行结果。全部 criterion 初始为 UNPROVEN，执行中仅按
current-source 证据更新；PASS/PARTIAL 必须附 source identity 与证据引用。

## Outcome Comparison Results

```json
{
  "kind": "peers-touch-outcome-comparison-results",
  "schemaVersion": 1,
  "planId": "RIR-20261105",
  "sourceIdentity": null,
  "items": [
    {"id": "RIR-O01", "status": "UNPROVEN", "actualEffect": "尚未执行，无擦机恢复或设备撤销现场结果", "evidenceRefs": [], "deviation": "RG-2/RG-3 待 harness iOS slice 与受控 Station"},
    {"id": "RIR-O02", "status": "UNPROVEN", "actualEffect": "尚未执行，双端身份创建能力未落地", "evidenceRefs": [], "deviation": "RG-1/RG-5/RG-7 未运行"},
    {"id": "RIR-O03", "status": "UNPROVEN", "actualEffect": "尚未执行，旧路径仍在当前源码", "evidenceRefs": [], "deviation": "切割在 RIR-03/04/08"},
    {"id": "RIR-O04", "status": "UNPROVEN", "actualEffect": "尚未执行，vault 与类型化阻断未实现", "evidenceRefs": [], "deviation": "RG-4/RG-6 未运行"},
    {"id": "RIR-O05", "status": "UNPROVEN", "actualEffect": "计划已冻结，无执行证据", "evidenceRefs": [], "deviation": "全部 Gate UNPROVEN"}
  ]
}
```
