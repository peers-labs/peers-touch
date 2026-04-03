# Architecture: Three-Tier System

> **Understanding How Peers-Touch Components Work Together**

---

## 🏛️ High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                                 │
│  ┌──────────────────────┐    ┌────────────────────────────────┐    │
│  │ Desktop (Tauri/TS)   │    │  Mobile (Native per platform)  │    │
│  │ - React + TypeScript │    │ - Android: Kotlin + Jetpack    │    │
│  │ - Rust commands      │    │            Compose             │    │
│  │ - App-only runtime   │    │ - iOS: Swift + SwiftUI         │    │
│  │                      │    │ - Station Relay (no P2P)       │    │
│  │                      │    │ - Lynx applet container        │    │
│  └──────────────────────┘    └────────────────────────────────┘    │
│             │                           │                            │
│             └───────────┬───────────────┘                            │
└─────────────────────────┼────────────────────────────────────────────┘
                          │
                    HTTP/gRPC + P2P (Desktop only)
                    HTTP/gRPC + Station Relay (Mobile)
                          │
┌─────────────────────────┼────────────────────────────────────────────┐
│                    MODEL LAYER                                        │
│                                                                        │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Protocol Buffers (.proto files)                             │    │
│  │  - Single source of truth for all data models                │    │
│  │  - Generated for Kotlin, Swift, Go (and Rust contracts       │    │
│  │    adapter)                                                  │    │
│  │  - Located in: model/domain/                                 │    │
│  └─────────────────────────────────────────────────────────────┘    │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
                      Generated Models
                            │
┌───────────────────────────┼──────────────────────────────────────────┐
│                    STATION LAYER                                      │
│                                                                        │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Frame (Core Framework)                                      │    │
│  │  - Routing, Auth, Config, Logging                            │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                            │                                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Subservers (Modular Services)                               │    │
│  │  - ai_box: AI service management                             │    │
│  │  - posting: Content creation/federation                      │    │
│  │  - auth: User authentication                                 │    │
│  │  - relay: Message relay for mobile clients                   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                            │                                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Federation Layer                                             │    │
│  │  - ActivityPub protocol                                      │    │
│  │  - Inter-station communication                               │    │
│  └─────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 📦 Component Breakdown

### 1. Client Layer (Desktop + Mobile)

**Shared Architecture**:
- Both consume proto/domain contracts
- Both depend on Station APIs for control-plane capability

**Key Differences**:
- Desktop: `apps/desktop` with Tauri + React/TS + Rust command bridge; supports relay + P2P hybrid for realtime messaging
- Mobile: `apps/mobile/android/` (Kotlin + Jetpack Compose) + `apps/mobile/ios/` (Swift + SwiftUI)，双端独立原生实现；**不走 P2P，所有实时通信通过 Station Relay 中转**
- Mobile Applet 容器：使用 [Lynx](https://github.com/lynx-family/lynx) 原生 LynxView 承载小程序/Applet，Android 端通过 LynxView 集成，iOS 端同理

**Directory Structure**:
```
apps/
├── desktop/
│   ├── src/               # React/TS UI + state
│   └── src-tauri/src/     # Rust contracts/commands/application
├── mobile/
│   ├── android/           # Kotlin + Jetpack Compose native app
│   ├── ios/               # Swift + SwiftUI native app
│   └── flutter/           # (archived) legacy Flutter implementation
├── station/...
client/common/
├── peers_touch_base/
└── peers_touch_ui/
```

---

### 2. Model Layer (Proto Definitions)

**Location**: `model/domain/`

**Purpose**: Single source of truth for all data structures

**Example**:
```protobuf
// model/domain/actor/actor.proto
syntax = "proto3";

message Actor {
  string id = 1;
  string handle = 2;
  string display_name = 3;
  string avatar_url = 4;
}1
```

**Generation**:
- For Kotlin (Android): `protoc --kotlin_out=...`
- For Swift (iOS): `protoc --swift_out=...`
- For Go (station): `protoc --go_out=...`

**Generated Files Location**:
- Kotlin: `apps/mobile/android/.../model/domain/`
- Swift: `apps/mobile/ios/.../model/domain/`
- Go: `apps/station/app/subserver/*/model/`

---

### 3. Station Layer (Backend)

**Location**: `apps/station/`

**Components**:

#### 3.1 Frame (Core Framework)
```
apps/station/frame/
├── core/           # Core services
│   ├── auth/       # Authentication
│   ├── config/     # Configuration
│   ├── registry/   # Service registry
│   └── transport/  # Network transport
├── touch/          # API layer
│   ├── router/     # HTTP routing
│   └── middleware/ # Request middleware
└── vendors/        # Third-party integrations
```

#### 3.2 App (Business Logic)
```
apps/station/app/
├── actuator/       # Health checks, metrics
└── subserver/      # Modular services
    ├── ai_box/     # AI service management
    ├── auth/       # User authentication
    └── posting/    # Content management
```

---

## 🔄 Data Flow Patterns

### Pattern 1: Client → Station (HTTP/gRPC)

**Example: User Login**

```
1. User enters credentials in Desktop app
   ↓
2. LoginController calls AuthRepository
   ↓
3. AuthRepository uses HttpService (from peers_touch_base)
   ↓
4. HTTP POST to Station: /api/auth/login
   ↓
5. Station's auth subserver validates credentials
   ↓
6. Station returns JWT token (Proto-defined AuthResponse)
   ↓
7. Client stores token in SecureStorage
   ↓
8. UI updates to show logged-in state
```

### Pattern 2: Desktop Client ↔ Client (P2P via libp2p)

**Example: Direct Message (Desktop)**

```
1. User A sends message to User B
   ↓
2. MessageController creates Message (Proto model)
   ↓
3. libp2p layer discovers User B's peer
   ↓
4. Direct P2P connection established
   ↓
5. Message sent over encrypted P2P channel
   ↓
6. User B receives message, updates UI
```

### Pattern 2b: Mobile Client ↔ Client (Station Relay)

**Example: Direct Message (Mobile)**

```
1. User A (mobile) sends message to User B
   ↓
2. Message created as Proto model
   ↓
3. Message sent to Station via HTTP/gRPC
   ↓
4. Station relay service forwards to User B's station
   ↓
5. User B's client receives message via push / long-poll / WebSocket
   ↓
6. User B's UI updates
```

### Pattern 3: Station ↔ Station (Federation via ActivityPub)

**Example: Follow Request**

```
1. User A (@alice@station1.com) follows User B (@bob@station2.com)
   ↓
2. Station 1 creates ActivityPub Follow activity
   ↓
3. Station 1 sends HTTP POST to Station 2's inbox
   ↓
4. Station 2 validates signature, stores follow
   ↓
5. Station 2 sends Accept activity back to Station 1
   ↓
6. Both stations update their databases
   ↓
7. Clients receive updates via WebSocket/polling
```

---

## 🔐 Security Architecture

### Client-Side Security
- **Secure Storage**: Encrypted storage for tokens/keys
- **Certificate Pinning**: Prevent MITM attacks
- **Input Validation**: Sanitize all user inputs

### Station-Side Security
- **JWT Authentication**: Stateless token-based auth
- **Rate Limiting**: Prevent abuse
- **CORS**: Restrict cross-origin requests
- **SQL Injection Prevention**: Parameterized queries

### P2P Security (Desktop only)
- **End-to-End Encryption**: All P2P messages encrypted
- **Peer Authentication**: Verify peer identities
- **NAT Traversal**: Secure hole-punching

### Mobile Relay Security
- **TLS**: All Mobile ↔ Station communication over TLS
- **Station Relay Authentication**: Relay messages authenticated via JWT
- **No direct peer exposure**: Mobile clients never expose network endpoints

---

## 📡 Network Topology

```
┌─────────────────────────────────────────────────────────┐
│                   Federation Network                     │
│                                                           │
│  ┌─────────┐         ┌─────────┐         ┌─────────┐  │
│  │Station 1│◄───────►│Station 2│◄───────►│Station 3│  │
│  └────┬────┘         └────┬────┘         └────┬────┘  │
│       │                   │                   │         │
│       │  ActivityPub      │                   │         │
│       │  Federation       │                   │         │
└───────┼───────────────────┼───────────────────┼─────────┘
        │                   │                   │
        │                   │                   │
   ┌────▼────┐         ┌────▼────┐         ┌────▼────┐
   │ Desktop │◄───────►│ Desktop │◄───────►│ Desktop │
   │ (Alice) │  P2P    │  (Bob)  │  P2P    │(Charlie)│
   └─────────┘  libp2p └─────────┘  libp2p └─────────┘
        ▲                   ▲                   ▲
        │ Station            │ Station            │ Station
        │ Relay              │ Relay              │ Relay
   ┌────┴────┐         ┌────┴────┐         ┌────┴────┐
   │ Mobile  │         │ Mobile  │         │ Mobile  │
   │ (Alice) │         │  (Bob)  │         │(Charlie)│
   └─────────┘         └─────────┘         └─────────┘
```

---

## 🎯 Design Principles

### 1. **Separation of Concerns**
- **View**: UI only, no logic
- **Controller**: Business logic + state
- **Model**: Data structure only
- **Service**: External communication

### 2. **Dependency Injection**
- Desktop: Services registered via Rust command bridge
- Android: Hilt / manual DI
- iOS: Swift native DI patterns
- No hardcoded instantiation
- Easy to mock for testing

### 3. **Proto-First**
- Models defined once in .proto
- Generated for all platforms
- Type-safe across tiers

### 4. **Station–Client API: Proto Only**
- **Default**: All Station ↔ Client APIs use **Proto** (application/protobuf). No JSON.
- **Exception**: JSON only when strictly unavoidable; must be documented and planned for migration to Proto.

### 5. **Modular Design**
- Features are self-contained
- Subservers are independent
- Easy to add/remove modules

### 6. **Mobile: Station Relay, No P2P**
- Mobile 端不内置 libp2p，不参与 P2P mesh
- 所有实时消息通过 Station Relay 中转，降低移动端复杂度与功耗
- Desktop 端保留 P2P + Relay 混合策略

### 7. **Applet Container: Lynx**
- Mobile 端使用 [Lynx](https://github.com/lynx-family/lynx) 作为 Applet/小程序容器
- Android 通过原生 LynxView 承载，iOS 同理
- Applet 运行在 Lynx 沙箱中，通过 Bridge 与宿主 App 通信

---

## 🚀 Deployment Architecture

### Development
```
Developer Machine
├── Desktop App — Tauri dev (port 3000)
├── Android App — Android Studio / Emulator
├── iOS App — Xcode / Simulator
└── Station Backend (port 8080)
```

### Production
```
User's Home Network
├── Station (Docker container on NAS/Raspberry Pi)
│   ├── PostgreSQL (data)
│   ├── Frame + Subservers
│   └── Relay service (for mobile clients)
└── Clients
    ├── Desktop app — P2P + Station API
    └── Mobile app (Android / iOS) — Station Relay + Station API
```

### Federated Network
```
Internet
├── Station A (alice.peers.com)
├── Station B (bob.peers.org)
└── Station C (charlie.peers.net)
    └── All federate via ActivityPub
```

---

## 📚 Related Documents

- **Project Identity**: [10-project-identity.md](./10-project-identity.md)
- **Domain Models**: [12-domain-model.md](./12-domain-model.md)
- **Desktop Architecture**: [desktop/base.md](../client/desktop/base.md)
- **Station Architecture**: [station/base.md](../station/base.md)

---

*This document provides the 30,000-foot view. For implementation details, see platform-specific prompts.*
