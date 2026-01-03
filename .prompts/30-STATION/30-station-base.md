# Station Backend: Base Architecture

> **Backend Services for Peers-Touch**

---

## 🎯 Overview

The **Station** is the backend server that powers Peers-Touch. It handles:
- User authentication and authorization
- Data storage and retrieval
- Federation with other stations (ActivityPub)
- API endpoints for clients
- Background jobs and scheduled tasks

---

## 🏗️ Architecture

```
station/
├── frame/              # Core framework
│   ├── core/           # Core services (auth, config, registry)
│   ├── touch/          # API layer (routing, middleware)
│   └── vendors/        # Third-party integrations
│
└── app/                # Application layer
    ├── actuator/       # Health checks, metrics
    └── subserver/      # Modular services
        ├── ai_box/     # AI service management
        ├── auth/       # User authentication
        └── posting/    # Content management
```

---

## 📦 Key Components

### 1. Frame (Core Framework)

**Purpose**: Provides foundational services for all subservers

**Components**:
- **Auth**: JWT validation, permission checks
- **Config**: Configuration management
- **Registry**: Service discovery and registration
- **Transport**: HTTP/gRPC server setup
- **Logging**: Structured logging

### 2. Subservers (Modular Services)

**Purpose**: Independent business logic modules

**Examples**:
- **ai_box**: Manages AI providers and models
- **auth**: User registration, login, token management
- **posting**: Content creation, editing, federation

**Pattern**: Each subserver is self-contained with its own:
- Models (Proto-generated)
- Handlers (HTTP/gRPC endpoints)
- Services (Business logic)
- Repositories (Data access)

---

## 🔄 Request Flow

```
Client Request
    ↓
HTTP/gRPC Server (frame/touch)
    ↓
Middleware (auth, logging, rate limiting)
    ↓
Router (route to subserver)
    ↓
Subserver Handler
    ↓
Service Layer (business logic)
    ↓
Repository Layer (database)
    ↓
Response
```

---

## 📚 Related Documents

- **Architecture**: [../10-GLOBAL/11-architecture.md](../10-GLOBAL/11-architecture.md)
- **Go Standards**: [31-go-standards.md](./31-go-standards.md)
- **Domain Models**: [../10-GLOBAL/12-domain-model.md](../10-GLOBAL/12-domain-model.md)
- **API Documentation**: [32-api-documentation.md](./32-api-documentation.md)

---

## ⚠️ Important Reminders

### Quality Assurance Requirements

**MANDATORY checks before completing any task:**

#### 1. **Format Check** (Go Code Style)

```bash
cd station
gofmt -l .
```

**Expected result**: No output (all files are formatted)

**If files are listed**, format them:
```bash
gofmt -w .
```

#### 2. **Build Check** (Compilation)

```bash
cd station/app
go build -o /tmp/station-test .
```

**Expected result**: Build succeeds without errors

#### 3. **Test Check** (Unit Tests)

```bash
cd station
go test ./...
```

**Expected result**: All tests pass

#### Quality Checklist

Before marking a task as "done":

- [ ] **Code formatted**: `gofmt -l .` shows no files
- [ ] **Build succeeds**: `go build` completes without errors
- [ ] **Tests pass**: `go test ./...` shows all tests passing
- [ ] **No debug code**: No `fmt.Println()` or debug statements
- [ ] **Documentation updated**: API docs and comments are current
- [ ] **Error handling**: All errors are properly checked and handled

---

### When Adding/Modifying Handlers or Routers

**ALWAYS update the API documentation** after adding or modifying handlers/routers:

1. **Check if documentation update is needed**:
   - Did you add a new route?
   - Did you modify an existing route's behavior?
   - Did you change request/response format?

2. **Update the documentation**:
   - **Location**: `station/frame/touch/ROUTER_PROTOCOL.zh.md`
   - **Format**: Add/update the route in the appropriate table
   - **Required fields**:
     - Interface path (e.g., `GET /activitypub/search`)
     - Functionality description
     - Is it standard ActivityPub? (Yes/No)
     - Is it Mastodon-compatible? (Yes/No)
     - Compatibility statement
     - Reason for differences

3. **Example entry**:
   ```markdown
   | GET /activitypub/search | 搜索本地 Actor | 否 | 否 | 应用层模糊搜索；不影响联邦 | Peers Touch 用户搜索（按 username/display_name） |
   ```

**Why this matters**:
- Keeps API documentation in sync with code
- Helps other developers understand the API
- Documents compatibility with ActivityPub/Mastodon
- Tracks reasons for custom endpoints

**Checklist**:
- [ ] Route added/modified in code
- [ ] Documentation updated in `ROUTER_PROTOCOL.zh.md`
- [ ] Compatibility status documented
- [ ] Reason for custom endpoint explained (if applicable)

---

*For Go coding standards, see [31-go-standards.md](./31-go-standards.md)*
