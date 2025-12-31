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

---

*For Go coding standards, see [31-go-standards.md](./31-go-standards.md)*
