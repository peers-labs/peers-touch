# Comment Replies Integration Test

## 测试目标
验证评论加载功能的完整流程，特别是URL编码/解码问题。

## 测试场景

### 1. URL编码测试

**目的**: 确保完整的ActivityPub URL可以正确传递和解析

**测试步骤**:
1. 创建一个帖子，获取其完整的ActivityPub URL
2. 为该帖子创建一条评论
3. 通过前端点击评论按钮
4. 验证API请求的URL格式
5. 验证后端收到的objectId是完整的URL
6. 验证返回的评论数据正确

**预期结果**:
```
前端发送: GET /activitypub/object/replies?objectId=http://localhost:18080/activitypub/user/objects/123&page=true
后端接收: objectId = "http://localhost:18080/activitypub/user/objects/123"
返回数据: { "orderedItems": [...], "totalItems": 1 }
```

### 2. 特殊字符测试

**测试URL**:
- `http://localhost:18080/activitypub/user-name/objects/123`
- `http://localhost:18080/activitypub/user/objects/123?param=value`
- `http://localhost:18080/activitypub/user/objects/123#section`

**验证点**:
- URL中的 `://` 不会变成 `:/`
- 特殊字符不会被错误编码
- Query参数和Hash不会干扰路由

### 3. 分页测试

**测试步骤**:
1. 创建一个帖子
2. 为该帖子创建15条评论
3. 点击评论按钮，验证只显示前10条
4. 点击"Load more"按钮
5. 验证显示了剩余5条评论

**预期结果**:
- 第一次加载: 显示10条评论
- 点击"Load more": 显示15条评论
- "Load more"按钮消失

## 自动化测试脚本

### 后端测试
```bash
cd station
go test ./frame/touch -run TestGetObjectRepliesQuery -v
go test ./frame/touch -run TestURLEncodingInReplies -v
```

### 前端测试
```bash
cd client/desktop
flutter test test/features/discovery/repository/discovery_repository_test.dart
```

### 集成测试
```bash
# 1. 启动后端
cd station && ./peers-touch-station

# 2. 运行前端集成测试
cd client/desktop
flutter test integration_test/comment_replies_test.dart
```

## 常见问题排查

### 问题1: 404 Not Found
**症状**: 点击评论按钮后返回404
**排查**:
1. 检查后端日志，查看收到的URL
2. 验证URL中的 `://` 是否完整
3. 确认路由是否正确注册

**解决方案**: 使用query参数而不是路径参数传递objectId

### 问题2: 评论不显示
**症状**: API返回200但前端不显示评论
**排查**:
1. 检查前端日志中的响应数据
2. 验证 `orderedItems` 字段是否存在
3. 检查评论解析逻辑

**解决方案**: 添加详细日志，追踪数据流

### 问题3: URL编码错误
**症状**: 后端收到的URL缺少斜杠或有其他编码问题
**排查**:
1. 在前端打印编码后的URL
2. 在后端打印解码后的URL
3. 对比两者是否一致

**解决方案**: 
- 前端: 使用query参数，让框架自动处理编码
- 后端: 直接从query参数读取，不要手动解码

## 测试覆盖率目标

- [ ] URL编码/解码: 100%
- [ ] 评论加载逻辑: 90%+
- [ ] 分页功能: 100%
- [ ] 错误处理: 80%+

## 回归测试检查清单

每次修改评论相关代码后，必须运行以下测试:

- [ ] 后端单元测试通过
- [ ] 前端单元测试通过
- [ ] 手动测试: 创建帖子 → 添加评论 → 查看评论
- [ ] 手动测试: 多条评论的分页加载
- [ ] 检查日志无错误
- [ ] 验证URL格式正确

## 性能测试

### 负载测试
- 单个帖子有100条评论时的加载时间
- 并发10个用户同时加载评论
- 数据库查询性能

### 预期指标
- 首次加载10条评论: < 200ms
- 加载更多10条: < 150ms
- 数据库查询: < 50ms
