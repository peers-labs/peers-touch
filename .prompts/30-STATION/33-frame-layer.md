# Station: Frame Layer (Core Infrastructure)

> **Developing the Core Framework**

---

## 🎯 Overview

The **Frame Layer** (`station/frame`) provides the foundation for the Station. It handles cross-cutting concerns like networking, configuration, security, and plugin management.

**Location**: `station/frame/`

**Critical Rule**: Frame **MUST NOT** depend on App. App depends on Frame.

---

## 🏗️ Core Components

### 1. `frame/touch` (API Gateway)
- **Role**: HTTP/gRPC Server wrapper.
- **Features**:
  - **Router**: URL routing (likely based on Gin, Echo, or Stdlib).
  - **Context**: Custom Context object wrapping `http.Request` and `http.ResponseWriter`.
  - **Middleware**: Global middleware (Recovery, Logger, CORS).

### 2. `frame/core/config`
- **Role**: Configuration management.
- **Source**: Reads from `config.yaml`, env vars, or CLI flags.
- **Usage**: `config.Get("database.url")`.

### 3. `frame/core/auth`
- **Role**: Identity verification.
- **Features**:
  - JWT Token parsing and generation.
  - Permission/Role validation.
  - `UserContext` injection into Request Context.

### 4. `frame/core/registry`
- **Role**: Service discovery and dependency injection container.
- **Usage**: Allows subservers to register themselves and discover others.

---

## 🛠️ Extending the Frame

### Adding Middleware
1. Create function in `frame/touch/middleware`.
2. Signature: `func(next http.Handler) http.Handler` (or framework specific).
3. Register in `frame/touch/server.go`.

### Adding a Vendor Integration
- **Location**: `frame/vendors/` (e.g., S3, SendGrid, Redis).
- **Rule**: Create a generic interface adapter. Do not expose vendor-specific types to App layer if possible.

---

## 🔒 Security & Best Practices

- **Input Sanitization**: Frame should provide helpers to sanitize inputs.
- **Error Handling**: Global error handler in `touch` to format JSON errors uniformly.
- **Logging**: Use `frame/core/logger` (structured logging) instead of `fmt.Print`.

---

## 🔄 Lifecycle

1. **Bootstrap**: `main.go` calls `frame.New()`.
2. **Init**: Frame initializes Config, Logger, DB connection.
3. **Mount**: App subservers register routes to Frame.
4. **Serve**: Frame starts HTTP/gRPC listeners.
5. **Shutdown**: Frame handles graceful shutdown (SIGTERM), closing DB and listeners.
