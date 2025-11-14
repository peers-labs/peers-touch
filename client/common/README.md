# Peers-Touch 基础库整合方案

## 背景与目标

当前common目录下存在多个独立基础库（ai_proxy_client、network_client、storage等），考虑到目前主要有mobile和desktop两个项目使用，为简化依赖管理和项目结构，建议将这些库合并为一个统一的基础库。

## 合并方案

### 1. 新目录结构

```
peers_touch_base/
├── lib/
│   ├── ai_proxy/
│   │   ├── src/
│   │   └── ai_proxy.dart
│   ├── network/
│   │   ├── src/
│   │   └── network.dart
│   ├── storage/
│   │   ├── src/
│   │   └── storage.dart
│   ├── utils/
│   └── peers_touch_base.dart
├── pubspec.yaml
├── README.md
└── test/
    ├── ai_proxy_test/
    ├── network_test/
    └── storage_test/
```

### 2. 模块划分

| 原库名 | 新模块名 | 功能说明 |
|--------|----------|----------|
| peers_touch_ai_proxy_client | ai_proxy | AI代理客户端功能 |
| peers_touch_network_client | network | 网络通信功能 |
| peers_touch_storage | storage | 存储功能 |
| - | utils | 通用工具类 |

### 3. 迁移步骤

#### 第一步：创建基础库结构
```bash
mkdir -p peers_touch_base/lib/{ai_proxy,network,storage,utils}
cd peers_touch_base
flutter create --template=package .
```

#### 第二步：迁移现有代码
```bash
# 迁移AI代理客户端
cp -r ../peers_touch_ai_proxy_client/lib/src/* lib/ai_proxy/src/

# 迁移网络客户端
cp -r ../peers_touch_network_client/lib/src/* lib/network/src/

# 迁移存储库
cp -r ../peers_touch_storage/lib/src/* lib/storage/src/
```

#### 第三步：调整导入路径
```dart
// 原导入
import 'package:peers_touch_ai_proxy_client/peers_touch_ai_proxy_client.dart';

// 新导入
import 'package:peers_touch_base/ai_proxy/ai_proxy.dart';
```

#### 第四步：更新pubspec.yaml
```yaml
dependencies:
  flutter:
    sdk: flutter
  dio: ^5.4.3+1
  flutter_svg: ^2.0.9
  get_storage: ^2.1.1
  flutter_secure_storage: ^9.2.2
  # 其他依赖...

# 导出所有模块
exports:
  - ai_proxy/ai_proxy.dart
  - network/network.dart
  - storage/storage.dart
  - utils/utils.dart
```

## 优势分析

### 1. 简化项目结构
- 减少库的数量，降低维护成本
- 统一的基础库版本控制
- 避免跨库调用的复杂性

### 2. 提升开发效率
- 单一依赖源，简化配置
- 内部模块调用无需跨库引用
- 统一的代码风格和规范

### 3. 便于扩展
- 新增功能只需添加新模块
- 模块间边界清晰
- 便于后续其他项目复用

## 注意事项

1. **依赖冲突**：合并过程中需解决可能的依赖冲突
2. **命名空间**：确保各模块内部类名不冲突
3. **版本控制**：制定明确的版本号管理策略
4. **测试策略**：保留各模块独立测试，同时添加集成测试

## 迁移时间表

1. **第1周**：完成基础库结构搭建和代码迁移
2. **第2周**：调整mobile和desktop项目依赖
3. **第3周**：测试验证和问题修复
4. **第4周**：正式切换到新库

## 结论

将多个基础库合并为peers_touch_base是当前阶段的合理优化，能够简化项目结构，提高开发效率，同时为未来扩展奠定良好基础。