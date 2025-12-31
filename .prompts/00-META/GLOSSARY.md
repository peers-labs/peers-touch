# Peers-Touch Terminology Glossary

> **Quick Reference for Key Terms**  
> This document defines the core terminology used throughout the Peers-Touch project.

---

## Core Concepts

### Actor
A federated identity in the Peers-Touch network. Every user, group, or bot is represented as an Actor with a unique ActorID.

**Related Terms**: ActorID, ActorBase, Federation

### ActorID
The globally unique identifier for an Actor in the federated network. Format: `@handle@domain.com`

**Example**: `@alice@peers.example.com`

### Federation
The ability for different Peers-Touch instances (stations) to communicate and share data with each other, forming a decentralized network.

**Related Terms**: ActivityPub, Station

### Station
A backend server instance that hosts Peers-Touch services. Users connect to a station, and stations federate with each other.

**Directory**: `station/`

---

## Architecture Terms

### Proto / Protobuf
Protocol Buffers - the single source of truth for all data models across Mobile, Desktop, and Station.

**Location**: `model/domain/*.proto`

**Key Rule**: All models MUST be generated from Proto files. Manual model creation is forbidden.

### Three-Tier Architecture
The project structure: **Client** (Mobile/Desktop) ↔ **Model** (Proto) ↔ **Station** (Backend)

### GetX
The state management, dependency injection, and routing framework used in Flutter clients.

**Key Rule**: All state MUST be managed by GetX Controllers. StatefulWidget is forbidden.

---

## Client-Side Terms

### StatelessWidget
The only allowed widget type in Peers-Touch Flutter apps. All state is managed externally by Controllers.

**Forbidden**: StatefulWidget

### Controller
A GetX controller that manages business logic and state for a specific feature or page.

**Example**: `HomeController`, `AIChatController`

### Binding
A GetX mechanism for lazy-loading and auto-disposing Controllers.

**Example**: `HomeBinding`, `AIChatBinding`

### Scaffolding
The directory structure and organization pattern for code.

**Reference**: `21-DESKTOP/21.1-scaffolding.md`

### Feature Module
A self-contained business module with its own view/, controller/, model/, and binding.

**Example**: `features/ai_chat/`, `features/profile/`

---

## UI Terms

### LobeChat Style
The design philosophy and visual style that Peers-Touch UI follows, emphasizing clean, modern, and professional interfaces.

### peers_touch_ui
The shared UI component library used by both Mobile and Desktop clients.

**Location**: `client/common/peers_touch_ui/`

### Lobe Tokens
Design tokens (colors, spacing, typography) that define the visual system.

---

## Backend Terms

### Frame
The core framework layer of the Station backend.

**Location**: `station/frame/`

### Subserver
A modular backend service within the Station (e.g., ai_box, auth).

**Location**: `station/app/subserver/`

### ActivityPub
The W3C standard protocol for federated social networking that Peers-Touch implements.

### Posting
The system for creating, storing, and federating user-generated content (posts, messages).

---

## Network Terms

### libp2p
The peer-to-peer networking library used for direct client-to-client communication.

### Mesh Network
The peer-to-peer network topology where clients can directly connect to each other.

### Network Discovery
The process of finding nearby peers in the local network or federated network.

---

## Development Terms

### ADR (Architecture Decision Record)
A document that captures an important architectural decision, its context, and rationale.

**Location**: `90-CONTEXT/decisions/`

### FEATURE_PROMPT
A prompt document that defines the design blueprint for a specific feature module.

**Example**: `21-DESKTOP/features/ai-chat.md`

### TASK_PROMPT
A structured template for defining a specific development task.

**Template**: `21-DESKTOP/21.9-task-template.md`

---

## Domain-Specific Terms

### AI-Chat
The AI conversation feature that provides OpenAI-compatible chat interfaces.

### Provider
An AI service provider configuration (e.g., OpenAI, local LLM).

### Session
A chat conversation session with an AI assistant.

### Composer
The multi-modal input component for creating messages (text, images, files, voice).

### Circle
A private group or community within Peers-Touch (similar to Discord servers or Telegram groups).

---

## Storage Terms

### LocalStorage
GetStorage-based local key-value storage for non-sensitive data.

### SecureStorage
Encrypted storage for sensitive data like tokens and credentials.

---

## Common Abbreviations

| Abbreviation | Full Term | Meaning |
|--------------|-----------|---------|
| **ADR** | Architecture Decision Record | Design decision documentation |
| **AP** | ActivityPub | Federation protocol |
| **DI** | Dependency Injection | GetX's service locator pattern |
| **DTO** | Data Transfer Object | Data structure for API communication |
| **MVP** | Minimum Viable Product | Initial feature implementation |
| **P2P** | Peer-to-Peer | Direct client-to-client communication |
| **Proto** | Protocol Buffers | Data model definition format |
| **Rx** | Reactive Extensions | GetX's reactive state variables |
| **UI** | User Interface | Visual components |
| **UX** | User Experience | Interaction design |

---

## Anti-Patterns (Things to Avoid)

### ❌ StatefulWidget
Never use StatefulWidget. Use GetX Controllers instead.

### ❌ Relative Imports
Never use relative imports like `import '../models/user.dart'`. Always use package imports.

### ❌ Manual Models
Never manually create model classes. Always generate from Proto files.

### ❌ Hardcoded Strings
Never hardcode UI strings. Use the i18n system (LocaleKeys).

### ❌ Direct Dio Usage
Never instantiate Dio directly. Use HttpService from peers_touch_base.

---

## Related Documents

- **Project Identity**: `10-GLOBAL/10-project-identity.md`
- **Architecture**: `10-GLOBAL/11-architecture.md`
- **Domain Models**: `10-GLOBAL/12-domain-model.md`

---

*This glossary is a living document. Add new terms as the project evolves.*
