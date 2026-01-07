# Client 测试

## 目录结构

```
qa/client/
├── README.md           # 本文档
├── desktop/            # Desktop 客户端测试
│   └── widget_tests/   # Widget 测试
└── mobile/             # Mobile 客户端测试
    └── widget_tests/   # Widget 测试
```

## 测试类型

### 1. Widget 测试

测试 Flutter Widget 的渲染和交互。

**位置**:
- Desktop: `client/desktop/test/`
- Mobile: `client/mobile/test/`

**运行**:
```bash
# Desktop
cd client/desktop
flutter test

# Mobile
cd client/mobile
flutter test
```

### 2. 集成测试

测试完整的用户流程。

**位置**:
- Desktop: `client/desktop/integration_test/`
- Mobile: `client/mobile/integration_test/`

**运行**:
```bash
# Desktop
cd client/desktop
flutter test integration_test

# Mobile
cd client/mobile
flutter test integration_test
```

## 测试覆盖率

```bash
# 生成覆盖率报告
cd client/desktop  # 或 client/mobile
flutter test --coverage
genhtml coverage/lcov.info -o coverage/html
open coverage/html/index.html
```

## 测试原则

1. **每个 Controller 必须有测试**
2. **关键 Widget 必须有测试**
3. **业务逻辑必须有测试**
4. **不测试第三方库**

## 待完善

- [ ] 添加 Widget 测试示例
- [ ] 添加集成测试示例
- [ ] 配置 CI/CD 自动测试
- [ ] 设置覆盖率目标（80%+）
