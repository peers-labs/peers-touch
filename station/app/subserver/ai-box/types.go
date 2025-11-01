package aibox

import (
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/pgvector/pgvector-go" // PostgreSQL向量扩展支持
)

// Agent represents an AI agent configuration (optimized for LobeChat-like design)
type Agent struct {
	ID          string    `json:"id" gorm:"primaryKey;type:text"`
	Name        string    `json:"name" gorm:"not null;type:text;index"`
	Description string    `json:"description" gorm:"type:text"`
	Avatar      string    `json:"avatar" gorm:"type:text"` // 头像URL
	IsActive    bool      `json:"is_active" gorm:"default:true;index"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// AgentConfiguration stores detailed agent configuration (分离设计，类似LobeChat)
type AgentConfiguration struct {
	AgentID      string                 `json:"agent_id" gorm:"primaryKey;type:text"`
	Model        string                 `json:"model" gorm:"not null;type:text;index"`    // e.g., "gpt-4", "claude-3"
	Provider     string                 `json:"provider" gorm:"not null;type:text;index"` // e.g., "openai", "anthropic"
	APIKey       string                 `json:"-" gorm:"column:api_key;type:text"`
	SystemPrompt string                 `json:"system_prompt" gorm:"type:text"`
	Temperature  float32                `json:"temperature" gorm:"default:0.7"`
	MaxTokens    int                    `json:"max_tokens" gorm:"default:2048"`
	Settings     map[string]interface{} `json:"settings" gorm:"serializer:json;type:jsonb"` // PostgreSQL JSONB类型
	CreatedAt    time.Time              `json:"created_at"`
	UpdatedAt    time.Time              `json:"updated_at"`
}

// Conversation represents a chat conversation (optimized for性能)
type Conversation struct {
	ID        string    `json:"id" gorm:"primaryKey;type:text"`
	AgentID   string    `json:"agent_id" gorm:"not null;type:text;index:idx_agent_created"`
	Title     string    `json:"title" gorm:"type:text"`
	PeerID    peer.ID   `json:"peer_id" gorm:"type:text"`
	IsActive  bool      `json:"is_active" gorm:"default:true;index"`
	CreatedAt time.Time `json:"created_at" gorm:"index:idx_agent_created"`
	UpdatedAt time.Time `json:"updated_at" gorm:"index"`
}

// Message represents a single message in a conversation (optimized for批量查询)
type Message struct {
	ID             string    `json:"id" gorm:"primaryKey;type:text"`
	ConversationID string    `json:"conversation_id" gorm:"not null;type:text;index:idx_conv_created"`
	Role           string    `json:"role" gorm:"not null;type:text;index"` // "user", "assistant", "system"
	Content        string    `json:"content" gorm:"type:text;not null"`
	TokenCount     int       `json:"token_count" gorm:"default:0"`
	Model          string    `json:"model" gorm:"type:text;index"`
	CreatedAt      time.Time `json:"created_at" gorm:"index:idx_conv_created"`
}

// ChatRequest represents a chat request
type ChatRequest struct {
	AgentID        string                 `json:"agent_id" binding:"required"`
	Message        string                 `json:"message" binding:"required"`
	ConversationID string                 `json:"conversation_id,omitempty"`
	Context        map[string]interface{} `json:"context,omitempty"`
	Stream         bool                   `json:"stream,omitempty"`
	Temperature    float32                `json:"temperature,omitempty"`
	MaxTokens      int                    `json:"max_tokens,omitempty"`
}

// ChatResponse represents a chat response
type ChatResponse struct {
	MessageID      string                 `json:"message_id"`
	ConversationID string                 `json:"conversation_id"`
	Content        string                 `json:"content"`
	Role           string                 `json:"role"`
	Model          string                 `json:"model"`
	TokenCount     int                    `json:"token_count"`
	Metadata       map[string]interface{} `json:"metadata,omitempty"`
	Timestamp      time.Time              `json:"timestamp"`
}

// AgentStats represents agent usage statistics (可选，用于分析)
type AgentStats struct {
	AgentID            string    `json:"agent_id" gorm:"primaryKey;type:text"`
	TotalConversations int64     `json:"total_conversations" gorm:"default:0"`
	TotalMessages      int64     `json:"total_messages" gorm:"default:0"`
	TotalTokens        int64     `json:"total_tokens" gorm:"default:0"`
	LastUsed           time.Time `json:"last_used" gorm:"index"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

// KnowledgeBase represents a knowledge base for RAG (类似LobeChat的知识库设计)
type KnowledgeBase struct {
	ID          string                 `json:"id" gorm:"primaryKey;type:text"`
	Name        string                 `json:"name" gorm:"not null;type:text;index"`
	Description string                 `json:"description" gorm:"type:text"`
	Type        string                 `json:"type" gorm:"not null;type:text;index"`     // "vector", "graph", "hybrid"
	Config      map[string]interface{} `json:"config" gorm:"serializer:json;type:jsonb"` // PostgreSQL JSONB
	IsActive    bool                   `json:"is_active" gorm:"default:true;index"`
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
}

// AgentKnowledgeBase represents many-to-many relationship
type AgentKnowledgeBase struct {
	AgentID         string    `json:"agent_id" gorm:"primaryKey;type:text"`
	KnowledgeBaseID string    `json:"knowledge_base_id" gorm:"primaryKey;type:text"`
	Priority        int       `json:"priority" gorm:"default:1;index"`
	CreatedAt       time.Time `json:"created_at"`
}

// Document represents a document in knowledge base (支持pgvector)
type Document struct {
	ID              string                 `json:"id" gorm:"primaryKey;type:text"`
	KnowledgeBaseID string                 `json:"knowledge_base_id" gorm:"not null;type:text;index"`
	Title           string                 `json:"title" gorm:"type:text;index"`
	Content         string                 `json:"content" gorm:"type:text"`
	ContentType     string                 `json:"content_type" gorm:"default:text;type:text"`
	Metadata        map[string]interface{} `json:"metadata" gorm:"serializer:json;type:jsonb"`
	VectorID        string                 `json:"vector_id" gorm:"type:text;index"`   // 用于pgvector关联
	Embedding       pgvector.Vector        `json:"embedding" gorm:"type:vector(1536)"` // OpenAI embedding维度
	CreatedAt       time.Time              `json:"created_at"`
	UpdatedAt       time.Time              `json:"updated_at"`
}

// Plugin represents an AI agent plugin
type Plugin struct {
	ID          string                 `json:"id" gorm:"primaryKey;type:text"`
	Name        string                 `json:"name" gorm:"not null;type:text;index"`
	Description string                 `json:"description" gorm:"type:text"`
	Version     string                 `json:"version" gorm:"type:text"`
	Author      string                 `json:"author" gorm:"type:text"`
	Repository  string                 `json:"repository" gorm:"type:text"`
	Config      map[string]interface{} `json:"config" gorm:"serializer:json;type:jsonb"`
	IsEnabled   bool                   `json:"is_enabled" gorm:"default:true;index"`
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
}

// AgentPlugin represents many-to-many relationship with config
type AgentPlugin struct {
	AgentID   string                 `json:"agent_id" gorm:"primaryKey;type:text"`
	PluginID  string                 `json:"plugin_id" gorm:"primaryKey;type:text"`
	Config    map[string]interface{} `json:"config" gorm:"serializer:json;type:jsonb"`
	IsActive  bool                   `json:"is_active" gorm:"default:true;index"`
	CreatedAt time.Time              `json:"created_at"`
	UpdatedAt time.Time              `json:"updated_at"`
}

// Model represents an AI model configuration
type Model struct {
	ID           string                 `json:"id" gorm:"primaryKey;type:text"`
	Name         string                 `json:"name" gorm:"not null;type:text;index"`
	Provider     string                 `json:"provider" gorm:"not null;type:text;index"`
	ModelID      string                 `json:"model_id" gorm:"not null;type:text;index"`
	Description  string                 `json:"description" gorm:"type:text"`
	Capabilities []string               `json:"capabilities" gorm:"serializer:json;type:jsonb"`
	MaxTokens    int                    `json:"max_tokens" gorm:"default:4096"`
	Pricing      map[string]interface{} `json:"pricing" gorm:"serializer:json;type:jsonb"`
	IsActive     bool                   `json:"is_active" gorm:"default:true;index"`
	CreatedAt    time.Time              `json:"created_at"`
	UpdatedAt    time.Time              `json:"updated_at"`
}

// User represents a user (可选，用于多用户支持)
type User struct {
	ID        string                 `json:"id" gorm:"primaryKey;type:text"`
	Username  string                 `json:"username" gorm:"not null;type:text;uniqueIndex"`
	Email     string                 `json:"email" gorm:"type:text;uniqueIndex"`
	Avatar    string                 `json:"avatar" gorm:"type:text"`
	IsActive  bool                   `json:"is_active" gorm:"default:true;index"`
	Settings  map[string]interface{} `json:"settings" gorm:"serializer:json;type:jsonb"`
	CreatedAt time.Time              `json:"created_at"`
	UpdatedAt time.Time              `json:"updated_at"`
}

// UserAgent represents user's agents (多用户支持)
type UserAgent struct {
	UserID    string    `json:"user_id" gorm:"primaryKey;type:text"`
	AgentID   string    `json:"agent_id" gorm:"primaryKey;type:text"`
	Role      string    `json:"role" gorm:"type:text;index"` // "owner", "editor", "viewer"
	CreatedAt time.Time `json:"created_at"`
}
