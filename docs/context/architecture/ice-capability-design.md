# ICE Capability Architecture Design

> Historical proposal. This document preserves an earlier ICE capability design with phased rollout notes and older repository path assumptions. It is not the current architecture or platform source of truth.
> Current sources should be located from `docs/README.md`.

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

### Architecture

**设计原则**: ICE 能力分为两个独立的 SubServer：
1. **TURN SubServer** - 提供 STUN/TURN 服务和 ICE 服务器配置 API
2. **Signaling SubServer** - 提供 WebRTC 信令服务（SDP/ICE candidates 交换）

```
station/
├── frame/core/
│   ├── server/                     # 服务器接口定义
│   └── plugin/native/subserver/
│       ├── stun/                   # STUN 服务 (NAT 发现)
│       ├── turn/                   # TURN 服务 (中继) + ICE 配置 API
│       ├── signaling/              # 信令服务 (SDP/candidates 交换) ⭐
│       └── bootstrap/              # libp2p 服务
│
└── app/
    └── main.go
```

**关键点**:
- ✅ TURN SubServer 提供 `/api/v1/turn/ice-servers` API（获取 STUN/TURN 配置）
- ✅ Signaling SubServer 提供 `/api/v1/ice/*` API（信令交换）
- ✅ 职责分离：TURN 是 UDP/TCP 服务，Signaling 是 HTTP 服务
- ✅ 客户端使用两个 API 完成 P2P 连接

**Dependency Graph**:
```
┌─────────────────────────────────────────────────────────────┐
│                        app/main.go                          │
│                                                             │
│  // blank import 自动注册                                    │
│  _ "station/frame/core/plugin/native/subserver/turn"        │
│  _ "station/frame/core/plugin/native/subserver/signaling"   │
└─────────────────────────────────────────────────────────────┘
                    │                        │
                    ↓                        ↓
         ┌──────────────────┐      ┌──────────────────────────┐
         │  TURN SubServer  │      │  Signaling SubServer     │
         │  (UDP/TCP :3478) │      │  (HTTP)                  │
         │                  │      │                          │
         │  提供 HTTP API:  │      │  提供 HTTP API:          │
         │  /api/v1/turn/   │      │  /api/v1/ice/            │
         │    ice-servers   │      │    peer/register         │
         │                  │      │    session/offer         │
         └──────────────────┘      │    session/answer        │
                                   │    session/candidates    │
                                   └──────────────────────────┘
```

### Signaling API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/v1/ice/peer/register` | POST | JWT | 注册 peer |
| `/api/v1/ice/peer/unregister` | POST | JWT | 注销 peer |
| `/api/v1/ice/peer/get` | GET | - | 获取 peer 信息 |
| `/api/v1/ice/peers` | GET | - | 获取所有 peers |
| `/api/v1/ice/session/new` | POST | JWT | 创建会话 |
| `/api/v1/ice/session/offer` | POST/GET | JWT/- | 发送/获取 SDP offer |
| `/api/v1/ice/session/answer` | POST/GET | JWT/- | 发送/获取 SDP answer |
| `/api/v1/ice/session/candidate` | POST | JWT | 发送 ICE candidate |
| `/api/v1/ice/session/candidates` | GET | - | 获取 ICE candidates |
| `/api/v1/ice/stats` | GET | - | 获取统计信息 |

---

### SubServer Interface

所有 SubServer 实现统一的接口,通过 `Info()` 方法返回服务信息:

```go
// station/frame/core/server/subserver.go

type SubServer interface {
    Init(ctx context.Context, opts ...option.Option) error
    Start(ctx context.Context, opts ...option.Option) error
    Stop(ctx context.Context) error
    Status() Status
    
    Name() string
    Type() string      // "network.stun", "network.turn", etc.
    Info() *ServiceInfo
    Handlers() []Handler  // HTTP handlers
}

type ServiceInfo struct {
    Name       string            // "stun", "turn"
    Type       string            // "network.stun", "network.turn"
    Status     string            // "running", "stopped"
    Address    string            // "0.0.0.0:3478"
    PublicAddr string            // "123.45.67.89:3478"
    Protocol   string            // "udp", "tcp", "udp+tcp"
    Metadata   map[string]string // 扩展信息
}
```

---

### 1. STUN SubServer (NAT Discovery)

**Location**: `station/frame/core/plugin/native/subserver/stun/`

**Responsibility**: Provide STUN service for NAT traversal (RFC 5389)

```go
// station/frame/core/plugin/native/subserver/stun/stun.go
package stun

type SubServer struct {
    opts        *Options
    status      server.Status
    conn        net.PacketConn
    publicIP    string
    address     string
}

func (s *SubServer) Name() string { return "stun" }
func (s *SubServer) Type() string { return "network.stun" }

func (s *SubServer) Info() *server.ServiceInfo {
    return &server.ServiceInfo{
        Name:       s.Name(),
        Type:       s.Type(),
        Status:     s.Status().String(),
        Address:    s.address,
        PublicAddr: s.publicIP,
        Protocol:   "udp",
    }
}

func (s *SubServer) Handlers() []server.Handler {
    return nil  // STUN 不提供 HTTP API
}
```

**Features**:
- RFC 5389 compliant
- Rate limiting
- IPv4/IPv6 dual stack

---

### 2. TURN SubServer (Relay + ICE API)

**Location**: `station/frame/core/plugin/native/subserver/turn/`

**Responsibility**: 
1. Provide TURN relay service (RFC 5766)
2. **Provide ICE servers configuration API** ⭐

```go
// station/frame/core/plugin/native/subserver/turn/turn.go
package turn

type SubServer struct {
    opts        *Options
    status      server.Status
    publicIP    string
    address     string
    realm       string
    authSecret  string
    
    stunSubServer server.SubServer  // 引用 STUN
}

func (t *SubServer) Name() string { return "turn" }
func (t *SubServer) Type() string { return "network.turn" }

func (t *SubServer) Info() *server.ServiceInfo {
    return &server.ServiceInfo{
        Name:       t.Name(),
        Type:       t.Type(),
        Status:     t.Status().String(),
        Address:    t.address,
        PublicAddr: t.publicIP,
        Protocol:   "udp+tcp",
        Metadata: map[string]string{
            "realm": t.realm,
        },
    }
}

// Init 时自动发现 STUN SubServer
func (t *SubServer) Init(ctx context.Context, opts ...option.Option) error {
    // ... 初始化逻辑
    
    // 查找 STUN SubServer
    srv := node.GetService().Server()
    for _, sub := range srv.Options().SubServers {
        if sub.Type() == "network.stun" {
            t.stunSubServer = sub
            break
        }
    }
    
    return nil
}

// HTTP Handlers
func (t *SubServer) Handlers() []server.Handler {
    return []server.Handler{
        {
            Path:    "/api/v1/turn/ice-servers",
            Method:  "GET",
            Handler: t.handleGetICEServers,
        },
    }
}

// ICE Servers API
func (t *SubServer) handleGetICEServers(w http.ResponseWriter, r *http.Request) {
    userDID := r.URL.Query().Get("user_did")
    
    servers := []ICEServer{}
    
    // 1. STUN Server
    if t.stunSubServer != nil {
        info := t.stunSubServer.Info()
        servers = append(servers, ICEServer{
            URLs: []string{fmt.Sprintf("stun:%s", info.PublicAddr)},
        })
    }
    
    // 2. TURN Server (self)
    creds := t.GenerateCredentials(userDID)
    servers = append(servers, ICEServer{
        URLs: []string{
            fmt.Sprintf("turn:%s?transport=udp", t.publicIP),
            fmt.Sprintf("turn:%s?transport=tcp", t.publicIP),
        },
        Username:   creds.Username,
        Credential: creds.Password,
    })
    
    // 3. Public STUN fallback (optional)
    if t.opts.PublicFallbackEnabled {
        servers = append(servers, ICEServer{
            URLs: []string{"stun:stun.l.google.com:19302"},
        })
    }
    
    json.NewEncoder(w).Encode(map[string]interface{}{
        "ice_servers": servers,
    })
}

// Generate TURN credentials (HMAC-based)
func (t *SubServer) GenerateCredentials(userDID string) *TURNCredentials {
    timestamp := time.Now().Add(24 * time.Hour).Unix()
    username := fmt.Sprintf("%d:%s", timestamp, userDID)
    
    mac := hmac.New(sha1.New, []byte(t.authSecret))
    mac.Write([]byte(username))
    password := base64.StdEncoding.EncodeToString(mac.Sum(nil))
    
    return &TURNCredentials{
        Username: username,
        Password: password,
    }
}

type ICEServer struct {
    URLs       []string `json:"urls"`
    Username   string   `json:"username,omitempty"`
    Credential string   `json:"credential,omitempty"`
}

type TURNCredentials struct {
    Username string
    Password string
}
```

**Features**:
- RFC 5766 compliant TURN relay
- **ICE servers configuration API** (`/api/v1/turn/ice-servers`)
- HMAC-based credential generation
- Auto-discovery of STUN SubServer
- Optional public STUN fallback

---

## 🔧 Station Implementation (Detailed)

### 现有代码分析

Station 端已有:
- `station/frame/core/plugin/native/subserver/turn/turn.go` - TURN SubServer 基本实现
- `station/frame/core/server/subserver.go` - Subserver 接口定义

**需要修改**:
1. TURN SubServer 添加 `Handlers()` 返回 ICE API
2. 添加 `ice_handler.go` 实现 ICE API
3. 新建 STUN SubServer

---

### 1. TURN SubServer 增强 - ice_handler.go

**文件**: `station/frame/core/plugin/native/subserver/turn/ice_handler.go`

```go
package turn

import (
    "crypto/hmac"
    "crypto/sha1"
    "encoding/base64"
    "encoding/json"
    "fmt"
    "net/http"
    "time"

    "github.com/peers-labs/peers-touch/station/frame/core/server"
)

type ICEServer struct {
    URLs       []string `json:"urls"`
    Username   string   `json:"username,omitempty"`
    Credential string   `json:"credential,omitempty"`
}

type TURNCredentials struct {
    Username string
    Password string
}

func (s *SubServer) Handlers() []server.Handler {
    return []server.Handler{
        server.NewHandler(
            server.NewRouterURL("/api/v1/turn/ice-servers", http.MethodGet),
            http.HandlerFunc(s.handleGetICEServers),
        ),
    }
}

func (s *SubServer) handleGetICEServers(w http.ResponseWriter, r *http.Request) {
    userDID := r.URL.Query().Get("user_did")
    
    servers := []ICEServer{}
    
    if s.opts.PublicIP != "" {
        creds := s.GenerateCredentials(userDID)
        servers = append(servers, ICEServer{
            URLs: []string{
                fmt.Sprintf("turn:%s:%d?transport=udp", s.opts.PublicIP, s.opts.Port),
                fmt.Sprintf("turn:%s:%d?transport=tcp", s.opts.PublicIP, s.opts.Port),
            },
            Username:   creds.Username,
            Credential: creds.Password,
        })
        
        servers = append(servers, ICEServer{
            URLs: []string{fmt.Sprintf("stun:%s:%d", s.opts.PublicIP, s.opts.Port)},
        })
    }
    
    servers = append(servers, ICEServer{
        URLs: []string{"stun:stun.l.google.com:19302"},
    })
    
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]interface{}{
        "ice_servers": servers,
    })
}

func (s *SubServer) GenerateCredentials(userDID string) *TURNCredentials {
    if s.opts.AuthSecret == "" {
        return &TURNCredentials{Username: userDID, Password: userDID}
    }
    
    timestamp := time.Now().Add(24 * time.Hour).Unix()
    username := fmt.Sprintf("%d:%s", timestamp, userDID)
    
    mac := hmac.New(sha1.New, []byte(s.opts.AuthSecret))
    mac.Write([]byte(username))
    password := base64.StdEncoding.EncodeToString(mac.Sum(nil))
    
    return &TURNCredentials{
        Username: username,
        Password: password,
    }
}
```

---

### 2. 修改 turn.go - 删除空 Handlers

**文件**: `station/frame/core/plugin/native/subserver/turn/turn.go`

**修改前**:
```go
// Handlers returns HTTP handlers (none for TURN).
func (s *SubServer) Handlers() []server.Handler { return nil }
```

**修改后**: 删除此方法,使用 `ice_handler.go` 中的实现。

---

### 3. 目录结构

```
station/frame/core/plugin/native/subserver/
├── turn/
│   ├── turn.go           # TURN 服务核心实现
│   ├── ice_handler.go    # 新增: ICE API Handler
│   ├── options.go        # 配置选项
│   ├── plugin.go         # 插件注册
│   └── logger.go         # 日志
└── stun/                  # 可选: 独立 STUN SubServer
    ├── stun.go
    └── options.go
```

---

### 4. 配置加载

**文件**: `station/frame/core/plugin/native/subserver/turn/plugin.go`

确保配置从 YAML 正确加载:

```go
func init() {
    server.RegisterSubServer("turn", func(opts ...option.Option) server.Subserver {
        return NewTurnSubServer(opts...)
    })
}
```

---

**API Response Example**:
```json
GET /api/v1/turn/ice-servers?user_did=did:peers:alice

{
  "ice_servers": [
    {
      "urls": ["stun:my-station.com:3478"]
    },
    {
      "urls": ["turn:my-station.com:3478?transport=udp", "turn:my-station.com:3478?transport=tcp"],
      "username": "1705708800:did:peers:alice",
      "credential": "hmac_generated_credential"
    },
    {
      "urls": ["stun:stun.l.google.com:19302"]
    }
  ]
}
```

---

## 🔄 ICE Connection Flow

### Client P2P Connection Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Client P2P Connection Flow                               │
└─────────────────────────────────────────────────────────────────────────────┘

Phase 1: Get ICE Configuration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─────────────────────┐
│ Application Layer   │         
│ (Chat, Voice, etc.) │         
└─────────────────────┘         
         ↓
┌─────────────────────┐
│ Client ICE Service  │  ────→  GET /api/v1/turn/ice-servers
└─────────────────────┘         Returns: STUN/TURN servers + credentials
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

## 📦 Station Integration (main.go)

**简化设计** - 无需独立的 ICE 层,STUN/TURN 通过 blank import 自动注册:

```go
// station/app/main.go
package main

import (
    "context"
    
    peers "github.com/peers-labs/peers-touch/station/frame"
    "github.com/peers-labs/peers-touch/station/frame/core/node"
    
    // 自动注册 STUN/TURN SubServers (TURN 提供 ICE API)
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
        // STUN/TURN 通过 blank import 自动注册
        // TURN SubServer 自动提供 /api/v1/turn/ice-servers API
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

**关键点:**
- ✅ main.go 保持干净,只需 blank import
- ✅ STUN/TURN 通过 `init()` 自动注册
- ✅ TURN SubServer 自动提供 `/api/v1/turn/ice-servers` API
- ✅ TURN 在 Init 时自动发现 STUN (通过 `Type()` 匹配)

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
# TURN Server Configuration (also provides ICE API)

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
          # ICE API 配置 (TURN 提供)
          ice-api:
            public-fallback:
              enabled: true
              stun-servers:
                - stun:stun.l.google.com:19302
```

### peers.yml (includes)

在主配置文件中引入 STUN/TURN 配置:

```yaml
# station/app/conf/peers.yml

peers:
  version: 0.0.1
  includes: store.yml, log.yml, actor.yml, sub_bootstrap.yml, sub_stun.yml, sub_turn.yml
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

## 🔌 Client Integration (Detailed Implementation)

### 现有代码分析

客户端已有以下基础设施:
- `network/core/stun/stun_client.dart` - STUN 客户端实现
- `network/rtc/rtc_client.dart` - WebRTC 客户端 (ICE 服务器硬编码)
- `network/libp2p/` - 完整的 libp2p 实现

**需要修改**: `RTCClient` 中硬编码的 ICE 服务器改为从 Station API 获取。

---

### 1. IceService - ICE 服务器配置获取

**文件**: `client/common/peers_touch_base/lib/network/ice/ice_service.dart`

```dart
import 'package:peers_touch_base/network/dio/http_service.dart';

class IceService {
  final HttpService _httpService;
  List<IceServer>? _cachedServers;
  DateTime? _cacheTime;
  static const _cacheDuration = Duration(minutes: 5);
  
  IceService(this._httpService);
  
  Future<List<IceServer>> getICEServers({bool forceRefresh = false}) async {
    if (!forceRefresh && _cachedServers != null && _cacheTime != null) {
      if (DateTime.now().difference(_cacheTime!) < _cacheDuration) {
        return _cachedServers!;
      }
    }
    
    try {
      final response = await _httpService.get('/api/v1/turn/ice-servers');
      final List<dynamic> serversJson = response['ice_servers'] ?? [];
      _cachedServers = serversJson.map((json) => IceServer.fromJson(json)).toList();
      _cacheTime = DateTime.now();
      return _cachedServers!;
    } catch (e) {
      if (_cachedServers != null) {
        return _cachedServers!;
      }
      return _getPublicFallback();
    }
  }
  
  List<IceServer> _getPublicFallback() {
    return [
      IceServer(urls: ['stun:stun.l.google.com:19302']),
      IceServer(urls: ['stun:stun.qq.com:3478']),
    ];
  }
}
```

---

### 2. IceServer Model

**文件**: `client/common/peers_touch_base/lib/network/ice/ice_server.dart`

```dart
class IceServer {
  final List<String> urls;
  final String? username;
  final String? credential;
  
  IceServer({required this.urls, this.username, this.credential});
  
  factory IceServer.fromJson(Map<String, dynamic> json) {
    return IceServer(
      urls: List<String>.from(json['urls'] ?? []),
      username: json['username'],
      credential: json['credential'],
    );
  }
  
  Map<String, dynamic> toJson() {
    return {
      'urls': urls,
      if (username != null) 'username': username,
      if (credential != null) 'credential': credential,
    };
  }
  
  Map<String, dynamic> toRTCIceServer() => toJson();
  
  bool get isSTUN => urls.any((u) => u.startsWith('stun:'));
  bool get isTURN => urls.any((u) => u.startsWith('turn:'));
}
```

---

### 3. 修改 RTCClient - 使用动态 ICE 配置

**文件**: `client/common/peers_touch_base/lib/network/rtc/rtc_client.dart`

**修改前** (硬编码):
```dart
Future<void> _createPC(String sessionId) async {
  final config = {
    'iceServers': [
      {'urls': ['stun:stun.l.google.com:19302']},  // 硬编码
      {'urls': ['stun:stun.qq.com:3478']},
    ]
  };
  _pc = await _pcFactory(config);
}
```

**修改后** (动态获取):
```dart
class RTCClient {
  final RTCSignalingService signaling;
  final IceService _iceService;  // 新增
  final String role;
  final String peerId;
  final PeerConnectionFactory _pcFactory;

  RTCClient(
    this.signaling, {
    required IceService iceService,  // 新增
    required this.role,
    required this.peerId,
    PeerConnectionFactory? pcFactory,
  }) : _iceService = iceService,
       _pcFactory = pcFactory ?? createPeerConnection;

  Future<void> _createPC(String sessionId) async {
    final iceServers = await _iceService.getICEServers();
    
    final config = {
      'iceServers': iceServers.map((s) => s.toRTCIceServer()).toList(),
    };
    
    _pc = await _pcFactory(config);
    
    _iceServerUrls = iceServers
        .expand((s) => s.urls)
        .toList();
    
    // ... 其余代码不变
  }
}
```

---

### 4. 依赖注入配置

**文件**: `client/common/peers_touch_base/lib/context/default_global_context.dart`

```dart
void _registerServices() {
  final httpService = Get.find<HttpService>();
  
  Get.lazyPut<IceService>(() => IceService(httpService));
}
```

---

### 5. 目录结构

```
client/common/peers_touch_base/lib/network/
├── ice/                          # 新增目录
│   ├── ice_service.dart          # ICE 服务器配置获取
│   └── ice_server.dart           # ICE Server 模型
├── rtc/
│   ├── rtc_client.dart           # 修改: 使用 IceService
│   └── rtc_signaling.dart
└── core/
    └── stun/                     # 已有: 底层 STUN 客户端
        └── stun_client.dart
```

---

### 6. 使用示例

```dart
// 在 FriendChatController 中使用
class FriendChatController extends GetxController {
  late final RTCClient _rtcClient;
  
  @override
  void onInit() {
    super.onInit();
    
    final iceService = Get.find<IceService>();
    final signaling = Get.find<RTCSignalingService>();
    
    _rtcClient = RTCClient(
      signaling,
      iceService: iceService,
      role: 'desktop',
      peerId: currentUserDID,
    );
  }
  
  Future<void> callFriend(String friendDID) async {
    await _rtcClient.call(friendDID);
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

## 🚀 Implementation Roadmap (Detailed)

### Phase 1: Station ICE API (1-2 天)

**任务清单**:

| # | 任务 | 文件 | 预计时间 |
|---|------|------|----------|
| 1.1 | 创建 `ice_handler.go` | `turn/ice_handler.go` | 2h |
| 1.2 | 实现 `handleGetICEServers` | `turn/ice_handler.go` | 1h |
| 1.3 | 实现 `GenerateCredentials` | `turn/ice_handler.go` | 1h |
| 1.4 | 删除 `turn.go` 中的空 `Handlers()` | `turn/turn.go` | 10m |
| 1.5 | 更新 `sub_turn.yml` 配置 | `conf/sub_turn.yml` | 30m |
| 1.6 | 测试 API 端点 | - | 1h |

**验收标准**:
```bash
curl http://localhost:8080/api/v1/turn/ice-servers?user_did=did:peers:alice

# 预期响应:
{
  "ice_servers": [
    {"urls": ["turn:1.2.3.4:3478?transport=udp", "turn:1.2.3.4:3478?transport=tcp"], "username": "...", "credential": "..."},
    {"urls": ["stun:1.2.3.4:3478"]},
    {"urls": ["stun:stun.l.google.com:19302"]}
  ]
}
```

---

### Phase 2: Client Integration (1-2 天)

**任务清单**:

| # | 任务 | 文件 | 预计时间 |
|---|------|------|----------|
| 2.1 | 创建 `ice/` 目录 | `network/ice/` | 10m |
| 2.2 | 实现 `IceServer` 模型 | `ice/ice_server.dart` | 30m |
| 2.3 | 实现 `IceService` | `ice/ice_service.dart` | 1h |
| 2.4 | 修改 `RTCClient` 构造函数 | `rtc/rtc_client.dart` | 30m |
| 2.5 | 修改 `_createPC` 方法 | `rtc/rtc_client.dart` | 30m |
| 2.6 | 注册 `IceService` 到 GetX | `context/` | 30m |
| 2.7 | 端到端测试 | - | 2h |

**验收标准**:
- RTCClient 使用 Station 返回的 ICE 服务器
- P2P 连接可以成功建立
- 日志显示使用了正确的 ICE 服务器

---

### Phase 3: Testing & Optimization (1 周)

**测试场景**:

| 场景 | 测试内容 | 预期结果 |
|------|----------|----------|
| 同一局域网 | host candidate | 直连成功 |
| 不同网络 (Full Cone NAT) | srflx candidate | STUN 穿透成功 |
| 对称 NAT | relay candidate | TURN 中继成功 |
| Station 不可用 | fallback | 使用公共 STUN |

**性能指标**:
- ICE API 响应时间 < 100ms
- P2P 连接建立时间 < 5s
- TURN 中继延迟 < 200ms

---

### 文件变更清单

**Station (Go)**:
```
station/frame/core/plugin/native/subserver/turn/
├── turn.go           # 修改: 删除空 Handlers()
├── ice_handler.go    # 新增: ICE API 实现
└── options.go        # 无变更

station/app/conf/
└── sub_turn.yml      # 修改: 添加 ICE 配置
```

**Client (Dart)**:
```
client/common/peers_touch_base/lib/network/
├── ice/                      # 新增目录
│   ├── ice_service.dart      # 新增
│   └── ice_server.dart       # 新增
├── rtc/
│   └── rtc_client.dart       # 修改: 使用 IceService
└── ...
```

---

### Phase 4: Advanced Features (Future)

- [ ] IPv6 支持
- [ ] 移动网络优化
- [ ] 凭证轮换
- [ ] 速率限制

### Phase 5: Federation Support (Future)

- [ ] Station-to-Station P2P
- [ ] DHT-based Station 发现
- [ ] Home Server NAT 穿透

**Note**: Phase 4-5 为未来扩展,MVP 只需完成 Phase 1-3。

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
- `docs/global/architecture.md` - Overall architecture
- `docs/station/base.md` - Station architecture
- `docs/context/architecture/friend-chat-architecture.md` - Friend chat design

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
