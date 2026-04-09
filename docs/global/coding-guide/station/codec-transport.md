# Station 编解码与传输层指南

> 源码位置: `apps/station/frame/core/codec/`, `apps/station/frame/core/server/serializer.go`, `apps/station/frame/core/server/negotiator.go`, `apps/station/frame/core/transport/`

---

## 1. 架构概览

Station 的编解码和传输体系分为三层:

```
客户端请求 (Content-Type: application/json 或 application/protobuf)
       │
       ▼
  ContentNegotiator  ← 根据 Content-Type 选择 Serializer
       │
       ├── JSONSerializer   (encoding/json)
       └── ProtoSerializer  (google.golang.org/protobuf/proto)
       │
       ▼
  Codec 层 (底层读写抽象, 面向 io.ReadWriteCloser)
       │
       ├── codec.Codec     (Reader + Writer + Close)
       └── codec.Marshaler (纯 Marshal/Unmarshal, 用于 broker/transport)
       │
       ▼
  Transport 层 (面向连接的同步通信抽象)
       │
       ├── Dial / Listen
       ├── Socket (Send/Recv)
       └── 支持 http, grpc, quic 等实现
```

---

## 2. Codec 接口

> 源码: `frame/core/codec/codec.go`

### 2.1 核心类型

```go
// 内容类型常量
type CodecContentType = string

var (
    CodecContentTypeJSON     CodecContentType = "application/json"
    CodecContentTypeProtobuf CodecContentType = "application/protobuf"
)

// 全局 Codec 注册表: ContentType → NewCodec 工厂函数
var Codecs = make(map[CodecContentType]NewCodec)

// 工厂函数签名
type NewCodec func(io.ReadWriteCloser) Codec
```

### 2.2 Message 结构体

Codec 层的消息载体, 用于 RPC 风格的头信息传递:

```go
type Message struct {
    Header   map[string]string
    Id       string
    Target   string
    Method   string
    Endpoint string
    Error    string
    Body     []byte
    Type     MessageType
}
```

### 2.3 Codec 接口

```go
type Reader interface {
    ReadHeader(*Message, MessageType) error
    ReadBody(interface{}) error
}

type Writer interface {
    Write(*Message, interface{}) error
}

type Codec interface {
    Reader
    Writer
    Close() error
    String() string
}
```

- `Reader`: 分两步读取 — 先读头 (`ReadHeader`), 再读体 (`ReadBody`)
- `Writer`: 一次写入, 同时传入消息元信息和消息体
- `Codec`: 组合了读、写、关闭能力, 绑定到一个 `io.ReadWriteCloser` 连接

### 2.4 Marshaler 接口

用于 broker/transport 等不支持头信息的场景, 纯字节序列化:

```go
type Marshaler interface {
    Marshal(interface{}) ([]byte, error)
    Unmarshal([]byte, interface{}) error
    String() string
}
```

---

## 3. Proto Codec 实现

> 源码: `frame/core/codec/proto/`

### 3.1 Codec 注册 (proto.go)

```go
func init() {
    // 通过 init() 自动注册到全局 Codecs 表
    codec.Codecs[codec.CodecContentTypeJSON] = NewCodec
}

func NewCodec(c io.ReadWriteCloser) codec.Codec {
    return &Codec{Conn: c}
}
```

Proto Codec 绑定到一个 `io.ReadWriteCloser`, 通过 `ReadBody` 从连接中读取全部字节并 `proto.Unmarshal`, 通过 `Write` 将 `proto.Marshal` 后的字节写入连接:

```go
func (c *Codec) ReadBody(b interface{}) error {
    if b == nil {
        return nil
    }
    buf, err := io.ReadAll(c.Conn)
    if err != nil {
        return err
    }
    m, ok := b.(proto.Message)
    if !ok {
        return codec.ErrInvalidMessage
    }
    return proto.Unmarshal(buf, m)
}

func (c *Codec) Write(m *codec.Message, b interface{}) error {
    if b == nil {
        return nil
    }
    p, ok := b.(proto.Message)
    if !ok {
        return codec.ErrInvalidMessage
    }
    buf, err := proto.Marshal(p)
    if err != nil {
        return err
    }
    _, err = c.Conn.Write(buf)
    return err
}
```

### 3.2 Marshaler — 带缓冲池的序列化 (marshaler.go)

```go
// 创建含 16 个实例、每个预分配 256 字节的缓冲池
var bufferPool = bpool.NewSizedBufferPool(16, 256)

type Marshaler struct{}

func (Marshaler) Marshal(v interface{}) ([]byte, error) {
    pb, ok := v.(proto.Message)
    if !ok {
        return nil, codec.ErrInvalidMessage
    }
    buf := bufferPool.Get()
    pbuf := proto.NewBuffer(buf.Bytes())
    defer func() {
        bufferPool.Put(bytes.NewBuffer(pbuf.Bytes()))
    }()
    if err := pbuf.Marshal(pb); err != nil {
        return nil, err
    }
    return pbuf.Bytes(), nil
}

func (Marshaler) Unmarshal(data []byte, v interface{}) error {
    pb, ok := v.(proto.Message)
    if !ok {
        return codec.ErrInvalidMessage
    }
    return proto.Unmarshal(data, pb)
}
```

关键设计: 使用 `bpool.SizedBufferPool` 复用底层 `[]byte`, 减少高频序列化场景下的 GC 压力. `Marshal` 时从池中获取缓冲, 序列化完成后归还.

### 3.3 Message 包装器 (message.go)

通用消息包装, 同时实现 `proto.Message` 和 JSON 序列化接口, 用于承载原始字节:

```go
type Message struct {
    Data []byte
}

func (m *Message) ProtoMessage()             {}
func (m *Message) Reset()                    { *m = Message{} }
func (m *Message) String() string            { return string(m.Data) }
func (m *Message) Marshal() ([]byte, error)  { return m.Data, nil }
func (m *Message) Unmarshal(data []byte) error {
    m.Data = data
    return nil
}
func (m *Message) MarshalJSON() ([]byte, error)      { return m.Data, nil }
func (m *Message) UnmarshalJSON(data []byte) error    { m.Data = data; return nil }

func NewMessage(data []byte) *Message {
    return &Message{data}
}
```

典型用途: 当你不关心消息的具体类型, 只需透传原始字节时使用.

---

## 4. Server 序列化器

> 源码: `frame/core/server/serializer.go`

### 4.1 Serializer 接口

```go
type Serializer interface {
    Marshal(v interface{}) ([]byte, error)
    Unmarshal(data []byte, v interface{}) error
    ContentType() string
}
```

与 Codec 层的 `Marshaler` 不同, `Serializer` 额外提供 `ContentType()` 方法, 用于 HTTP 响应头设置.

### 4.2 两种实现

| Serializer | ContentType | 底层依赖 | 适用类型 |
|---|---|---|---|
| `JSONSerializer` | `application/json` | `encoding/json` | 任意 Go 类型 |
| `ProtoSerializer` | `application/protobuf` | `google.golang.org/protobuf/proto` | 必须实现 `proto.Message` |

```go
// JSON — 任意类型均可序列化
type JSONSerializer struct{}

func (s *JSONSerializer) Marshal(v interface{}) ([]byte, error) {
    return json.Marshal(v)
}

func (s *JSONSerializer) Unmarshal(data []byte, v interface{}) error {
    return json.Unmarshal(data, v)
}

func (s *JSONSerializer) ContentType() string {
    return "application/json"
}

// Proto — 要求 v 实现 proto.Message, 否则返回错误
type ProtoSerializer struct{}

func (s *ProtoSerializer) Marshal(v interface{}) ([]byte, error) {
    msg, ok := v.(proto.Message)
    if !ok {
        return nil, fmt.Errorf("value is not a proto.Message, got %T", v)
    }
    return proto.Marshal(msg)
}
```

### 4.3 基于反射的自动选择

```go
func isProtoMessage(t reflect.Type) bool {
    if t.Kind() == reflect.Ptr {
        t = t.Elem()
    }
    protoMessageType := reflect.TypeOf((*proto.Message)(nil)).Elem()
    return reflect.PtrTo(t).Implements(protoMessageType)
}

func GetSerializerForType(t reflect.Type) Serializer {
    if isProtoMessage(t) {
        return &ProtoSerializer{}
    }
    return &JSONSerializer{}
}
```

`GetSerializerForType` 在 `NewTypedHandler` 注册时被调用, 根据泛型参数的类型自动决定序列化方式. 如果请求/响应类型实现了 `proto.Message`, 自动选择 `ProtoSerializer`.

---

## 5. Content Negotiation (内容协商)

> 源码: `frame/core/server/negotiator.go`

### 5.1 ContentNegotiator

```go
type ContentNegotiator struct {
    defaultSerializer Serializer // 默认 JSONSerializer
}

func NewContentNegotiator() *ContentNegotiator {
    return &ContentNegotiator{
        defaultSerializer: &JSONSerializer{},
    }
}
```

### 5.2 请求协商

根据请求的 `Content-Type` 头选择反序列化器:

```go
func (n *ContentNegotiator) GetRequestSerializer(contentType string) Serializer {
    contentType = strings.ToLower(strings.TrimSpace(contentType))

    // 去除 charset 等附加参数
    if idx := strings.Index(contentType, ";"); idx != -1 {
        contentType = strings.TrimSpace(contentType[:idx])
    }

    switch contentType {
    case "application/protobuf", "application/x-protobuf":
        return &ProtoSerializer{}
    case "application/json", "":
        return &JSONSerializer{}
    default:
        return n.defaultSerializer // 未知类型回退到 JSON
    }
}
```

协商规则:

| Content-Type | 选择的 Serializer |
|---|---|
| `application/protobuf` | `ProtoSerializer` |
| `application/x-protobuf` | `ProtoSerializer` |
| `application/json` | `JSONSerializer` |
| 空 (未设置) | `JSONSerializer` |
| 其他未知类型 | `JSONSerializer` (默认回退) |

### 5.3 响应协商

响应格式默认跟随请求格式:

```go
func (n *ContentNegotiator) GetResponseSerializer(
    contentType string,
    responseType Serializer,
) Serializer {
    contentType = strings.ToLower(strings.TrimSpace(contentType))
    if idx := strings.Index(contentType, ";"); idx != -1 {
        contentType = strings.TrimSpace(contentType[:idx])
    }

    // 请求是 protobuf, 响应也用 protobuf
    if contentType == "application/protobuf" || contentType == "application/x-protobuf" {
        return &ProtoSerializer{}
    }

    // 否则使用响应类型决定的 serializer
    if responseType != nil {
        return responseType
    }

    return n.defaultSerializer
}
```

协商优先级:
1. 请求 `Content-Type` 为 protobuf → 响应也使用 `ProtoSerializer`
2. 否则使用 `responseType` (由 `GetSerializerForType` 根据响应类型推导)
3. 都没有时回退到 `JSONSerializer`

### 5.4 完整请求处理流程

```
客户端发送请求
    │
    ├── Content-Type: application/protobuf
    │         │
    │         ▼
    │   GetRequestSerializer → ProtoSerializer
    │         │
    │         ▼
    │   ProtoSerializer.Unmarshal(body, &req)
    │         │
    │         ▼
    │   业务 handler 处理
    │         │
    │         ▼
    │   GetResponseSerializer → ProtoSerializer (跟随请求格式)
    │         │
    │         ▼
    │   ProtoSerializer.Marshal(resp) → 响应体
    │
    ├── Content-Type: application/json (或空)
    │         │
    │         ▼
    │   GetRequestSerializer → JSONSerializer
    │         │
    │         ▼
    │   ... 同上流程, 使用 JSON 编解码
```

---

## 6. Transport 传输层

> 源码: `frame/core/transport/`

### 6.1 Transport 接口

Transport 是面向连接的同步通信抽象, 为服务间通信提供统一的拨号/监听语义:

```go
type Transport interface {
    Init(...option.Option) error
    Options() Options
    Dial(addr string, opts ...DialOption) (Client, error)
    Listen(addr string, opts ...ListenOption) (Listener, error)
    String() string
}
```

| 方法 | 说明 |
|---|---|
| `Init` | 初始化传输实例 |
| `Dial` | 主动连接到指定地址, 返回 `Client` (Socket) |
| `Listen` | 在指定地址监听, 返回 `Listener` |

### 6.2 消息与 Socket

```go
type Message struct {
    Header map[string]string
    Body   []byte
}

type Socket interface {
    Recv(*Message) error
    Send(*Message) error
    Close() error
    Local() string
    Remote() string
}

type Client interface {
    Socket
}

type Listener interface {
    Addr() string
    Close() error
    Accept(func(Socket)) error
}
```

- `Message`: 传输层消息, 含头和体
- `Socket`: 双向通信抽象, 可收可发
- `Client`: Socket 的客户端视角
- `Listener`: 服务端监听器, 通过回调处理每个接入的 Socket

### 6.3 Transport Options

```go
type Options struct {
    *option.Options
    *option.ExtendOptions

    Codec     codec.Marshaler   // 编解码器 (用于无头信息支持的场景)
    Context   context.Context
    Logger    logger.Logger
    TLSConfig *tls.Config       // mTLS 配置
    Addrs     []string          // 中间地址列表
    Timeout   time.Duration     // Send/Recv 超时
    BuffSizeH2 int              // HTTP2 缓冲区大小
    Secure    bool              // 是否启用安全连接
}
```

选项函数:

```go
// 设置连接地址
transport.Addrs("127.0.0.1:8080", "127.0.0.1:8081")

// 启用安全连接
transport.Secure(true)

// 设置超时
transport.Timeout("5s")
```

### 6.4 Transport 与 Codec 的关系

Transport 的 `Options.Codec` 字段引用的是 `codec.Marshaler` 接口 (不是 `codec.Codec`). 这是因为:

- `codec.Codec` 面向流式连接 (`io.ReadWriteCloser`), 支持分步读头/读体
- `codec.Marshaler` 面向纯字节序列化, 适用于 Transport 的 `Message.Body` 编解码

```
Transport.Send(msg)
    │
    ├── msg.Header → 由传输协议原生支持 (如 HTTP headers)
    └── msg.Body   → 由 Options.Codec (Marshaler) 序列化
```

---

## 7. 实践指南

### 7.1 编写 Proto 类型的 Handler

域内应用通信推荐使用 protobuf. 使用 `NewTypedHandler` 时, 只要请求/响应类型实现了 `proto.Message`, 框架自动选择 `ProtoSerializer`:

```go
// 1. 定义 proto 消息 (proto 文件)
// message CreateEventRequest { ... }
// message CreateEventResponse { ... }

// 2. 注册 handler — 框架自动检测 proto.Message, 选择 ProtoSerializer
server.NewTypedHandler[*pb.CreateEventRequest, *pb.CreateEventResponse](
    "create-event",
    "/events/create",
    server.POST,
    handleCreateEvent,
    logIDWrapper, jwtWrapper,
)
```

客户端调用时只需设置 `Content-Type: application/protobuf` 即可使用 protobuf 编码.

### 7.2 编写 JSON Handler

普通结构体自动使用 JSON:

```go
type ListRequest struct {
    Page     int `json:"page"`
    PageSize int `json:"page_size"`
}

type ListResponse struct {
    Items []Item `json:"items"`
    Total int    `json:"total"`
}

server.NewTypedHandler[*ListRequest, *ListResponse](
    "list-items",
    "/items/list",
    server.GET,
    handleListItems,
)
```

### 7.3 自定义 Codec 注册

如需支持新的编解码格式, 实现 `codec.Codec` 接口并注册:

```go
func init() {
    codec.Codecs["application/msgpack"] = func(rwc io.ReadWriteCloser) codec.Codec {
        return &MsgpackCodec{Conn: rwc}
    }
}
```

### 7.4 在 Transport 中使用 Marshaler

```go
import (
    "github.com/peers-labs/peers-touch/station/frame/core/transport"
    protoCodec "github.com/peers-labs/peers-touch/station/frame/core/codec/proto"
)

// 创建传输实例时注入 Proto Marshaler
opts := []option.Option{
    transport.Addrs("127.0.0.1:9000"),
    transport.Timeout("10s"),
}
// Options.Codec = protoCodec.Marshaler{} 用于 Message.Body 的编解码
```
