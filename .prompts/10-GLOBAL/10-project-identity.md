# Project Identity: What is Peers-Touch?

> **The Foundation Document**  
> Read this first to understand the essence of Peers-Touch.

---

## 🎯 Project Vision

**Peers-Touch** is a **decentralized, federated social network framework** that empowers users to own their data and connect across independent server instances (stations).

### Core Mission
To build a peer-to-peer social ecosystem where:
- **Users own their identity** - Portable across stations via ActivityPub
- **Data stays private** - End-to-end encryption for sensitive content
- **Communities are sovereign** - Each station controls its own rules
- **Connections are direct** - P2P mesh networking for real-time communication

---

## 🏗️ Project Scope

### What We Are Building

#### 1. **Three-Tier Architecture**
```
┌─────────────────────────────────────┐
│  Client Layer (Mobile + Desktop)    │  ← User-facing applications
├─────────────────────────────────────┤
│  Model Layer (Proto Definitions)    │  ← Single source of truth
├─────────────────────────────────────┤
│  Station Layer (Backend Services)   │  ← Federation + Storage
└─────────────────────────────────────┘
```

#### 2. **Client Applications**
- **Desktop** (Flutter + GetX): Professional workspace for power users
- **Mobile** (Flutter + GetX): On-the-go social experience
- **Shared UI Library** (`peers_touch_ui`): Consistent design system

#### 3. **Station Backend**
- **Frame**: Core framework (routing, auth, storage)
- **Subservers**: Modular services (ai_box, posting, activitypub)
- **Federation**: ActivityPub protocol implementation

#### 4. **Core Features**
- User registration and authentication
- Federated identity (`@handle@domain.com`)
- Real-time messaging (P2P + server-mediated)
- Private circles (encrypted group chats)
- Public posting (federated timeline)
- AI-powered chat assistant
- Extensible applet system

---

## 🌟 Key Differentiators

### 1. **Proto-First Architecture**
All data models are defined once in `.proto` files and generated for all three tiers.

**Why?** Ensures type safety and consistency across Mobile, Desktop, and Station.

### 2. **Hybrid Networking**
- **P2P (libp2p)**: Direct client-to-client for low-latency
- **Federation (ActivityPub)**: Server-to-server for reach
- **Mesh Discovery**: Local network auto-discovery

**Why?** Best of both worlds - privacy + interoperability.

### 3. **Privacy-First Design**
- End-to-end encryption for private circles
- Granular visibility controls (public/followers/private)
- Local-first data storage with optional sync

**Why?** Users should control who sees their data.

### 4. **Extensible Architecture**
- Modular subservers on backend
- Feature modules on client
- Plugin system for applets

**Why?** Easy to add new features without breaking existing code.

---

## 📐 Project Scale

**Target Audience**: Families, small communities, interest groups

**Network Topology**: Federated (like Mastodon) + P2P (like BitTorrent)

**Deployment Model**:
- Self-hosted stations (home servers, VPS)
- Managed hosting (future)
- Hybrid (some users on self-hosted, some on managed)

---

## 🎨 Design Philosophy

### 1. **LobeChat-Inspired UI**
Clean, modern, professional aesthetic with:
- Minimalist color palette
- Smooth animations
- Intuitive navigation
- Responsive layouts

### 2. **Code Simplicity**
- Clear separation of concerns (View/Controller/Model)
- No magic - explicit dependencies
- Self-documenting code structure

### 3. **Developer Experience**
- Consistent patterns across platforms
- Comprehensive prompts for AI assistance
- Easy onboarding for new contributors

---

## 🚫 What Peers-Touch Is NOT

- ❌ **Not a centralized platform** - No single company controls the network
- ❌ **Not a blockchain project** - We use proven protocols (ActivityPub, libp2p)
- ❌ **Not a Mastodon clone** - We add P2P, circles, and AI features
- ❌ **Not enterprise software** - Focused on personal and community use

---

## 🛠️ Technology Stack

### Client (Mobile + Desktop)
- **Framework**: Flutter (latest stable)
- **State Management**: GetX (mandatory)
- **UI Library**: peers_touch_ui (custom)
- **Networking**: Dio (HTTP), libp2p (P2P)
- **Storage**: GetStorage (local), SecureStorage (encrypted)

### Station (Backend)
- **Language**: Go
- **Framework**: Custom frame (based on micro patterns)
- **Protocols**: ActivityPub, libp2p, gRPC
- **Storage**: PostgreSQL (relational), BadgerDB (local)

### Model (Shared)
- **Format**: Protocol Buffers (.proto)
- **Generation**: protoc for Dart, Go, and other targets

---

## 📊 Project Structure

```
peers-touch/
├── client/                 # Client applications
│   ├── desktop/            # Desktop app (Flutter)
│   ├── mobile/             # Mobile app (Flutter)
│   └── common/             # Shared libraries
│       ├── peers_touch_base/   # Core utilities
│       └── peers_touch_ui/     # UI components
│
├── station/                # Backend services
│   ├── frame/              # Core framework
│   └── app/                # Application services
│       └── subserver/      # Modular services
│
├── model/                  # Proto definitions
│   └── domain/             # Domain models (.proto files)
│
└── .prompts/               # This documentation system
```

---

## 🎓 Learning Path

### For New Developers

**Step 1**: Read this document (you're here!)

**Step 2**: Read [11-architecture.md](./11-architecture.md) to understand how the pieces fit together

**Step 3**: Read [12-domain-model.md](./12-domain-model.md) to learn the Proto system

**Step 4**: Choose your platform:
- Desktop → [21-DESKTOP/21.0-base.md](../20-CLIENT/21-DESKTOP/21.0-base.md)
- Mobile → [22-MOBILE/22.0-base.md](../20-CLIENT/22-MOBILE/22.0-base.md)
- Station → [30-STATION/30-station-base.md](../30-STATION/30-station-base.md)

**Step 5**: Read coding standards [13-coding-standards.md](./13-coding-standards.md)

---

## 🤝 Contributing Philosophy

### We Value:
- **Clarity over cleverness** - Simple code beats clever code
- **Consistency over convenience** - Follow patterns even if verbose
- **Documentation over assumptions** - Write prompts for AI and humans

### We Require:
- All models from Proto files (no manual models)
- StatelessWidget only (no StatefulWidget)
- Package imports only (no relative imports)
- GetX for all state management

---

## 📞 Getting Help

- **Architecture questions**: Read [11-architecture.md](./11-architecture.md)
- **Terminology confusion**: See [GLOSSARY.md](../00-META/GLOSSARY.md)
- **Design decisions**: Check [90-CONTEXT/decisions/](../90-CONTEXT/decisions/)
- **Platform-specific**: See platform base files (21.0, 22.0, 30.0)

---

## 🔮 Future Vision

### Short-term (v1.0)
- ✅ Basic federation (ActivityPub)
- ✅ Private circles (E2E encrypted)
- ✅ AI chat assistant
- ✅ Mobile + Desktop apps

### Mid-term (v2.0)
- 🔄 Video/voice calls (P2P)
- 🔄 Advanced applet system
- 🔄 Decentralized storage (IPFS)
- 🔄 Mobile notifications

### Long-term (v3.0+)
- 🔮 Decentralized identity (DID)
- 🔮 Token-based incentives
- 🔮 Cross-protocol bridges
- 🔮 Web client

---

## 📜 Project History

**Genesis**: 2024 - Started as a family communication tool

**Evolution**: Expanded to support federated communities

**Current**: Building v1.0 with full federation + P2P

See [CHANGELOG.md](../00-META/CHANGELOG.md) for detailed history.

---

## ⚖️ License & Governance

**License**: TBD (likely AGPL or similar copyleft)

**Governance**: Community-driven with core maintainers

**Code of Conduct**: Respect, inclusivity, constructive feedback

---

*This document defines the "what" and "why" of Peers-Touch. For "how", see the architecture and platform-specific prompts.*
