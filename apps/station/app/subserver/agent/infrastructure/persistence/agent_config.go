package persistence

import "time"

type AgentChatConfig struct {
	AgentID                string    `gorm:"primaryKey;type:varchar(36)"`
	HistoryCount           int32     `gorm:"not null;default:20"`
	EnableHistoryCount     bool      `gorm:"not null;default:true"`
	EnableAutoCreateTopic  bool      `gorm:"not null;default:true"`
	AutoCreateTopicThreshold int32   `gorm:"not null;default:10"`
	EnableMaxTokens        bool      `gorm:"not null;default:false"`
	EnableStreaming        bool      `gorm:"not null;default:true"`
	EnableContextCompression bool    `gorm:"not null;default:false"`
	CompressionModelID     string    `gorm:"type:text"`
	ContextWindowSize      int32     `gorm:"not null;default:4096"`
	SearchMode             string    `gorm:"not null;type:varchar(20);default:'auto'"`
	UseModelBuiltinSearch  bool      `gorm:"not null;default:false"`
	UpdatedAt              time.Time `gorm:"not null;default:now()"`
}

func (AgentChatConfig) TableName() string { return "agent_chat_configs" }

type AgentModelParams struct {
	AgentID           string    `gorm:"primaryKey;type:varchar(36)"`
	Temperature       float64   `gorm:"not null;default:0.7"`
	TopP              float64   `gorm:"not null;default:0.9"`
	FrequencyPenalty  float64   `gorm:"not null;default:0"`
	PresencePenalty   float64   `gorm:"not null;default:0"`
	MaxTokens         int32     `gorm:"not null;default:2048"`
	UpdatedAt         time.Time `gorm:"not null;default:now()"`
}

func (AgentModelParams) TableName() string { return "agent_model_params" }

type AgentKnowledgeBinding struct {
	ID         string    `gorm:"primaryKey;type:varchar(36)"`
	AgentID    string    `gorm:"not null;type:varchar(36);index:idx_kb_agent_id"`
	ResourceID string    `gorm:"not null;type:varchar(36)"`
	Policy     string    `gorm:"not null;type:varchar(20);default:'auto'"`
	Enabled    bool      `gorm:"not null;default:true"`
	CreatedAt  time.Time `gorm:"not null;default:now()"`
	UpdatedAt  time.Time `gorm:"not null;default:now()"`
}

func (AgentKnowledgeBinding) TableName() string { return "agent_knowledge_bindings" }

type AgentSkillBinding struct {
	ID        string    `gorm:"primaryKey;type:varchar(36)"`
	AgentID   string    `gorm:"not null;type:varchar(36);index:idx_skill_binding_agent_id"`
	SkillID   string    `gorm:"not null;type:varchar(36)"`
	Enabled   bool      `gorm:"not null;default:true"`
	CreatedAt time.Time `gorm:"not null;default:now()"`
	UpdatedAt time.Time `gorm:"not null;default:now()"`
}

func (AgentSkillBinding) TableName() string { return "agent_skill_bindings" }

type AgentMcpBinding struct {
	ID          string    `gorm:"primaryKey;type:varchar(36)"`
	AgentID     string    `gorm:"not null;type:varchar(36);index:idx_mcp_binding_agent_id"`
	ServerName  string    `gorm:"not null;type:varchar(128)"`
	Enabled     bool      `gorm:"not null;default:true"`
	CreatedAt   time.Time `gorm:"not null;default:now()"`
	UpdatedAt   time.Time `gorm:"not null;default:now()"`
}

func (AgentMcpBinding) TableName() string { return "agent_mcp_bindings" }

type AgentVoiceConfig struct {
	AgentID       string    `gorm:"primaryKey;type:varchar(36)"`
	TtsProvider   string    `gorm:"type:text"`
	TtsVoice      string    `gorm:"type:text"`
	TtsSpeed      float64   `gorm:"not null;default:1.0"`
	TtsAutoRead   bool      `gorm:"not null;default:false"`
	SttProvider   string    `gorm:"type:text"`
	SttLanguage   string    `gorm:"type:text"`
	SttAutoStop   bool      `gorm:"not null;default:true"`
	UpdatedAt     time.Time `gorm:"not null;default:now()"`
}

func (AgentVoiceConfig) TableName() string { return "agent_voice_configs" }

type AgentToolProfile struct {
	AgentID   string    `gorm:"primaryKey;type:varchar(36)"`
	Profile   string    `gorm:"not null;type:varchar(20);default:'balanced'"`
	Allow     string    `gorm:"type:text"`
	Deny      string    `gorm:"type:text"`
	UpdatedAt time.Time `gorm:"not null;default:now()"`
}

func (AgentToolProfile) TableName() string { return "agent_tool_profiles" }
