# Station API Documentation

> **Comprehensive API Reference for Peers-Touch Station**

---

## 📍 Documentation Location

The primary API documentation is maintained in:

**`station/frame/touch/ROUTER_PROTOCOL.zh.md`**

This document contains:
- All HTTP endpoints (ActivityPub, Mastodon-compatible, and custom)
- Compatibility status with ActivityPub and Mastodon
- Request/response formats
- Authentication requirements
- Federation behavior

---

## 📋 API Categories

### 1. **Standard ActivityPub Endpoints**
Fully compliant with W3C ActivityPub Recommendation:
- Actor documents (`GET /:actor/actor`)
- Inbox/Outbox (`GET/POST /:actor/inbox`, `GET/POST /:actor/outbox`)
- Collections (`GET /:actor/followers`, `GET /:actor/following`, `GET /:actor/liked`)
- Shared Inbox (`GET/POST /inbox`)

### 2. **Convenience Endpoints**
Application-layer shortcuts that generate standard ActivityPub activities:
- Follow/Unfollow (`POST /:actor/follow`, `POST /:actor/unfollow`)
- Like/Undo (`POST /:actor/like`, `POST /:actor/undo`)
- Activity creation (`POST /:actor/activity`)

### 3. **Actor Management**
User account and profile management:
- Registration (`POST /activitypub/sign-up`)
- Login (`POST /activitypub/login`)
- OAuth2 Login (`POST /auth/oauth2/login`) — 计划新增，见下文 §Authentication
- Profile (`GET/POST /activitypub/profile`)
- User list (`GET /activitypub/list`)
- User search (`GET /activitypub/search`)

### 4. **Mastodon-Compatible API**
Subset of Mastodon REST API for client compatibility:
- Apps (`POST /api/v1/apps`)
- Accounts (`GET /api/v1/accounts/verify_credentials`)
- Statuses (`POST /api/v1/statuses`, `GET /api/v1/statuses/:id`)
- Interactions (`POST /api/v1/statuses/:id/favourite`, `POST /api/v1/statuses/:id/reblog`)
- Timelines (`GET /api/v1/timelines/home`, `GET /api/v1/timelines/public`)
- Instance (`GET /api/v1/instance`)
- Directory (`GET /api/v1/directory`)

### 5. **Well-Known Endpoints**
Discovery and federation metadata:
- WebFinger (`GET /.well-known/webfinger`)
- Host-Meta (`GET /.well-known/host-meta`)
- NodeInfo (`GET /.well-known/nodeinfo`, `GET /nodeinfo/2.1`)

### 6. **Internal Endpoints**
Peers-Touch specific features (not part of ActivityPub):
- Peer management (`POST /peer/set-addr`, `GET /peer/get-my-peer-info`)
- Node registry (`GET/POST/DELETE /nodes`)
- Conversations (`POST /conv`, `GET /conv/:id`)
- Messages (`POST /conv/:id/msg`, `GET /conv/:id/msg`)
- Health checks (`GET /health`, `GET /ping`)

---

## 🔐 Authentication

### JWT Authentication
Most endpoints require JWT authentication via `Authorization` header:

```
Authorization: Bearer <jwt_token>
```

### Password Login (已实现)

**Obtain token**:
```bash
POST /activitypub/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "device_type": "desktop"
}
```

**Response**:
```json
{
  "data": {
    "tokens": {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refresh_token": "",
      "token_type": "Bearer",
      "expires_at": "2026-04-07T12:00:00Z"
    },
    "session_id": "a1b2c3d4...",
    "actor": {
      "id": "123456",
      "actor_id": 123456,
      "username": "alice",
      "display_name": "Alice",
      "email": "user@example.com"
    }
  }
}
```

### OAuth2 Login (计划新增)

OAuth2 授权完成后，Desktop 将用户身份信息提交给 Station，Station 执行 Identity Resolve（自动注册 + 绑定）并签发 JWT。

```bash
POST /auth/oauth2/login
Content-Type: application/json

{
  "provider": "github",
  "provider_user_id": "12345",
  "email": "user@github.com",
  "username": "alice",
  "avatar_url": "https://avatars.githubusercontent.com/u/12345",
  "device_type": "desktop"
}
```

**Response**: 与密码登录格式完全相同（统一出口）。

**服务端行为**:
1. 查询 `OAuth2IdentityBinding` 表，匹配 `(provider, provider_user_id)`
2. 已绑定 → 取对应 `actor_id`
3. 未绑定 → 用 email 匹配已有 Actor，或自动创建新 Actor → 建立绑定
4. 复用 `LoginWithSession` 签发 JWT + 创建 Session

详细架构设计见 `docs/architecture/platform/station-desktop-boundary.md` §10。

### Token Refresh (计划新增)

```bash
POST /auth/token/refresh
Content-Type: application/json

{
  "refresh_token": "..."
}
```

### Logout (计划新增)

```bash
POST /auth/logout
Authorization: Bearer <jwt_token>
```

### HTTP Signatures
Federation endpoints (Inbox/Outbox) use HTTP Signatures for server-to-server authentication:
- Algorithm: `RSA-SHA256`
- Headers: `(request-target) host date digest`
- Key retrieval: From Actor document's `publicKey` field

---

## 📊 Response Format

### Success Response
```json
{
  "message": "Success message",
  "data": {
    // Response data
  }
}
```

### Error Response
```json
{
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

---

## 🔄 Pagination

Collections use ActivityStreams pagination:

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "OrderedCollection",
  "totalItems": 100,
  "first": "https://example.com/collection?page=1",
  "last": "https://example.com/collection?page=10"
}
```

**Query parameters**:
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20)

---

## 🧪 Testing

### Using cURL

**List local actors**:
```bash
curl -X GET http://localhost:8080/activitypub/list
```

**Search actors**:
```bash
curl -X GET "http://localhost:8080/activitypub/search?q=alice"
```

**Get Actor document**:
```bash
curl -X GET http://localhost:8080/activitypub/alice/actor \
  -H "Accept: application/activity+json"
```

### Using Postman/Insomnia

Import the collection from: `station/frame/touch/postman_collection.json` (if available)

---

## 📝 Maintenance Guidelines

### When Adding New Endpoints

1. **Implement the handler** in `station/frame/touch/*_handler.go`
2. **Register the route** in `station/frame/touch/*_router.go`
3. **Update documentation** in `station/frame/touch/ROUTER_PROTOCOL.zh.md`
4. **Add to appropriate table** with all required fields:
   - Interface path
   - Functionality description
   - ActivityPub compatibility
   - Mastodon compatibility
   - Compatibility statement
   - Reason for differences

### When Modifying Existing Endpoints

1. **Update the handler** code
2. **Update the documentation** in `ROUTER_PROTOCOL.zh.md`
3. **Note breaking changes** in changelog
4. **Update client code** if needed

---

## 🔗 Related Documents

- **Main API Spec**: `../../station/frame/touch/ROUTER_PROTOCOL.zh.md`
- **ActivityPub Spec**: https://www.w3.org/TR/activitypub/
- **Mastodon API Docs**: https://docs.joinmastodon.org/api/
- **WebFinger Spec**: https://tools.ietf.org/html/rfc7033
- **NodeInfo Spec**: https://nodeinfo.diaspora.software/

---

## 🆘 Troubleshooting

### Common Issues

**401 Unauthorized**:
- Check JWT token validity
- Ensure `Authorization` header is present
- Verify token hasn't expired

**404 Not Found**:
- Check route path and method
- Verify actor username exists
- Ensure endpoint is registered in router

**500 Internal Server Error**:
- Check server logs: `station/logs/`
- Verify database connection
- Check for missing configuration

---

*Last updated: 2026-01-03*
