# Chat 本机存储治理 - 基准取舍

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-26 | **Updated**: 2026-09-27
> **Owner**: Device Messaging Engine

---

## 1. 证据边界

基准只用于确认用户期望的现代聊天存储体验，不反推外部产品的服务端存储、删除或
加密实现。具体架构以 Peers-Touch 当前源码和既有 Chat/Encryption 真源为准。

## 2. 取舍

| ID | 基准行为 | 取舍 | Peers-Touch 决定 |
|---|---|---|---|
| CSG-B01 | 展示应用总占用与类别 | adopt | 展示当前设备 Chat 真实物理占用 |
| CSG-B02 | 按聊天查看占用并排序 | adopt | 联系人和群聊统一统计，可搜索 |
| CSG-B03 | 一键清理可再生成缓存 | adapt | 只清 Engine-managed 可再生成 Chat 缓存 |
| CSG-B04 | 少量历史保留选项 | adapt | 永久、1 年、90 天、30 天 |
| CSG-B05 | 按会话清理本机数据 | adopt | sequence/hash floor + 物理删除 |
| CSG-B06 | 删除动作说明影响范围 | adopt | 区分本机清理、为我删除、撤回 |
| CSG-B07 | 报告释放空间 | adopt | 返回估算、实际释放量和待压缩状态 |
| CSG-B08 | 自动管理临时缓存 | adapt | 固定内部预算，不暴露高级调参 |
| CSG-B09 | 全局一键删除所有聊天 | reject | 仅按会话清理 |
| CSG-B10 | 清空后短时撤销 | reject | 二次确认后真实回收 |
| CSG-B11 | 会话级阅后即焚 | reject | 删除未完成骨架，未来独立设计 |
| CSG-B12 | 完全相同的双端 UI | reject | 统一语义与信息层级，保留平台交互 |
| CSG-B13 | 保留旧 schema 迁移 | reject | clean baseline，无历史用户 |
| CSG-B14 | 从存储列表多选聊天后批量清理 | adapt | 只清理显式选择的当前搜索结果，逐会话复用 canonical 清理并报告部分失败 |

## 3. 最小现代基线

本模块只承诺：看总量、找大户、清缓存、选保留期、单个或批量选择会话释放空间、
理解删除范围，并在双端得到相同结果。高级策略、无选择范围的全局删除、云端配额、
商业套餐、归档层和企业治理均不进入。
