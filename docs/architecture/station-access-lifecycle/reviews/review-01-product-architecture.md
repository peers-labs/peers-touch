# Review 01：Station 接入产品与架构

> **Status**: passed-after-correction
> **Reviewed**: 2026-09-26
> **Scope**: Product + Architecture
> **Reviewer Mode**: independent findings-first

## Findings 与修正

| 严重度 | Finding | 修正 |
|---|---|---|
| blocker | 原文档以“客户端平台”名义混入 Chat 存储，owner 无边界 | 拆为独立 `station-access-lifecycle` 模块 |
| blocker | protobuf-only Access 缺少 endpoint 与编码定义 | 固定四个 endpoint、双向 `application/protobuf` 和 generated decoder |
| high | 删除客户端 Join/Leave 与 Federation D-05 冲突 | 明确接受后 supersede D-05 对应条款 |
| high | Relay 与 Federation governance 被误写成客户端能力 | 收回 Station/operator plane，客户端只消费 context 与诊断 |
| high | 双端统一容易被误解为实现镜像 | 明确只统一协议、状态、错误、scope 与结果 |

## 复审

- 模块只回答“客户端如何可信进入 Station”，不再承载 Chat 存储。
- Station identity、Access Gate、scope、Federation context 与 Relay 边界闭合。
- 零兼容硬切与旧 Station 非兼容结果已显式声明。
- 产品能力、状态、架构 owner 与失败语义一致。

## 结论

`passed`
