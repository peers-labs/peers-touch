package persistence

import "time"

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
	ID         string    `gorm:"primaryKey;type:varchar(36)"`
	AgentID    string    `gorm:"not null;type:varchar(36);index:idx_mcp_binding_agent_id"`
	ServerName string    `gorm:"not null;type:varchar(128)"`
	Enabled    bool      `gorm:"not null;default:true"`
	CreatedAt  time.Time `gorm:"not null;default:now()"`
	UpdatedAt  time.Time `gorm:"not null;default:now()"`
}

func (AgentMcpBinding) TableName() string { return "agent_mcp_bindings" }
