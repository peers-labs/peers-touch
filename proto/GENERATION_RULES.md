# Proto生成规则定义

## 文件头注释格式

在proto文件的开头添加如下格式的注释，用于指定代码生成目标：

```protobuf
// PEERS_GENERATION_CONFIG:
//   targets: [backend, desktop, mobile]
//   model_only: false
//   skip: []
```

## 参数说明

- `targets`: 指定要生成的目标平台，可选值：
  - `backend`: 生成Go代码到station后端
  - `desktop`: 生成Dart代码到desktop前端
  - `mobile`: 生成Dart代码到mobile前端
  - `all`: 生成到所有平台（默认值）

- `model_only`: 是否只生成模型代码而不生成gRPC服务代码
  - `true`: 只生成消息模型，不生成服务接口
  - `false`: 生成完整代码包括gRPC服务（默认值）

- `skip`: 跳过特定平台的生成，可选值同上

## 示例

### 1. 生成到所有平台的完整proto
```protobuf
// PEERS_GENERATION_CONFIG:
//   targets: [all]
//   model_only: false
```

### 2. 只生成模型，不生成gRPC服务
```protobuf
// PEERS_GENERATION_CONFIG:
//   targets: [all]
//   model_only: true
```

### 3. 只生成到后端和桌面端
```protobuf
// PEERS_GENERATION_CONFIG:
//   targets: [backend, desktop]
```

### 4. 生成到所有平台但跳过移动端
```protobuf
// PEERS_GENERATION_CONFIG:
//   targets: [all]
//   skip: [mobile]
```

### 5. 只生成模型到后端
```protobuf
// PEERS_GENERATION_CONFIG:
//   targets: [backend]
//   model_only: true
```

## 使用方式

在proto文件的开头添加这些注释，然后运行生成脚本时会自动识别并应用这些规则。

例如，对于AI模型能力定义的proto文件：

```protobuf
// PEERS_GENERATION_CONFIG:
//   targets: [backend, desktop, mobile]
//   model_only: true

syntax = "proto3";
package peers_touch.v1;

message ModelCapability {
  // ... 字段定义
}
```

这样配置后，这个消息模型会被生成到所有三个平台，但不会生成gRPC服务代码。