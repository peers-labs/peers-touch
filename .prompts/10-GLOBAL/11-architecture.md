# Architecture: Three-Tier System

> **Understanding How Peers-Touch Components Work Together**

---

## 🏛️ High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT LAYER                              │
│  ┌──────────────────────┐    ┌──────────────────────┐      │
│  │   Desktop (Flutter)  │    │   Mobile (Flutter)   │      │
│  │   - GetX State Mgmt  │    │   - GetX State Mgmt  │      │
│  │   - peers_touch_ui   │    │   - peers_touch_ui   │      │
│  │   - libp2p P2P       │    │   - libp2p P2P       │      │
│  └──────────────────────┘    └──────────────────────┘      │
│             │                           │                    │
│             └───────────┬───────────────┘                    │
└─────────────────────────┼──────────────────────────────────┘
                          │
                    HTTP/gRPC + P2P
                          │
┌─────────────────────────┼──────────────────────────────────┐
│                    MODEL LAYER                               │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Protocol Buffers (.proto files)                     │   │
│  │  - Single source of truth for all data models        │   │
│  │  - Generated for Dart (client) and Go (station)      │   │
│  │  - Located in: model/domain/                         │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │
                      Generated Models
                            │
┌───────────────────────────┼─────────────────────────────────┐
│                    STATION LAYER                             │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Frame (Core Framework)                              │   │
│  │  - Routing, Auth, Config, Logging                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Subservers (Modular Services)                       │   │
│  │  - ai_box: AI service management                     │   │
│  │  - posting: Content creation/federation              │   │
│  │  - auth: User authentication                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Federation Layer                                     │   │
│  │  - ActivityPub protocol                              │   │
│  │  - Inter-station communication                       │   │
│  └─────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

---

## 📦 Component Breakdown

### 1. Client Layer (Mobile + Desktop)

**Shared Architecture**:
- Both use Flutter + GetX
- Both use `peers_touch_base` (core utilities)
- Both use `peers_touch_ui` (UI components)
- Both consume Proto-generated models

**Key Differences**:
- Desktop: Multi-window, keyboard-first, larger screens
- Mobile: Single-window, touch-first, smaller screens

**Directory Structure**:
```
client/
├── desktop/
│   ├── lib/
│   │   ├── app/          # App config (routes, theme, i18n)
│   │   ├── core/         # Global utilities
│   │   └── features/     # Business modules
│   └── ...
├── mobile/
│   └── (same structure as desktop)
└── common/
    ├── peers_touch_base/  # Core utilities (network, storage, etc.)
    └── peers_touch_ui/    # Shared UI components
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
}
```

**Generation**:
- For Dart (client): `protoc --dart_out=...`
- For Go (station): `protoc --go_out=...`

**Generated Files Location**:
- Dart: `client/common/peers_touch_base/lib/model/domain/`
- Go: `station/app/subserver/*/model/`

---

### 3. Station Layer (Backend)

**Location**: `station/`

**Components**:

#### 3.1 Frame (Core Framework)
```
station/frame/
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
station/app/
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

### Pattern 2: Client ↔ Client (P2P via libp2p)

**Example: Direct Message**

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

### P2P Security
- **End-to-End Encryption**: All P2P messages encrypted
- **Peer Authentication**: Verify peer identities
- **NAT Traversal**: Secure hole-punching

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
   │ Client  │◄───────►│ Client  │◄───────►│ Client  │
   │ (Alice) │  P2P    │  (Bob)  │  P2P    │(Charlie)│
   └─────────┘  libp2p └─────────┘  libp2p └─────────┘
```

---

## 🎯 Design Principles

### 1. **Separation of Concerns**
- **View**: UI only, no logic
- **Controller**: Business logic + state
- **Model**: Data structure only
- **Service**: External communication

### 2. **Dependency Injection**
- All services registered via GetX
- No hardcoded instantiation
- Easy to mock for testing

### 3. **Proto-First**
- Models defined once in .proto
- Generated for all platforms
- Type-safe across tiers

### 4. **Station–Desktop API: Proto Only**
- **Default**: All Station ↔ Desktop APIs use **Proto** (application/protobuf). No JSON.
- **Exception**: JSON only when strictly unavoidable; must be documented and planned for migration to Proto.

### 5. **Modular Design**
- Features are self-contained
- Subservers are independent
- Easy to add/remove modules

---

## 🚀 Deployment Architecture

### Development
```
Developer Machine
├── Flutter Desktop App (port 3000)
├── Flutter Mobile App (emulator)
└── Station Backend (port 8080)
```

### Production
```
User's Home Network
├── Station (Docker container on NAS/Raspberry Pi)
│   ├── PostgreSQL (data)
│   └── Frame + Subservers
└── Clients (Desktop/Mobile apps)
    └── Connect to local station or remote station
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
- **Desktop Architecture**: [21-DESKTOP/21.0-base.md](../20-CLIENT/21-DESKTOP/21.0-base.md)
- **Station Architecture**: [30-STATION/30-station-base.md](../30-STATION/30-station-base.md)

---

*This document provides the 30,000-foot view. For implementation details, see platform-specific prompts.*
