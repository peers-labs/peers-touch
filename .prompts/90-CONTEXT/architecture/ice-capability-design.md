# ICE Capability Architecture Design

> **Status**: Draft  
> **Version**: 2.0 (Simplified - No ActivityPub)  
> **Date**: 2026-01-20  
> **Author**: Architecture Team

---

## 📋 Executive Summary

This document defines the **ICE (Interactive Connectivity Establishment) capability** as a **core infrastructure service** in the Peers-Touch network. Every Station will provide native STUN/TURN services for its own clients.

### Key Principles

1. **Self-Sovereign Infrastructure**: Each Station is a complete ICE node
2. **Privacy-First**: No dependency on third-party STUN/TURN providers
3. **Simple Configuration**: Clients use own Station's ICE services with public fallback
4. **Federation Ready**: Stations can use ICE to connect with each other (for home/NAT deployments)

---

## 🎯 Vision: Self-Hosted ICE Infrastructure

### Current State (Centralized)

```
Client A ──→ Google STUN ←── Client B
Client C ──→ Public TURN ←── Client D

Problems:
❌ Dependency on third parties
❌ Privacy concerns (IP exposure)
❌ Single point of failure
❌ No control over service quality
```

### Target State (Self-Hosted)

```
┌─────────────────────────────────────────────────────────┐
│           Peers-Touch ICE Architecture                  │
│                                                         │
│   Station A         Station B         Station C        │
│   (Alice's)         (Bob's)           (Carol's)        │
│      ↑                 ↑                 ↑             │
│      │                 │                 │             │
│   Client 1         Client 2         Client 3           │
│                                                         │
│   Each Station provides:                               │
│   • STUN service (NAT discovery)                       │
│   • TURN service (relay when needed)                   │
│   • ICE candidate management                           │
│   • HTTP API for ICE server info                       │
└─────────────────────────────────────────────────────────┘

Benefits:
✅ No third-party dependency
✅ Privacy-preserving
✅ Full control over infrastructure
✅ Public STUN as fallback
```

---

## 🏗️ Architecture Overview

### System Layers

```
┌─────────────────────────────────────────────────────────┐
│                Application Layer                        │
│  (Chat, Voice/Video, File Transfer, Federation, etc.)   │
└─────────────────────────────────────────────────────────┘
                         ↓ uses
┌─────────────────────────────────────────────────────────┐
│              ICE Capability Layer (NEW)                 │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ ICE Manager  │  │  ICE Config  │  │  Candidate   │ │
│  │              │  │   Service    │  │   Selector   │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────┘
                         ↓ uses
┌─────────────────────────────────────────────────────────┐
│            Transport Services Layer                     │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ STUN Server  │  │ TURN Server  │  │   libp2p     │ │
│  │   (NEW)      │  │  (Existing)  │  │  (Existing)  │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────┘
                         ↓ runs on
┌─────────────────────────────────────────────────────────┐
│                  Station Infrastructure                 │
│         (Subserver Framework, HTTP/WS, Database)        │
└─────────────────────────────────────────────────────────┘
```

---

## 📐 Component Design

### Architecture Layers

```
station/
├── frame/core/                     # 核心框架层
│   ├── server/                     # 服务器接口定义
│   ├── ice/                        # ICE 组网能力 ⭐
│   │   ├── manager.go              # ICE Manager
│   │   ├── config.go               # Config Service
│   │   ├── selector.go             # Candidate Selector
│   │   ├── handler.go              # HTTP Handlers
│   │   └── interface.go            # 接口定义
│   └── plugin/native/subserver/    # 网络服务层
│       ├── stun/                   # STUN 服务实现
│       ├── turn/                   # TURN 服务实现
│       └── bootstrap/              # libp2p 服务实现
│
└── app/                            # 应用层(组装启动)
    └── main.go                     # 依赖注入组装
```

**Dependency Principle**: 
- `core/ice/` **不直接依赖** `core/plugin/native/subserver/` 的具体实现
- `core/ice/` 只依赖 `core/server.SubServer` 接口
- `app/` 层导入具体实现并通过依赖注入组装
- 完全的依赖倒置: 高层模块不依赖低层模块,都依赖抽象

**Dependency Graph** (Auto-Discovery Pattern):
```
┌─────────────────────────────────────────────────────────────┐
│                        app/main.go                          │
│                 (Clean, Minimal Configuration)              │
│                                                             │
│  p.Init(                                                    │
│    server.WithICE(ice.WithPublicSTUNFallback(true))        │
│  )                                                          │
└─────────────────────────────────────────────────────────────┘
         │ imports (blank)        │ imports           │ imports
         ↓                        ↓                   ↓
┌──────────────────┐    ┌──────────────────┐   ┌──────────────────┐
│  core/ice/       │    │  subserver/stun/ │   │  subserver/turn/ │
│  (ICE Manager)   │    │  (STUN Server)   │   │  (TURN Server)   │
│                  │    │  init() 注册     │   │  init() 注册     │
└──────────────────┘    └──────────────────┘   └──────────────────┘
         │                       │                   │
         │                       ↓ implements        ↓ implements
         │              ┌─────────────────────────────────────┐
         │              │  core/server.SubServer (Interface)  │
         │              └─────────────────────────────────────┘
         │                       ↑                   ↑
         │                       │                   │
         └─── Auto-Discovery ────┴───────────────────┘
              (via Type() == "network.stun|turn")

Workflow:
1. main.go: blank import STUN/TURN → init() 自动注册到 Server
2. main.go: server.WithICE(...) → 创建 ICE Manager
3. ICE Manager.Init(): 从 Server 查找 Type()=="network.stun|turn"
4. ICE Manager 自动获取 STUN/TURN 引用,无需手动注入

Key:
→ Direct import
⇢ Auto-discovery at runtime
```

---

### 1. ICE Manager (Coordination Layer)

**Location**: `station/frame/core/ice/manager.go`

**Responsibility**: Coordinate ICE candidate gathering and connection establishment

```go
// station/frame/core/ice/manager.go

package ice

import (
    "context"
    "github.com/peers-labs/peers-touch/station/frame/core/server"
)

type Manager struct {
    // 通过接口引用,不直接依赖具体实现
    stunService STUNService
    turnService TURNService
    
    configService     *ConfigService
    candidateSelector *CandidateSelector
    candidateCache    map[string][]*Candidate
    metrics           *ICEMetrics
}

// NewManager 创建 ICE Manager (自动发现 STUN/TURN)
func NewManager(opts ...option.Option) *Manager {
    m := &Manager{
        configService:     NewConfigService(),
        candidateSelector: NewCandidateSelector(),
        candidateCache:    make(map[string][]*Candidate),
    }
    
    // 应用配置选项
    for _, opt := range opts {
        opt.Apply(m)
    }
    
    return m
}

// Init 初始化时自动发现 STUN/TURN SubServers
func (m *Manager) Init(ctx context.Context, opts ...option.Option) error {
    // 从 Node 获取 Server
    srv := node.GetService().Server()
    
    // 自动发现 STUN SubServer
    if stunSub := m.findSubServerByType(srv, "network.stun"); stunSub != nil {
        m.stunService = stunSub
    }
    
    // 自动发现 TURN SubServer
    if turnSub := m.findSubServerByType(srv, "network.turn"); turnSub != nil {
        m.turnService = turnSub
    }
    
    return nil
}

// findSubServerByType 通过类型查找 SubServer
func (m *Manager) findSubServerByType(srv server.Server, typ string) server.SubServer {
    opts := srv.Options()
    for _, sub := range opts.SubServers {
        if sub.Type() == typ {
            return sub
        }
    }
    return nil
}

// Core Methods
func (m *Manager) GatherCandidates(ctx context.Context, opts *GatherOptions) ([]*Candidate, error)
func (m *Manager) GetICEServers(ctx context.Context, userDID string) ([]ICEServer, error)
func (m *Manager) SelectBestCandidate(candidates []*Candidate) *Candidate
func (m *Manager) MonitorConnectionQuality(conn *Connection) *QualityMetrics

// 使用简化后的接口获取服务信息
func (m *Manager) GetSTUNServerInfo() *server.ServiceInfo {
    return m.stunService.Info()  // 包含 PublicAddr
}

func (m *Manager) GetTURNServerInfo() *server.ServiceInfo {
    return m.turnService.Info()  // 包含 PublicAddr
}
```

**Functional Options**:
```go
// station/frame/core/ice/options.go
package ice

import "github.com/peers-labs/peers-touch/station/frame/core/option"

// WithPublicSTUNFallback 启用公共 STUN 服务器作为后备
func WithPublicSTUNFallback(enabled bool) option.Option {
    return option.WrapFunc(func(v interface{}) {
        if m, ok := v.(*Manager); ok {
            m.enablePublicFallback = enabled
        }
    })
}

// WithCandidateCacheTTL 设置候选地址缓存时间
func WithCandidateCacheTTL(ttl time.Duration) option.Option {
    return option.WrapFunc(func(v interface{}) {
        if m, ok := v.(*Manager); ok {
            m.candidateCacheTTL = ttl
        }
    })
}
```

**Interface Definition**:
```go
// station/frame/core/ice/interface.go
package ice

import "github.com/peers-labs/peers-touch/station/frame/core/server"

// STUNService 定义 STUN 服务接口
type STUNService interface {
    server.SubServer
}

// TURNService 定义 TURN 服务接口
type TURNService interface {
    server.SubServer
    GenerateCredentials(username string) (string, error)
}
```

**Key Features**:
- Automatic candidate gathering
- Intelligent candidate selection
- Connection quality monitoring
- Fallback strategy management

**Interface Design**:

SubServer 接口通过 `Info()` 方法统一返回服务信息,包含监听地址、公网地址、协议等完整信息。

`Type()` 方法返回分层类型标识 (如 `"network.stun"`, `"network.turn"`),便于按类型过滤和管理 Subserver。

**ServiceInfo 结构**:
```go
type ServiceInfo struct {
    Name       string            // "stun"
    Type       string            // "network.stun"
    Status     string            // "running"
    Address    string            // "0.0.0.0:3478" (监听地址)
    PublicAddr string            // "123.45.67.89:3478" (公网地址)
    Protocol   string            // "udp"
    Metadata   map[string]string // 扩展信息
}
```

---

### 2. STUN Server (NAT Discovery Subserver)

**Location**: `station/frame/core/plugin/native/subserver/stun/`

**Responsibility**: Provide STUN service for NAT traversal (RFC 5389)

```go
// station/frame/core/plugin/native/subserver/stun/stun.go

package stun

import (
    "context"
    "net"
    
    "github.com/peers-labs/peers-touch/station/frame/core/server"
    "github.com/pion/stun"
)

// SubServer implements STUN service
type SubServer struct {
    opts *Options
    
    status      server.Status
    conn        net.PacketConn  // UDP listener
    handler     *STUNHandler
    rateLimiter *RateLimiter
    
    publicIP string
    address  string
}

// Implement server.SubServer interface
func (s *SubServer) Init(ctx context.Context, opts ...option.Option) error
func (s *SubServer) Start(ctx context.Context, opts ...option.Option) error
func (s *SubServer) Stop(ctx context.Context) error
func (s *SubServer) Status() server.Status { return s.status }

func (s *SubServer) Name() string { return "stun" }
func (s *SubServer) Type() string { return "network.stun" }  // 分层类型标识

// Info 统一返回服务信息(包含公网地址)
func (s *SubServer) Info() *server.ServiceInfo {
    return &server.ServiceInfo{
        Name:       s.Name(),
        Type:       s.Type(),
        Status:     s.Status().String(),
        Address:    s.address,        // 监听地址: "0.0.0.0:3478"
        PublicAddr: s.publicIP,       // 公网地址: "123.45.67.89:3478"
        Protocol:   "udp",
        Metadata: map[string]string{
            "version": "RFC5389",
        },
    }
}

// STUN Protocol Implementation
func (s *SubServer) HandleBindingRequest(req *stun.Message) (*stun.Message, error)
func (s *SubServer) GetReflexiveAddress(srcAddr net.Addr) (*net.UDPAddr, error)
```

**Features**:
- RFC 5389 compliant
- Rate limiting (prevent abuse)
- IPv4/IPv6 dual stack
- Metrics collection

---

### 3. TURN Server (Relay Service)

**Responsibility**: Provide relay service when direct connection fails

**Status**: Already implemented in `station/frame/core/plugin/native/subserver/turn/`

**Enhancements Needed**:
```go
// Add ICE integration
func (t *TURNServer) GetRelayCandidate(username string) (*Candidate, error)
func (t *TURNServer) AllocateRelay(ctx context.Context, opts *AllocateOptions) (*Allocation, error)
```

---

### 4. ICE Config Service (Configuration Provider)

**Location**: `station/frame/core/ice/config.go`

**Responsibility**: Provide ICE server configuration to clients

```go
// station/frame/core/ice/config.go

package ice

type ConfigService struct {
    publicSTUNServers []string
}

func NewConfigService() *ConfigService {
    return &ConfigService{
        publicSTUNServers: []string{
            "stun:stun.xten.com:3478",
            "stun:stun.l.google.com:19302",
        },
    }
}

// Configuration Methods
func (cs *ConfigService) GetPublicSTUNServers() []ICEServer
func (cs *ConfigService) GenerateTURNCredentials(userDID string, secret string) (*TURNCredentials, error)
```

**HTTP Handlers**:
```go
// station/frame/core/ice/handler.go

package ice

func (m *Manager) Handlers() []server.Handler {
    return []server.Handler{
        {
            Path:    "/api/v1/ice/servers",
            Method:  "GET",
            Handler: m.handleGetICEServers,
        },
    }
}

func (m *Manager) handleGetICEServers(w http.ResponseWriter, r *http.Request) {
    userDID := r.URL.Query().Get("user_did")
    
    servers, err := m.GetICEServers(r.Context(), userDID)
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    
    respondJSON(w, map[string]interface{}{
        "ice_servers": servers,
    })
}
```

**API Response**:
```json
{
  "ice_servers": [
    {
      "urls": ["stun:station.example.com:3478"]
    },
    {
      "urls": ["turn:station.example.com:3478"],
      "username": "1705708800:did:peers:alice",
      "credential": "hmac_generated_credential"
    }
  ]
}
```

---

### 5. Candidate Selector (Intelligent Routing)

**Location**: `station/frame/core/ice/selector.go`

**Responsibility**: Select optimal ICE candidates based on network conditions

```go
// station/frame/core/ice/selector.go
package ice

type CandidateSelector struct {
    priorityRules []PriorityRule
    metrics       *NetworkMetrics
}

func NewCandidateSelector() *CandidateSelector {
    return &CandidateSelector{
        priorityRules: DefaultPriorityRules,
        metrics:       NewNetworkMetrics(),
    }
}

// Selection Algorithm
func (s *CandidateSelector) SelectBestCandidates(candidates []*Candidate, opts *SelectOptions) []*Candidate {
    // Priority order:
    // 1. host (local network) - highest priority
    // 2. srflx from own Station - second priority
    // 3. srflx from public STUN - third priority
    // 4. relay from own Station - fourth priority
    // 5. relay from public TURN - lowest priority
    
    return s.sortByPriority(candidates)
}
```

**Priority Rules**:
```go
type PriorityRule struct {
    Type       CandidateType  // host, srflx, relay
    Source     string         // own, public
    Priority   int            // 1-100
    Conditions []Condition    // network conditions
}

// Example rules
var DefaultPriorityRules = []PriorityRule{
    {Type: "host", Source: "local", Priority: 100},
    {Type: "srflx", Source: "own", Priority: 90},
    {Type: "srflx", Source: "public", Priority: 70},
    {Type: "relay", Source: "own", Priority: 60},
    {Type: "relay", Source: "public", Priority: 40},
}
```

---

## 🔄 ICE Complete Lifecycle

### How System Layers Map to ICE Lifecycle

**System Layers** (静态架构) 定义了 **组件和职责**  
**ICE Lifecycle** (动态流程) 展示了 **这些组件如何协作**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│              System Layers → ICE Lifecycle Mapping                          │
└─────────────────────────────────────────────────────────────────────────────┘

System Layer                    ICE Lifecycle Phase              Components Used
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─────────────────────┐
│ Application Layer   │         Phase 1: Initialization
│ (Any P2P App)       │         ↓
└─────────────────────┘         Application initiates P2P connection request
         ↓
┌─────────────────────┐
│ ICE Capability      │         Phase 1: Get ICE Config
│ Layer               │         ↓
│ • ICE Config Service│  ────→  HTTP GET /api/v1/ice/servers
│ • ICE Manager       │         Returns: STUN/TURN servers + credentials
└─────────────────────┘
         ↓
┌─────────────────────┐
│ Transport Services  │         Phase 2-3: Candidate Gathering
│ Layer               │         ↓
│ • STUN Server       │  ────→  STUN Binding Request/Response
│ • TURN Server       │  ────→  TURN Allocate Request/Response
│ • libp2p            │         (Gather host, srflx, relay candidates)
└─────────────────────┘
         ↓
┌─────────────────────┐
│ Station             │         Phase 2-3: STUN/TURN Services
│ Infrastructure      │         ↓
│ • Subserver         │  ────→  STUN/TURN servers run on Station
│ • HTTP/WS           │  ────→  ICE config API endpoint
└─────────────────────┘
         ↓
┌─────────────────────┐
│ ICE Capability      │         Phase 4: Signaling
│ Layer               │         ↓
│ • ICE Manager       │  ────→  Exchange SDP + Candidates via WebSocket/HTTP
└─────────────────────┘
         ↓
┌─────────────────────┐
│ ICE Capability      │         Phase 5: Connectivity Check
│ Layer               │         ↓
│ • Candidate Selector│  ────→  Try candidate pairs by priority
│ • ICE Manager       │  ────→  Perform STUN connectivity checks
└─────────────────────┘
         ↓
┌─────────────────────┐
│ Transport Services  │         Phase 6: Connection Established
│ Layer               │         ↓
│ • libp2p            │  ────→  P2P direct connection (or TURN relay)
└─────────────────────┘
         ↓
┌─────────────────────┐
│ Application Layer   │         Phase 6-7: Data Transfer & Monitoring
│ (Any P2P App)       │         ↓
└─────────────────────┘         Send/receive data over P2P connection
         ↓
┌─────────────────────┐
│ ICE Capability      │         Phase 7: Connection Monitoring
│ Layer               │         ↓
│ • ICE Manager       │  ────→  Monitor quality, keepalive, renegotiate
└─────────────────────┘
         ↓
┌─────────────────────┐
│ Transport Services  │         Phase 8: Connection Termination
│ Layer               │         ↓
│ • TURN Server       │  ────→  Release TURN allocations
└─────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Key Insights:

1. **ICE Capability Layer** orchestrates the entire ICE lifecycle
   - ICE Manager: Coordinates all phases
   - ICE Config Service: Provides configuration (Phase 1)
   - Candidate Selector: Optimizes connection (Phase 5)

2. **Transport Services Layer** provides the actual networking
   - STUN Server: NAT discovery (Phase 2-3)
   - TURN Server: Relay service (Phase 2-3, 8)
   - libp2p: P2P connection (Phase 6-7)

3. **Station Infrastructure** hosts the services
   - Runs STUN/TURN servers
   - Provides HTTP/WebSocket APIs
   - Stores configuration and credentials

4. **Application Layer** uses ICE transparently
   - Initiates connection (Phase 1)
   - Sends/receives data (Phase 6-7)
   - Doesn't need to know ICE details
```

---

## 🌐 ICE Network as Universal Infrastructure

### ICE 不仅仅是为 Chat 设计的

ICE 网络能力是 Peers-Touch 的**通用基础设施**,支撑所有需要 P2P 连接的场景:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ICE Network Infrastructure                               │
│                    (Universal P2P Connectivity)                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↑
                    ┌───────────────┼───────────────┐
                    │               │               │
         ┌──────────┴──────┐  ┌────┴─────┐  ┌─────┴──────────┐
         │                 │  │          │  │                │
    ┌────▼────┐      ┌────▼──▼──┐  ┌───▼──▼───┐      ┌─────▼─────┐
    │ Client  │      │ Station   │  │ Station  │      │  Client   │
    │ to      │      │ to        │  │ to       │      │  to       │
    │ Client  │      │ Station   │  │ Station  │      │  Service  │
    │ P2P     │      │ Federation│  │ Cluster  │      │  P2P      │
    └─────────┘      └───────────┘  └──────────┘      └───────────┘
```

### 完整应用场景矩阵

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ICE Network Application Matrix                           │
└─────────────────────────────────────────────────────────────────────────────┘

Category          Scenario                    Use ICE?   Priority   Phase
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. User Communication (Client ↔ Client)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Text Chat         Friend messaging            ✅ Yes     High      MVP
  Voice Call        Real-time audio             ✅ Yes     High      Phase 2
  Video Call        Real-time video             ✅ Yes     High      Phase 2
  Screen Share      Desktop/window sharing      ✅ Yes     Medium    Phase 3
  File Transfer     P2P file sending            ✅ Yes     High      Phase 2
  Collaborative     Real-time doc editing       ✅ Yes     Low       Phase 4
  Gaming            P2P game sessions           ✅ Yes     Low       Future

2. Federation (Station ↔ Station)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Message Relay     Cross-station messaging     ✅ Yes*    High      Phase 5
  Content Sync      Federated timeline          ✅ Yes*    Medium    Phase 5
  Discovery         Station discovery           ✅ Yes*    Medium    Phase 5
  Backup/Replica    Data replication            ✅ Yes*    Low       Future
  Load Balance      Request forwarding          ✅ Yes*    Low       Future
  
  * Only when Station behind NAT (home server deployment)
  * Cloud Stations use direct HTTPS

3. Service Infrastructure (Station ↔ Station)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Cluster Sync      Multi-Station cluster       ✅ Yes*    Medium    Future
  DHT Network       Distributed hash table      ✅ Yes     Medium    Future
  Consensus         Distributed consensus       ✅ Yes*    Low       Future
  Event Bus         Cross-station events        ✅ Yes*    Low       Future

4. Client-Server (Client ↔ Station)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  API Requests      REST/GraphQL                ❌ No      High      Existing
  Authentication    Login/OAuth                 ❌ No      High      Existing
  Data Sync         Timeline/profile sync       ❌ No      High      Existing
  Push Notification WebSocket push              ❌ No      High      Existing
  File Upload       Media/attachment upload     ❌ No      High      Existing

5. Advanced P2P Scenarios
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Mesh Network      Multi-peer connections      ✅ Yes     Low       Future
  CDN P2P           Content distribution        ✅ Yes     Low       Future
  Live Streaming    P2P video broadcast         ✅ Yes     Low       Future
  IoT Device        Device-to-device            ✅ Yes     Low       Future

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Legend:
✅ Yes  - ICE is required for NAT traversal
❌ No   - Direct connection possible (Station has public IP)
✅ Yes* - ICE needed only for specific deployment scenarios
```

### 联邦网络的特殊性

**联邦(Federation)是 ICE 网络能力的重要应用场景之一:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Federation Network Topology                              │
└─────────────────────────────────────────────────────────────────────────────┘

Scenario: Alice (Station A) 发消息给 Bob (Station B)

Option 1: Cloud Deployment (No ICE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Station A (AWS)                                              Station B (Aliyun)
123.45.67.89                                                 98.76.54.32
     │                                                            │
     │────────── HTTPS POST /api/v1/message/relay ──────────────>│
     │                                                            │
     │<─────────────────── 200 OK ────────────────────────────────│

✅ Simple, direct HTTPS
❌ Centralized (both need cloud infrastructure)
❌ Cost: ~$10-50/month per Station


Option 2: Home Server Deployment (Use ICE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Station A (Home NAS)                                         Station B (Home Server)
192.168.1.100 (NAT)                                          192.168.2.100 (NAT)
     │                                                            │
     │  1. Use ICE to establish P2P connection                   │
     │  2. Exchange candidates via bootstrap/DHT                 │
     │  3. Perform connectivity checks                           │
     │                                                            │
     │══════════ P2P Direct Connection (via ICE) ════════════════>│
     │                                                            │
     │────────── Encrypted message over P2P ─────────────────────>│

✅ True decentralization
✅ No cloud dependency
✅ Cost: ~$0 (use home hardware)
❌ More complex (need ICE)


Option 3: Mixed Deployment (Asymmetric)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Station A (Cloud)                                            Station B (Home NAS)
123.45.67.89                                                 192.168.1.100 (NAT)
     │                                                            │
     │  Station B maintains persistent WebSocket to Station A    │
     │<══════════════ WebSocket (initiated by B) ════════════════│
     │                                                            │
     │────────── Push message via WebSocket ─────────────────────>│

✅ Works without ICE
✅ Simpler than full ICE
❌ Not truly bidirectional
⚠️ Alternative: Use ICE for bidirectional P2P
```

### 关键洞察

**ICE 网络能力是 Peers-Touch 的核心基础设施,不是某个应用的附属功能:**

1. **通用性**: 支持所有需要 P2P 连接的场景
2. **联邦基础**: 是实现真正去中心化联邦网络的关键
3. **分层设计**: 应用层无需关心 NAT 穿透细节
4. **渐进增强**: 
   - MVP: Client ↔ Client (Chat, File Transfer)
   - Phase 2: Voice/Video Call
   - Phase 5: Station ↔ Station (Federation)
   - Future: Mesh Network, CDN P2P

---

### ICE Connection Establishment Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ICE Complete Lifecycle (Alice → Bob)                     │
└─────────────────────────────────────────────────────────────────────────────┘

Phase 1: Initialization & Configuration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Alice Client                    Station A                    Station B                    Bob Client
     │                              │                            │                            │
     │──(1) GET /api/v1/ice/servers─>│                            │                            │
     │                              │                            │                            │
     │<─(2) Return ICE config───────│                            │                            │
     │    {                         │                            │                            │
     │      stun: station-a:3478    │                            │                            │
     │      turn: station-a:3478    │                            │                            │
     │      credentials: {...}      │                            │                            │
     │    }                         │                            │                            │
     │                              │                            │                            │
     │                              │                            │<──(3) GET /api/v1/ice/servers──│
     │                              │                            │                            │
     │                              │                            │──(4) Return ICE config─────>│
     │                              │                            │                            │

Phase 2: Candidate Gathering (Alice)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     │                              │                            │                            │
     │──(5) Gather candidates───────>│                            │                            │
     │                              │                            │                            │
     │    a) Host candidate         │                            │                            │
     │       192.168.1.100:54321    │                            │                            │
     │                              │                            │                            │
     │    b) STUN Binding Request──>│                            │                            │
     │                              │                            │                            │
     │<───── Binding Response───────│                            │                            │
     │       (Your public IP:        │                            │                            │
     │        123.45.67.89:54321)   │                            │                            │
     │                              │                            │                            │
     │    c) Srflx candidate        │                            │                            │
     │       123.45.67.89:54321     │                            │                            │
     │                              │                            │                            │
     │    d) TURN Allocate Request─>│                            │                            │
     │                              │                            │                            │
     │<───── Allocate Success───────│                            │                            │
     │       (Relay: station-a:     │                            │                            │
     │        49152)                │                            │                            │
     │                              │                            │                            │
     │    e) Relay candidate        │                            │                            │
     │       station-a:49152        │                            │                            │
     │                              │                            │                            │

Phase 3: Candidate Gathering (Bob) - Parallel
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     │                              │                            │                            │
     │                              │                            │<──(6) Gather candidates────│
     │                              │                            │                            │
     │                              │                            │    a) Host: 192.168.2.100:54322
     │                              │                            │<── b) STUN Request─────────│
     │                              │                            │─── Binding Response───────>│
     │                              │                            │    (98.76.54.32:54322)    │
     │                              │                            │    c) Srflx: 98.76.54.32:54322
     │                              │                            │<── d) TURN Allocate────────│
     │                              │                            │─── Allocate Success───────>│
     │                              │                            │    e) Relay: station-b:49153

Phase 4: Signaling (Exchange Candidates)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     │                              │                            │                            │
     │──(7) Send SDP Offer + Candidates via WebSocket/HTTP──────────────────────────────────>│
     │    {                         │                            │                            │
     │      type: "offer",          │                            │                            │
     │      candidates: [           │                            │                            │
     │        host: 192.168.1.100:54321,                         │                            │
     │        srflx: 123.45.67.89:54321,                         │                            │
     │        relay: station-a:49152                             │                            │
     │      ]                       │                            │                            │
     │    }                         │                            │                            │
     │                              │                            │                            │
     │<─(8) Receive SDP Answer + Candidates─────────────────────────────────────────────────│
     │    {                         │                            │                            │
     │      type: "answer",         │                            │                            │
     │      candidates: [           │                            │                            │
     │        host: 192.168.2.100:54322,                         │                            │
     │        srflx: 98.76.54.32:54322,                          │                            │
     │        relay: station-b:49153                             │                            │
     │      ]                       │                            │                            │
     │    }                         │                            │                            │
     │                              │                            │                            │

Phase 5: Connectivity Check (ICE Negotiation)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     │                              │                            │                            │
     │──(9) Try candidate pairs (priority order):                                            │
     │                              │                            │                            │
     │    Attempt 1: host → host    │                            │                            │
     │    192.168.1.100 ─────X─────────────────────────────────────────X────> 192.168.2.100 │
     │    ❌ FAIL (different networks)                           │                            │
     │                              │                            │                            │
     │    Attempt 2: srflx → srflx  │                            │                            │
     │    123.45.67.89 ─────────────────────────────────────────────────────> 98.76.54.32   │
     │    STUN Binding Request ─────────────────────────────────────────────> (hole punch)   │
     │<─────────────────────────────────────────────────────────────── STUN Binding Response │
     │    ✅ SUCCESS! (NAT hole punched)                         │                            │
     │                              │                            │                            │
     │    (If srflx failed, would try relay → relay)             │                            │
     │                              │                            │                            │

Phase 6: Connection Established
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     │                              │                            │                            │
     │══(10) P2P Direct Connection Established══════════════════════════════════════════════>│
     │    Connection Type: srflx → srflx                         │                            │
     │    Latency: ~50ms            │                            │                            │
     │                              │                            │                            │
     │══(11) Send encrypted message═══════════════════════════════════════════════════════════>│
     │    (bypassing Stations)      │                            │                            │
     │                              │                            │                            │
     │<═(12) Receive encrypted message════════════════════════════════════════════════════════│
     │                              │                            │                            │

Phase 7: Connection Monitoring & Maintenance
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     │                              │                            │                            │
     │──(13) Periodic keepalive─────────────────────────────────────────────────────────────>│
     │    (every 15 seconds)        │                            │                            │
     │                              │                            │                            │
     │<─(14) Keepalive response─────────────────────────────────────────────────────────────│
     │                              │                            │                            │
     │──(15) Monitor connection quality:                         │                            │
     │    - Latency: 45-55ms        │                            │                            │
     │    - Packet loss: 0%         │                            │                            │
     │    - Jitter: 2ms             │                            │                            │
     │                              │                            │                            │
     │    (If quality degrades, may renegotiate or fallback to relay)                        │
     │                              │                            │                            │

Phase 8: Connection Termination
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     │                              │                            │                            │
     │──(16) Close connection───────────────────────────────────────────────────────────────>│
     │                              │                            │                            │
     │──(17) Release TURN allocation>│                            │                            │
     │                              │                            │                            │
     │<─(18) Allocation released────│                            │                            │
     │                              │                            │                            │
     │                              │                            │<──(19) Release TURN────────│
     │                              │                            │                            │
     │                              │                            │──(20) Allocation released─>│
     │                              │                            │                            │

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Key Metrics:
• Total setup time: ~2-5 seconds (including candidate gathering and connectivity checks)
• Connection success rate: 95%+ (80% srflx, 15% relay, 5% fail)
• P2P latency: 20-100ms (depending on geographic distance)
• Relay latency: 50-200ms (additional hop through TURN server)
```

---

## 🎯 ICE Usage Scenarios

### When ICE is Needed vs Not Needed

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ICE Usage Decision Tree                             │
└─────────────────────────────────────────────────────────────────────────────┘

Scenario 1: Client ↔ Client (P2P Communication)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ NEED ICE

Alice (NAT)                                                      Bob (NAT)
192.168.1.100                                                    192.168.2.100
     │                                                                │
     │  ❌ Cannot directly connect (both behind NAT)                 │
     │                                                                │
     │  ✅ Use ICE to establish P2P connection:                      │
     │     1. Get STUN servers from own Stations                     │
     │     2. Gather candidates (host, srflx, relay)                 │
     │     3. Exchange candidates via signaling                      │
     │     4. Perform connectivity checks                            │
     │     5. Establish optimal connection                           │
     │                                                                │
     └────────────── P2P Direct Connection ──────────────────────────┘

Use Cases:
• Friend chat (text messages)
• Voice/video calls
• File transfers
• Screen sharing
• Real-time collaboration


Scenario 2: Client ↔ Station (Client-Server Communication)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ NO NEED FOR ICE

Alice (NAT)                                                   Station A
192.168.1.100                                                 (Public IP: 123.45.67.89)
     │                                                                │
     │  ✅ Can directly connect (Station has public IP/domain)       │
     │                                                                │
     │────────── HTTPS: https://station-a.com ──────────────────────>│
     │<─────────────────── Response ─────────────────────────────────│
     │                                                                │
     │────────── WebSocket: wss://station-a.com ─────────────────────>│
     │<══════════════ Bidirectional Communication ═══════════════════>│

Why no ICE needed:
• Station has public IP or domain name
• Client can initiate connection to Station
• Standard HTTP/HTTPS/WebSocket works fine
• NAT allows outbound connections

Use Cases:
• API requests
• Authentication
• Data sync
• Push notifications
• Configuration updates


Scenario 3: Station ↔ Station (Server-to-Server Communication)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Case 3a: Both Stations Have Public IPs (Cloud Deployment)
❌ NO NEED FOR ICE

Station A (AWS)                                              Station B (Aliyun)
(Public IP: 123.45.67.89)                                    (Public IP: 98.76.54.32)
station-a.com                                                 station-b.com
     │                                                                │
     │  ✅ Both have public IPs, can directly communicate            │
     │                                                                │
     │────────── HTTPS: https://station-b.com/api ───────────────────>│
     │<─────────────────── Response ─────────────────────────────────│

Why no ICE needed:
• Both Stations have public IPs
• Direct HTTP/HTTPS communication
• No NAT traversal needed
• Standard server-to-server protocols


Case 3b: Stations Behind NAT (Home/Personal Server Deployment)
✅ NEED ICE FOR FEDERATION!

Station A (Home NAS)                                         Station B (Home Server)
192.168.1.100 (behind NAT)                                   192.168.2.100 (behind NAT)
     │                                                                │
     │  ❌ Cannot directly connect (both behind NAT/CGNAT)           │
     │                                                                │
     │  ✅ Use ICE for Station-to-Station connection:                │
     │     1. Both Stations act as ICE clients                       │
     │     2. Use public STUN servers for NAT discovery              │
     │     3. Exchange candidates via DHT or bootstrap server        │
     │     4. Establish P2P connection between Stations              │
     │     5. Federated message relay over P2P link                  │
     │                                                                │
     └────────────── Station-to-Station P2P ─────────────────────────┘

Why ICE needed:
• Home/personal server deployments are common
• Many users behind CGNAT (Carrier-Grade NAT)
• Dynamic IPs without domain names
• Need P2P for true decentralization

Use Cases:
• Federated message relay
• Home server federation
• Personal cloud synchronization
• Decentralized network topology


Case 3c: Mixed Deployment (Cloud + Home)
⚠️ PARTIAL ICE (Asymmetric)

Station A (Cloud)                                            Station B (Home NAS)
(Public IP: 123.45.67.89)                                    192.168.1.100 (behind NAT)
station-a.com                                                 
     │                                                                │
     │  ✅ B can connect to A (outbound from NAT)                    │
     │<────────── HTTPS: https://station-a.com ──────────────────────│
     │                                                                │
     │  ❌ A cannot initiate connection to B                         │
     │  ✅ Solution: B maintains persistent WebSocket to A           │
     │<══════════════ WebSocket (initiated by B) ════════════════════│
     │                                                                │
     │  Alternative: Use ICE for bidirectional P2P                   │

Why asymmetric:
• NAT allows outbound connections
• Cloud Station can be reached directly
• Home Station needs to maintain connection
• Or use ICE for true bidirectional P2P


Scenario 4: Client ↔ Client (Same Local Network)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ USE ICE (but will use host candidates)

Alice                                                         Bob
192.168.1.100                                                 192.168.1.101
     │                                                                │
     │  ✅ ICE will discover they're on same network                 │
     │                                                                │
     │  ICE Process:                                                 │
     │  1. Gather host candidate: 192.168.1.100:54321                │
     │  2. Exchange candidates                                       │
     │  3. Connectivity check succeeds immediately                   │
     │  4. Use host-to-host connection (fastest)                     │
     │                                                                │
     └────────── Direct Local Connection (0ms latency) ──────────────┘

Why still use ICE:
• ICE automatically detects local network
• Falls back to local connection (most efficient)
• No STUN/TURN needed in this case
• Consistent API for all P2P scenarios


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Summary:

✅ USE ICE:
   • Client ↔ Client (any P2P communication)
     - Friend chat, voice/video calls
     - File transfers, screen sharing
     - Real-time collaboration
   
   • Station ↔ Station (when behind NAT)
     - Home server deployments
     - Personal NAS federation
     - CGNAT scenarios
     - True decentralized network

❌ DON'T USE ICE:
   • Client ↔ Station (client-server)
     - Station has public IP/domain
     - Standard HTTP/WebSocket works
   
   • Station ↔ Station (both have public IPs)
     - Cloud server deployments
     - Direct HTTPS communication

⚠️ OPTIONAL ICE:
   • Station ↔ Station (mixed deployment)
     - Can use persistent WebSocket (simpler)
     - Or use ICE for bidirectional P2P (better)

Key Principles:
1. ICE is for NAT traversal in any P2P scenario (Client or Station)
2. If both sides have public IPs, use standard HTTP/HTTPS
3. If one side has public IP, the NAT side can initiate connection
4. For true decentralization, Stations should support ICE for federation
```

---

## 🔄 Data Flow Scenarios

### Scenario 1: Same Local Network

```
Client A (192.168.1.100) ←─────────→ Client B (192.168.1.101)

Flow:
1. ICE Manager gathers candidates
   → host: 192.168.1.100:54321
2. Client A sends offer to Client B
3. Client B gathers candidates
   → host: 192.168.1.101:54322
4. Connectivity check succeeds (host-to-host)
5. Direct connection established

Result: No STUN/TURN needed, 0ms latency
```

### Scenario 2: Different Networks (Full Cone NAT)

```
Client A (NAT) ←─→ Station A (STUN) ←─→ Internet ←─→ Station B (STUN) ←─→ Client B (NAT)

Flow:
1. Client A requests ICE servers from Station A
   → GET /api/v1/ice/servers
   → Returns: [stun:station-a.com:3478]

2. Client A gathers candidates
   → host: 192.168.1.100:54321 (local)
   → srflx: 123.45.67.89:54321 (via Station A STUN)

3. Client B requests ICE servers from Station B
   → Returns: [stun:station-b.com:3478]

4. Client B gathers candidates
   → host: 192.168.2.100:54322
   → srflx: 98.76.54.32:54322 (via Station B STUN)

5. Exchange candidates via signaling (WebSocket/HTTP)

6. Connectivity check
   → A sends to B's srflx: 98.76.54.32:54322
   → B sends to A's srflx: 123.45.67.89:54321
   → Both succeed (hole punching)

7. Direct P2P connection established

Result: Using own Stations' STUN, ~50ms latency
```

### Scenario 3: Symmetric NAT (Requires TURN)

```
Client A (Symmetric NAT) ←─→ Station A (TURN) ←─→ Client B (Symmetric NAT)

Flow:
1. Client A gathers candidates
   → host: 192.168.1.100:54321
   → srflx: 123.45.67.89:12345 (STUN, but port changes)
   → relay: station-a.com:54321 (TURN allocation)

2. Client B gathers candidates
   → host: 192.168.2.100:54322
   → srflx: 98.76.54.32:23456 (STUN, but port changes)
   → relay: station-b.com:54322 (TURN allocation)

3. Connectivity check
   → host-to-host: FAIL
   → srflx-to-srflx: FAIL (port mismatch)
   → relay-to-relay: SUCCESS

4. Connection via TURN relay

Result: Using own Stations' TURN, ~100ms latency
```

---

## 🌐 Network Topology

### Self-Hosted ICE Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 Peers-Touch Network                         │
│                                                             │
│   Station A          Station B          Station C          │
│   (Alice's)          (Bob's)            (Carol's)          │
│      │                  │                  │               │
│      │                  │                  │               │
│   ┌──┴──┐            ┌──┴──┐            ┌──┴──┐           │
│   │STUN │            │STUN │            │STUN │           │
│   │TURN │            │TURN │            │TURN │           │
│   └─────┘            └─────┘            └─────┘           │
│      ↑                  ↑                  ↑               │
│      │                  │                  │               │
│   Client A          Client B          Client C            │
│                                                             │
│   Each client uses:                                        │
│   1. Own Station's STUN/TURN (highest priority)           │
│   2. Public STUN servers (fallback)                        │
│                                                             │
│   Public STUN Fallback:                                    │
│   • stun.xten.com:3478                                     │
│   • stun.voipbuster.com:3478                               │
│   • stun.l.google.com:19302                                │
└─────────────────────────────────────────────────────────────┘
```

### Deployment Stages

```
Stage 1: Bootstrap
  → Use public STUN primarily
  → Own Station STUN for testing

Stage 2: Production
  → Own Station STUN as primary
  → Public STUN as fallback
  → TURN for symmetric NAT cases

Stage 3: Optimized
  → Monitoring and metrics
  → Automatic fallback strategies
  → Cost optimization
```

---

## � Station Integration (main.go)

**Clean Main Pattern** - ICE 自动发现 STUN/TURN,无需手动注入:

```go
// station/app/main.go
package main

import (
    "context"
    
    peers "github.com/peers-labs/peers-touch/station/frame"
    "github.com/peers-labs/peers-touch/station/frame/core/ice"
    "github.com/peers-labs/peers-touch/station/frame/core/node"
    "github.com/peers-labs/peers-touch/station/frame/core/server"
    
    // 自动注册 STUN/TURN SubServers
    _ "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/stun"
    _ "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/turn"
)

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    
    p := peers.NewPeer()
    
    err := p.Init(
        ctx,
        node.WithPrivateKey("private.pem"),
        node.Name("peers-touch-station"),
        
        // ICE Manager 自动发现 STUN/TURN (通过 Type() 匹配)
        server.WithICE(
            ice.WithPublicSTUNFallback(true),
            ice.WithCandidateCacheTTL(5 * time.Minute),
        ),
    )
    if err != nil {
        panic(err)
    }
    
    err = p.Start()
    if err != nil {
        panic(err)
    }
}
```

**server.WithICE 实现**:
```go
// station/frame/core/server/options.go

func WithICE(opts ...option.Option) option.Option {
    return wrapper.Wrap(func(srvOpts *Options) {
        // 创建 ICE Manager
        iceManager := ice.NewManager(opts...)
        
        // 注册为特殊组件 (在 Server Init 后自动初始化)
        srvOpts.ICEManager = iceManager
        
        // 注册 HTTP handlers
        srvOpts.Handlers = append(srvOpts.Handlers, iceManager.Handlers()...)
    })
}
```

**关键点:**
- ✅ main.go 保持干净,只需 `server.WithICE(...)`
- ✅ ICE Manager 在 Init 时自动发现 STUN/TURN (通过 `Type()` 匹配)
- ✅ STUN/TURN 通过 `init()` 自动注册 (blank import)
- ✅ 使用 Functional Options 配置 ICE 行为

---

## 📁 Configuration Files

配置文件位于 `station/app/conf/`,遵循现有配置风格。

### sub_stun.yml

```yaml
# station/app/conf/sub_stun.yml
# STUN Server Configuration

peers:
  node:
    server:
      subserver:
        stun:
          enabled: true
          port: 3478
          public-ip: auto                    # auto | <ip-address>
          rate-limit:
            requests-per-second: 100
            burst: 200
```

### sub_turn.yml

```yaml
# station/app/conf/sub_turn.yml
# TURN Server Configuration

peers:
  node:
    server:
      subserver:
        turn:
          enabled: true
          port: 3478
          realm: ${PEERS_DOMAIN}             # e.g., peers-touch.com
          public-ip: auto                    # auto | <ip-address>
          auth-secret: ${TURN_AUTH_SECRET}   # HMAC secret for credentials
          relay-ip-range: 10.0.0.0/24        # Internal relay IP pool
          max-allocations: 1000
          allocation-lifetime: 600s
```

### sub_ice.yml

```yaml
# station/app/conf/sub_ice.yml
# ICE Manager Configuration

peers:
  node:
    server:
      ice:
        enabled: true
        public-fallback:
          enabled: true
          stun-servers:
            - stun:stun.l.google.com:19302
            - stun:stun.xten.com:3478
        candidate-cache:
          ttl: 5m
          max-size: 10000
        metrics:
          enabled: true
          export-interval: 30s
```

### peers.yml (includes)

在主配置文件中引入 ICE 相关配置:

```yaml
# station/app/conf/peers.yml

peers:
  version: 0.0.1
  includes: store.yml, log.yml, actor.yml, sub_bootstrap.yml, sub_stun.yml, sub_turn.yml, sub_ice.yml
  # ... other config
```

### 环境变量

```bash
# .env or system environment

# STUN/TURN 公网地址 (如果 auto 检测失败)
PEERS_STUN_PUBLIC_IP=123.45.67.89
PEERS_TURN_PUBLIC_IP=123.45.67.89

# TURN 认证密钥
TURN_AUTH_SECRET=your-secure-secret-key

# 域名
PEERS_DOMAIN=peers-touch.com
```

---

## 🔌 Client Integration

### Dart Client (Flutter)

```dart
// client/common/peers_touch_base/lib/network/ice/ice_service.dart

class IceService {
  final HttpService _httpService;
  
  /// Get ICE servers configuration
  Future<List<IceServer>> getICEServers({
    required String userDID,
    bool includePublicFallback = true,
  }) async {
    final servers = <IceServer>[];
    
    // 1. Get own Station's ICE servers
    try {
      final ownServers = await _getOwnStationICEServers();
      servers.addAll(ownServers);
    } catch (e) {
      LoggingService.warning('Failed to get own Station ICE servers: $e');
    }
    
    // 2. Add public STUN as fallback
    if (includePublicFallback) {
      servers.addAll(_getPublicSTUNServers());
    }
    
    return servers;
  }
  
  Future<List<IceServer>> _getOwnStationICEServers() async {
    final response = await _httpService.get('/api/v1/ice/servers');
    return (response['ice_servers'] as List)
        .map((json) => IceServer.fromJson(json))
        .toList();
  }
  
  List<IceServer> _getPublicSTUNServers() {
    return [
      IceServer(urls: ['stun:stun.xten.com:3478']),
      IceServer(urls: ['stun:stun.voipbuster.com:3478']),
      IceServer(urls: ['stun:stun.l.google.com:19302']),
    ];
  }
}
```

### Usage in Friend Chat

```dart
// client/desktop/lib/features/friend_chat/controller/friend_chat_controller.dart

class FriendChatController extends GetxController {
  final IceService _iceService = Get.find();
  
  Future<void> initiateP2PConnection(String friendDID) async {
    // 1. Get ICE servers
    final iceServers = await _iceService.getICEServers(
      userDID: currentUserDID,
    );
    
    // 2. Create P2P connection with ICE servers
    final connection = await P2PConnectionFactory.create(
      remoteDID: friendDID,
      iceServers: iceServers,
    );
    
    // 3. Establish connection
    await connection.connect();
    
    // 4. Start messaging
    _activeConnections[friendDID] = connection;
  }
}
```

---

## 📊 Metrics and Monitoring

### Key Metrics

```go
type ICEMetrics struct {
    // Connection Success Rate
    TotalAttempts        int64
    SuccessfulDirect     int64  // host-to-host
    SuccessfulSTUN       int64  // via STUN
    SuccessfulTURN       int64  // via TURN
    Failed               int64
    
    // Latency
    AverageLatency       time.Duration
    P50Latency           time.Duration
    P95Latency           time.Duration
    P99Latency           time.Duration
    
    // Resource Usage
    ActiveSTUNSessions   int
    ActiveTURNSessions   int
    TURNBandwidthUsage   int64  // bytes
}
```

### Prometheus Metrics

```go
var (
    iceConnectionAttempts = promauto.NewCounterVec(
        prometheus.CounterOpts{
            Name: "ice_connection_attempts_total",
            Help: "Total number of ICE connection attempts",
        },
        []string{"type", "result"},
    )
    
    iceConnectionLatency = promauto.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "ice_connection_latency_seconds",
            Help:    "ICE connection establishment latency",
            Buckets: prometheus.DefBuckets,
        },
        []string{"type"},
    )
    
    turnBandwidthUsage = promauto.NewCounter(
        prometheus.CounterOpts{
            Name: "turn_bandwidth_bytes_total",
            Help: "Total TURN relay bandwidth usage",
        },
    )
)
```

---

## 🔒 Security Considerations

### 1. TURN Authentication

```go
// Use time-limited credentials
type TURNCredentials struct {
    Username   string  // format: timestamp:user_did
    Credential string  // HMAC(secret, username)
    TTL        int     // 3600 seconds (1 hour)
}

func GenerateTURNCredentials(userDID string, secret string) *TURNCredentials {
    timestamp := time.Now().Unix() + 3600
    username := fmt.Sprintf("%d:%s", timestamp, userDID)
    credential := hmac.New(sha256.New, []byte(secret))
    credential.Write([]byte(username))
    
    return &TURNCredentials{
        Username:   username,
        Credential: hex.EncodeToString(credential.Sum(nil)),
        TTL:        3600,
    }
}
```

### 2. Rate Limiting

```go
type RateLimiter struct {
    stunLimiter *rate.Limiter  // 100 req/s per IP
    turnLimiter *rate.Limiter  // 10 allocations/min per user
}
```

### 3. DDoS Protection

- IP-based rate limiting
- Credential validation
- Connection timeout (30 seconds)
- Max allocations per user (5)

---

## 💰 Cost Analysis

### Scenario: 1000 Active Users

#### Option 1: Public STUN Only (Current)
```
Cost: $0
Coverage: 80-85% (Full Cone NAT)
Limitation: 15-20% users cannot connect (Symmetric NAT)
```

#### Option 2: Public STUN + Public TURN
```
Cost: $50-200/month (based on relay traffic)
Coverage: 100%
Limitation: Dependency on third parties
```

#### Option 3: Own Station ICE (Proposed)
```
Infrastructure Cost:
- Server: $10/month (2 core, 2GB)
- Bandwidth: $5-20/month (only 15-20% use TURN)
Total: $15-30/month

Coverage: 100%
Benefits:
✅ Full control
✅ Privacy-preserving
✅ No third-party dependency
```

---

## 🚀 Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

**Framework Layer** (`station/frame/core/plugin/native/subserver/`):
- [ ] Implement STUN Subserver (`subserver/stun/`)
  - [ ] Implement `server.SubServer` interface
  - [ ] Implement `server.NetworkSubServer` interface
  - [ ] UDP listener and STUN protocol handler
  - [ ] Rate limiting and security
- [ ] Enhance TURN Subserver (`subserver/turn/`)
  - [ ] Add credential generation
  - [ ] Implement allocation management
  - [ ] Add metrics collection

**Core Layer** (`station/frame/core/ice/`):
- [ ] Create ICE Manager (`core/ice/manager.go`)
  - [ ] Define STUNService and TURNService interfaces
  - [ ] Implement Manager with interface-based dependencies
  - [ ] Candidate gathering coordination
- [ ] Create ICE Config Service (`core/ice/config.go`)
  - [ ] Configuration management
  - [ ] Credential generation
- [ ] Add HTTP Handlers (`core/ice/handler.go`)
  - [ ] `GET /api/v1/ice/servers` endpoint
  - [ ] Response formatting

**Application Layer** (`station/app/`):
- [ ] Dependency Injection setup
  - [ ] Wire STUN/TURN Subservers to ICE Manager
  - [ ] Register HTTP handlers
  - [ ] Initialize services

**Deliverable**: Clients can use own Station's STUN/TURN via HTTP API

### Phase 2: Client Integration (Week 3-4)

**Station Side** (`station/frame/core/ice/`):
- [ ] Implement Candidate Selector (`core/ice/selector.go`)
  - [ ] Priority rules configuration
  - [ ] Network metrics integration
  - [ ] Optimal candidate selection algorithm
- [ ] Add public fallback configuration
  - [ ] Public STUN server list
  - [ ] Fallback strategy

**Client Side** (`client/common/peers_touch_base/lib/network/ice/`):
- [ ] Implement IceService (`ice/ice_service.dart`)
  - [ ] HTTP client integration
  - [ ] Get ICE servers from Station API
  - [ ] Public STUN fallback
  - [ ] Configuration caching
- [ ] Implement IceServer model (`ice/ice_server.dart`)
  - [ ] Proto-based model
  - [ ] JSON serialization
- [ ] Integration with P2P connection factory
  - [ ] Pass ICE servers to WebRTC/libp2p
  - [ ] Connection establishment

**Deliverable**: Clients can use own Station's ICE services with public fallback

### Phase 3: Optimization (Week 5-6)

**Monitoring & Metrics** (`station/frame/core/ice/`):
- [ ] Connection quality monitoring (`core/ice/metrics.go`)
  - [ ] Success rate tracking
  - [ ] Latency measurement
  - [ ] Connection type distribution
- [ ] Automatic fallback strategy
  - [ ] Retry logic
  - [ ] Degradation handling
  - [ ] Circuit breaker pattern
- [ ] Performance tuning
  - [ ] Connection pool optimization
  - [ ] Candidate gathering optimization
  - [ ] Memory usage optimization

**Testing**:
- [ ] Load testing
  - [ ] Concurrent connection tests
  - [ ] STUN/TURN server stress tests
  - [ ] End-to-end P2P connection tests
- [ ] Chaos engineering
  - [ ] Network partition simulation
  - [ ] NAT type variation tests
  - [ ] Failure scenario testing

**Deliverable**: Production-ready ICE capability

### Phase 4: Advanced Features (Week 7-8)

**Protocol Enhancements** (`station/frame/core/plugin/native/subserver/`):
- [ ] IPv6 support
  - [ ] Dual-stack STUN/TURN
  - [ ] IPv6 candidate gathering
  - [ ] IPv4/IPv6 interoperability
- [ ] Mobile network optimization
  - [ ] Cellular network detection
  - [ ] Bandwidth adaptation
  - [ ] Battery optimization

**Security & Management** (`station/frame/core/ice/`):
- [ ] Advanced security features
  - [ ] Credential rotation
  - [ ] Rate limiting per user
  - [ ] DDoS protection
- [ ] Admin dashboard
  - [ ] Real-time metrics visualization
  - [ ] Connection monitoring
  - [ ] Configuration management

**Deliverable**: Enterprise-grade ICE service

### Phase 5: Federation Support (Future)

**Station-to-Station P2P** (`station/touch/federation/`):
- [ ] Station ICE capability
  - [ ] Station as ICE client
  - [ ] Station candidate gathering
  - [ ] Station-to-Station connectivity checks
- [ ] DHT-based Station discovery
  - [ ] Station registration in DHT
  - [ ] Station lookup by DID
  - [ ] Peer routing table
- [ ] Station candidate exchange protocol
  - [ ] Signaling via DHT/Bootstrap
  - [ ] SDP offer/answer for Stations
  - [ ] Trickle ICE for Stations

**Home Server Support**:
- [ ] NAT traversal for home-deployed Stations
  - [ ] CGNAT detection
  - [ ] Public STUN fallback for Stations
  - [ ] TURN relay for Station federation
- [ ] Federated message relay over P2P
  - [ ] Cross-Station message routing
  - [ ] Content synchronization
  - [ ] Discovery protocol

**Deployment Scenarios**:
- [ ] Cloud ↔ Cloud: Direct HTTPS (existing)
- [ ] Cloud ↔ Home: Persistent WebSocket or ICE
- [ ] Home ↔ Home: ICE-based P2P (new)

**Deliverable**: True decentralized Station federation

**Note**: Phase 5 is optional for MVP. Start with cloud-deployed Stations using direct HTTPS. Add Station-to-Station ICE when supporting home server deployments.

**Architecture Insight**: Station-to-Station ICE reuses the same architecture:
- Core layer: STUN/TURN Subservers (same as Client-to-Client)
- Federation module: Station acts as ICE client, reuses `core/ice/` components
- Application layer: Wire federation ICE client to existing Subservers

---

## 📚 References

### Standards
- [RFC 5389 - STUN](https://tools.ietf.org/html/rfc5389)
- [RFC 5766 - TURN](https://tools.ietf.org/html/rfc5766)
- [RFC 8445 - ICE](https://tools.ietf.org/html/rfc8445)
- [RFC 8838 - Trickle ICE](https://tools.ietf.org/html/rfc8838)

### Libraries
- [Pion TURN](https://github.com/pion/turn) - Go TURN implementation
- [Pion STUN](https://github.com/pion/stun) - Go STUN implementation
- [Pion WebRTC](https://github.com/pion/webrtc) - Go WebRTC implementation

### Related Documents
- `10-GLOBAL/11-architecture.md` - Overall architecture
- `30-STATION/30-station-base.md` - Station architecture
- `90-CONTEXT/architecture/friend-chat-architecture.md` - Friend chat design

---

## 🎯 Success Criteria

### Technical Metrics
- [ ] 95%+ connection success rate
- [ ] <100ms average connection establishment time
- [ ] <5% TURN relay usage (most connections via STUN)
- [ ] 99.9% service uptime

### Business Metrics
- [ ] <$2/user/month infrastructure cost
- [ ] 90%+ users use own Station's ICE services
- [ ] Minimal dependency on third-party services (only public STUN fallback)
- [ ] Positive user feedback on connection quality

### Adoption Metrics
- [ ] 95%+ clients successfully get own Station ICE config
- [ ] <5% fallback to public STUN only
- [ ] 80%+ STUN success rate (direct P2P)
- [ ] <20% TURN relay usage

---

**Next Steps**: Review this simplified design, then proceed to Friend Chat Architecture which will depend on this ICE capability.
