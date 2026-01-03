# Station: App Layer (Business Logic)

> **Developing Subservers and Business Features**

---

## 🎯 Overview

The **App Layer** (`station/app`) is where all business logic resides. It is composed of modular **Subservers**.

**Location**: `station/app/subserver/`

---

## 🧩 Subserver Architecture

Each subserver (e.g., `auth`, `posting`, `ai_box`) is a self-contained module following the **Handler-Service-Repo** pattern.

### Standard Directory Structure

```text
station/app/subserver/<name>/
├── model/           # Generated Go structs from Proto
├── service/         # Business Logic
├── repository/      # Database Access
├── handler/         # HTTP/gRPC Handlers
└── <name>.go        # Module Entry/Wiring
```

### 1. Model (`model/`)
- **Source**: `model/domain/<name>.proto`
- **Action**: Generated via `protoc`.
- **Rule**: Do not modify generated files. Create helper structs in separate files if needed.

### 2. Handler (`handler/`)
- **Responsibility**: Parse request, validate input, call Service, format response.
- **Framework**: Use `frame/touch` for routing and context.
- **Example**:
  ```go
  func (h *AuthHandler) Login(c *touch.Context) {
      var req model.LoginRequest
      if err := c.Bind(&req); err != nil {
          c.Error(err)
          return
      }
      resp, err := h.service.Login(c.Ctx(), &req)
      if err != nil {
          c.Error(err)
          return
      }
      c.JSON(resp)
  }
  ```

### 3. Service (`service/`)
- **Responsibility**: Core business logic, transactions, complex validations.
- **Interface**: Should accept `context.Context` as first argument.
- **Rule**: Pure Go logic. No HTTP dependencies.

### 4. Repository (`repository/`)
- **Responsibility**: Direct database interactions (CRUD).
- **Tooling**: GORM or raw SQL (depending on project standard).
- **Rule**: Return domain models or errors.

---

## 🚀 Creating a New Subserver

1. **Define Proto**:
   - Create `model/domain/new_feature.proto`.
   - Run generation script.

2. **Create Structure**:
   - `mkdir -p station/app/subserver/new_feature/{model,service,repository,handler}`

3. **Implement Layers**:
   - Start from Repository (Data) -> Service (Logic) -> Handler (API).

4. **Register Module**:
   - Edit `station/app/app.go` (or equivalent registry).
   - Mount routes in `RegisterRoutes()`.

---

## 📡 Communication

### Inter-Subserver
- Use **Service Interfaces**.
- Inject `AuthService` into `PostingService` if needed.
- **Avoid Circular Dependencies**.

### Event Bus
- For decoupled logic (e.g., "Send email after signup"), use the Event Bus in `frame/core`.

---

## 🧪 Testing

- **Unit Tests**: Test Services and Repositories.
- **Integration Tests**: Test Handlers using `httptest`.
