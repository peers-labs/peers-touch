# Log Sampling Guide

## 概述

日志采样（Log Sampling）是一种控制高频重复日志输出的技术，用于防止日志洪水（log flooding）导致的磁盘空间耗尽和性能下降。

## 适用场景

### ✅ 适合使用采样的场景

1. **轮询日志**
   ```go
   for {
       logger.Debug(ctx, "polling status")
       time.Sleep(100 * time.Millisecond)
   }
   ```
   - 问题：每秒产生 10 条相同日志
   - 采样后：每分钟 15 条（减少 97.5%）

2. **心跳日志**
   ```go
   ticker := time.NewTicker(1 * time.Second)
   for range ticker.C {
       logger.Info(ctx, "heartbeat")
   }
   ```
   - 问题：每分钟 60 条
   - 采样后：每分钟 10 条（减少 83%）

3. **高频调试日志**
   ```go
   for _, item := range largeList {
       logger.Debug(ctx, "processing item", item.ID)
   }
   ```
   - 问题：列表很大时产生大量日志
   - 采样后：只记录前 N 条和之后的样本

### ❌ 不适合使用采样的场景

1. **错误日志** - 已自动排除（Warn/Error/Fatal 不会被采样）
2. **业务关键日志** - 如用户操作、交易记录
3. **低频日志** - 本身就不频繁的日志无需采样

## 配置说明

### 基础配置

```yaml
peers:
  logger:
    name: slogrus
    level: debug
    slogrus:
      sampling:
        enable: true
        initial: 100
        thereafter: 100
        window: 1m
        per-package: false
```

### 参数详解

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enable` | bool | false | 是否启用采样 |
| `initial` | int | 100 | 前 N 条日志全部记录 |
| `thereafter` | int | 100 | 之后每 M 条记录 1 条 |
| `window` | duration | 1m | 计数器重置时间窗口 |
| `per-package` | bool | false | 是否按包分别采样 |

### 配置示例

#### 1. 保守配置（推荐用于生产环境）

```yaml
sampling:
  enable: true
  initial: 100        # 前 100 条全记录，确保不丢失重要信息
  thereafter: 100     # 之后 1/100 采样率
  window: 1m          # 每分钟重置
  per-package: false  # 全局采样
```

**效果**：
- 前 100 条：全部记录
- 之后：每 100 条记录 1 条
- 每分钟重置计数器

#### 2. 激进配置（用于开发环境或日志量极大的场景）

```yaml
sampling:
  enable: true
  initial: 50         # 前 50 条
  thereafter: 200     # 之后 1/200
  window: 30s         # 30 秒重置
  per-package: true   # 按包分别采样
```

**效果**：
- 更激进的采样率（1/200）
- 更短的重置窗口（30秒）
- 按包独立计数

#### 3. 针对特定包的配置

结合包级别日志配置使用：

```yaml
peers:
  logger:
    level: info
    slogrus:
      report-caller: true
      sampling:
        enable: true
        initial: 20
        thereafter: 50
        window: 1m
        per-package: true
```

然后在代码中为特定包设置 Debug 级别：

```go
logger.Init(ctx,
    logger.WithLevel(logger.InfoLevel),
    logger.WithPackageLevel("plugin/native/mdns", logger.DebugLevel),
)
```

这样只有 mdns 包的 Debug 日志会被采样。

## 工作原理

### 采样算法

```
消息哈希 → 计数器 → 判断是否记录
    ↓
[per-package=true]
    ↓
包路径+消息哈希 → 独立计数器 → 判断是否记录
```

### 计数器逻辑

```go
if count <= initial {
    记录日志
} else if (count - initial) % thereafter == 0 {
    记录日志 + suppressed_count
    重置 suppressed_count
} else {
    suppressed_count++
    丢弃日志
}
```

### 时间窗口重置

```go
if time.Since(lastReset) > window {
    count = 0
    suppressed_count = 0
    lastReset = now
}
```

## 输出示例

### 示例 1：基础采样

配置：`initial=5, thereafter=10`

```
2025-01-21 10:00:00.001 level=debug msg="polling status" pkg=mdns
2025-01-21 10:00:00.101 level=debug msg="polling status" pkg=mdns
2025-01-21 10:00:00.201 level=debug msg="polling status" pkg=mdns
2025-01-21 10:00:00.301 level=debug msg="polling status" pkg=mdns
2025-01-21 10:00:00.401 level=debug msg="polling status" pkg=mdns
[第 6-14 条被抑制]
2025-01-21 10:00:01.501 level=debug msg="polling status" pkg=mdns suppressed_count=9
[第 16-24 条被抑制]
2025-01-21 10:00:02.601 level=debug msg="polling status" pkg=mdns suppressed_count=9
```

### 示例 2：按包采样

配置：`initial=3, thereafter=5, per-package=true`

```
# 包 A
2025-01-21 10:00:00.001 level=debug msg="checking" pkg=mdns
2025-01-21 10:00:00.101 level=debug msg="checking" pkg=mdns
2025-01-21 10:00:00.201 level=debug msg="checking" pkg=mdns
[抑制 4 条]
2025-01-21 10:00:00.801 level=debug msg="checking" pkg=mdns suppressed_count=4

# 包 B（独立计数）
2025-01-21 10:00:00.050 level=debug msg="syncing" pkg=store
2025-01-21 10:00:00.150 level=debug msg="syncing" pkg=store
2025-01-21 10:00:00.250 level=debug msg="syncing" pkg=store
[抑制 4 条]
2025-01-21 10:00:00.850 level=debug msg="syncing" pkg=store suppressed_count=4
```

## 性能影响

### 内存开销

- 每个唯一消息：约 100 字节（计数器 + 哈希键）
- 1000 个不同消息：约 100KB
- 可忽略不计

### CPU 开销

- SHA256 哈希计算：约 1-2 微秒/次
- 对于高频日志（每秒数百条），CPU 开销 < 0.1%
- 可忽略不计

### 采样收益

假设一个包每 100ms 打一条相同的 Debug 日志：

| 配置 | 日志量/分钟 | 磁盘占用/天 | 减少比例 |
|------|-------------|-------------|----------|
| 无采样 | 600 | ~50MB | 0% |
| initial=50, thereafter=100 | 50 + 5 = 55 | ~4.5MB | 91% |
| initial=20, thereafter=200 | 20 + 2 = 22 | ~1.8MB | 96% |

## 最佳实践

### 1. 渐进式启用

```yaml
# 第一步：启用但使用保守配置
sampling:
  enable: true
  initial: 200
  thereafter: 100
  window: 1m

# 观察一段时间后，根据实际情况调整
# 第二步：适度收紧
sampling:
  enable: true
  initial: 100
  thereafter: 100
  window: 1m

# 第三步：针对性优化
sampling:
  enable: true
  initial: 50
  thereafter: 200
  window: 1m
  per-package: true
```

### 2. 监控 suppressed_count

在日志聚合系统中监控 `suppressed_count` 字段：

```
suppressed_count > 1000  # 警告：某个日志被大量抑制
suppressed_count > 10000 # 严重：可能需要调整代码
```

### 3. 结合日志级别使用

```yaml
peers:
  logger:
    level: info          # 全局 Info
    slogrus:
      sampling:
        enable: true
        initial: 50
        thereafter: 100
```

然后在代码中为需要调试的包开启 Debug：

```go
logger.WithPackageLevel("plugin/native/mdns", logger.DebugLevel)
```

这样只有 mdns 的 Debug 日志会被采样，其他包不受影响。

### 4. 避免过度依赖采样

采样是**应急手段**，不是**长期方案**。如果某个日志被大量抑制：

❌ **错误做法**：一直依赖采样
```go
for {
    logger.Debug(ctx, "checking status")  // 依赖采样控制
    time.Sleep(100 * time.Millisecond)
}
```

✅ **正确做法**：优化日志策略
```go
lastLog := time.Now()
for {
    if time.Since(lastLog) > 10*time.Second {
        logger.Debug(ctx, "checking status")
        lastLog = time.Now()
    }
    time.Sleep(100 * time.Millisecond)
}
```

## 故障排查

### 问题 1：采样不生效

**症状**：启用采样后日志量没有减少

**排查步骤**：

1. 检查配置是否正确加载
   ```bash
   # 查看日志确认配置
   grep "sampling" /var/logs/peers-touch/app.log
   ```

2. 确认日志级别
   - 采样只对 Debug 和 Info 生效
   - Warn/Error/Fatal 不会被采样

3. 检查 `per-package` 配置
   - 如果 `per-package: true`，需要 `report-caller: true`

### 问题 2：重要日志被抑制

**症状**：某些重要的 Debug 日志被采样丢失

**解决方案**：

1. 提高 `initial` 值
   ```yaml
   initial: 200  # 增加初始全记录数量
   ```

2. 将重要日志改为 Info 级别
   ```go
   logger.Info(ctx, "important status")  // 不会被采样
   ```

3. 使用条件日志
   ```go
   if isImportant {
       logger.Info(ctx, "critical status")
   } else {
       logger.Debug(ctx, "normal status")  // 可能被采样
   }
   ```

### 问题 3：suppressed_count 过大

**症状**：`suppressed_count` 经常超过 1000

**解决方案**：

1. 优化代码，减少日志频率
2. 调整采样参数
   ```yaml
   initial: 20
   thereafter: 50  # 增加采样率
   ```
3. 考虑将该日志降级或移除

## 参考资料

- [Uber Zap Sampling](https://github.com/uber-go/zap/blob/master/FAQ.md#why-sample-application-logs)
- [Google SRE: Logging Best Practices](https://sre.google/sre-book/monitoring-distributed-systems/)
- [Logrus README](../README.md)
