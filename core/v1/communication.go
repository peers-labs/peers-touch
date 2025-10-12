package v1

import (
	"context"
	"time"

	communicationpb "github.com/dirty-bro-tech/peers-touch-go/model/v2/communication"
	identitypb "github.com/dirty-bro-tech/peers-touch-go/model/v2/identity"
)

// MessageID represents a unique identifier for a message.
type MessageID string

// StreamID represents a unique identifier for a stream.
type StreamID string

// TopicID represents a unique identifier for a topic.
type TopicID string

// MessageType represents the type of a message.
type MessageType string

const (
	MessageTypeText   MessageType = "text"
	MessageTypeBinary MessageType = "binary"
	MessageTypeFile   MessageType = "file"
	MessageTypeMedia  MessageType = "media"
	MessageTypeSystem MessageType = "system"
)

// MessagePriority represents the priority level of a message.
type MessagePriority int

const (
	PriorityLow MessagePriority = iota
	PriorityNormal
	PriorityHigh
	PriorityCritical
)

// DeliveryMode represents how a message should be delivered.
type DeliveryMode int

const (
	DeliveryModeFireAndForget DeliveryMode = iota // No acknowledgment required
	DeliveryModeAtLeastOnce                       // Requires acknowledgment, may duplicate
	DeliveryModeExactlyOnce                       // Requires acknowledgment, no duplicates
)

// Message represents a communication message between peers.
type Message struct {
	ID           MessageID         `json:"id"`
	Type         MessageType       `json:"type"`
	From         *identitypb.IdentityID        `json:"from"`
	To           []*identitypb.IdentityID      `json:"to"`
	Subject      string            `json:"subject,omitempty"`
	Content      []byte            `json:"content"`
	Metadata     map[string]string `json:"metadata,omitempty"`
	Priority     MessagePriority   `json:"priority"`
	DeliveryMode DeliveryMode      `json:"delivery_mode"`
	CreatedAt    time.Time         `json:"created_at"`
	ExpiresAt    *time.Time        `json:"expires_at,omitempty"`
	Signature    *identitypb.Signature        `json:"signature,omitempty"`
}

// MessageStatus represents the delivery status of a message.
type MessageStatus struct {
	MessageID    MessageID  `json:"message_id"`
	Recipient    *identitypb.IdentityID `json:"recipient"`
	Status       string     `json:"status"` // "pending", "sent", "delivered", "read", "failed"
	Timestamp    time.Time  `json:"timestamp"`
	ErrorMessage string     `json:"error_message,omitempty"`
}

// StreamInfo contains metadata about a stream.
type StreamInfo struct {
	ID         StreamID   `json:"id"`
	LocalPeer  *identitypb.IdentityID `json:"local_peer"`
	RemotePeer *identitypb.IdentityID `json:"remote_peer"`
	Protocol   string     `json:"protocol"`
	CreatedAt  time.Time  `json:"created_at"`
	LastUsed   time.Time  `json:"last_used"`
	BytesSent  uint64     `json:"bytes_sent"`
	BytesRecv  uint64     `json:"bytes_recv"`
	IsActive   bool       `json:"is_active"`
}

// TopicInfo contains metadata about a topic.
type TopicInfo struct {
	ID           TopicID      `json:"id"`
	Name         string       `json:"name"`
	Description  string       `json:"description,omitempty"`
	Subscribers  []*identitypb.IdentityID `json:"subscribers"`
	Publishers   []*identitypb.IdentityID `json:"publishers"`
	CreatedAt    time.Time    `json:"created_at"`
	MessageCount uint64       `json:"message_count"`
	IsPublic     bool         `json:"is_public"`
}

// SendOptions contains options for sending messages.
type SendOptions struct {
	Priority     MessagePriority   `json:"priority,omitempty"`
	DeliveryMode DeliveryMode      `json:"delivery_mode,omitempty"`
	TTL          time.Duration     `json:"ttl,omitempty"`
	Metadata     map[string]string `json:"metadata,omitempty"`
	Encrypt      bool              `json:"encrypt,omitempty"`
	Compress     bool              `json:"compress,omitempty"`
}

// ReceiveOptions contains options for receiving messages.
type ReceiveOptions struct {
	Timeout    time.Duration `json:"timeout,omitempty"`
	MaxSize    int64         `json:"max_size,omitempty"`
	FilterType MessageType   `json:"filter_type,omitempty"`
	FilterFrom *identitypb.IdentityID    `json:"filter_from,omitempty"`
}

// StreamOptions contains options for creating streams.
type StreamOptions struct {
	Protocol      string            `json:"protocol,omitempty"`
	BufferSize    int               `json:"buffer_size,omitempty"`
	Timeout       time.Duration     `json:"timeout,omitempty"`
	Metadata      map[string]string `json:"metadata,omitempty"`
	Bidirectional bool              `json:"bidirectional,omitempty"`
}

// SubscribeOptions contains options for subscribing to topics.
type SubscribeOptions struct {
	QueueSize    int               `json:"queue_size,omitempty"`
	FilterType   MessageType       `json:"filter_type,omitempty"`
	FilterSender *identitypb.IdentityID        `json:"filter_sender,omitempty"`
	Metadata     map[string]string `json:"metadata,omitempty"`
}

// Stream represents a bidirectional communication stream.
type Stream interface {
	// GetInfo returns metadata about this stream.
	GetInfo() *communicationpb.StreamInfo
	
	// Write writes data to the stream.
	Write(ctx context.Context, req *communicationpb.WriteStreamRequest) error
	
	// Read reads data from the stream.
	Read(ctx context.Context, req *communicationpb.ReadStreamRequest) (*communicationpb.ReadStreamResponse, error)
	
	// Close closes the stream.
	Close(ctx context.Context, req *communicationpb.CloseStreamRequest) error
}

// Messenger provides message-based communication capabilities.
type Messenger interface {
	// Send sends a message to one or more recipients.
	Send(ctx context.Context, req *communicationpb.SendRequest) (*communicationpb.SendResponse, error)
	
	// Receive receives messages.
	Receive(ctx context.Context, req *communicationpb.ReceiveRequest) (*communicationpb.ReceiveResponse, error)
}

// StreamManager manages bidirectional streams between peers.
type StreamManager interface {
	// Create creates a new stream to a remote peer.
	Create(ctx context.Context, req *communicationpb.CreateStreamRequest) (*communicationpb.CreateStreamResponse, error)
	
	// Get returns a specific stream by ID.
	Get(ctx context.Context, id *communicationpb.StreamID) (Stream, error)
	
	// List returns all active streams.
	List(ctx context.Context) ([]*communicationpb.StreamInfo, error)
}

// TopicClient provides publish-subscribe communication capabilities.
type TopicClient interface {
	// Subscribe subscribes to a topic.
	Subscribe(ctx context.Context, req *communicationpb.SubscribeRequest) error
	
	// Unsubscribe unsubscribes from a topic.
	Unsubscribe(ctx context.Context, req *communicationpb.UnsubscribeRequest) error
	
	// Publish publishes a message to a topic.
	Publish(ctx context.Context, req *communicationpb.PublishRequest) (*communicationpb.PublishResponse, error)
	
	// ListTopics lists available topics.
	ListTopics(ctx context.Context, req *communicationpb.ListTopicsRequest) (*communicationpb.ListTopicsResponse, error)
}

// CommunicationManager provides comprehensive communication capabilities.
type CommunicationManager interface {
	// GetMessenger returns the messenger component.
	GetMessenger() Messenger
	
	// GetStreamManager returns the stream manager component.
	GetStreamManager() StreamManager
	
	// GetTopicClient returns the topic client component.
	GetTopicClient() TopicClient
}
