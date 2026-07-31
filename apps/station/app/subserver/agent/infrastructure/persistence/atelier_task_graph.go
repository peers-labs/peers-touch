package persistence

import "time"

// AtelierTaskGraphNode stores Station-owned TaskGraph node query records.
type AtelierTaskGraphNode struct {
	NodeID          string    `gorm:"primaryKey;type:varchar(64)"`
	TaskID          string    `gorm:"not null;type:varchar(36);index:idx_agent_atelier_task_graph_nodes_task"`
	MilestoneID     string    `gorm:"type:varchar(64);index:idx_agent_atelier_task_graph_nodes_milestone"`
	Title           string    `gorm:"type:text"`
	State           string    `gorm:"type:varchar(32);index:idx_agent_atelier_task_graph_nodes_state"`
	AgentRole       string    `gorm:"type:varchar(64);index:idx_agent_atelier_task_graph_nodes_role"`
	ArtifactIDsJSON string    `gorm:"type:text"`
	GateIDsJSON     string    `gorm:"type:text"`
	SourceEventID   string    `gorm:"type:varchar(36);index:idx_agent_atelier_task_graph_nodes_event"`
	SourceEventSeq  int64     `gorm:"not null;default:0;index:idx_agent_atelier_task_graph_nodes_event_seq"`
	PayloadJSON     string    `gorm:"type:text"`
	CreatedAt       time.Time `gorm:"not null;autoCreateTime;index:idx_agent_atelier_task_graph_nodes_created"`
	UpdatedAt       time.Time `gorm:"not null;autoUpdateTime;index:idx_agent_atelier_task_graph_nodes_updated"`
}

func (AtelierTaskGraphNode) TableName() string { return "agent_atelier_task_graph_nodes" }

// AtelierTaskGraphEdge stores Station-owned TaskGraph dependency query records.
type AtelierTaskGraphEdge struct {
	EdgeID         string    `gorm:"primaryKey;type:varchar(160)"`
	TaskID         string    `gorm:"not null;type:varchar(36);index:idx_agent_atelier_task_graph_edges_task"`
	FromID         string    `gorm:"type:varchar(64);index:idx_agent_atelier_task_graph_edges_from"`
	ToID           string    `gorm:"type:varchar(64);index:idx_agent_atelier_task_graph_edges_to"`
	Type           string    `gorm:"type:varchar(32);index:idx_agent_atelier_task_graph_edges_type"`
	SourceEventID  string    `gorm:"type:varchar(36);index:idx_agent_atelier_task_graph_edges_event"`
	SourceEventSeq int64     `gorm:"not null;default:0;index:idx_agent_atelier_task_graph_edges_event_seq"`
	PayloadJSON    string    `gorm:"type:text"`
	CreatedAt      time.Time `gorm:"not null;autoCreateTime;index:idx_agent_atelier_task_graph_edges_created"`
	UpdatedAt      time.Time `gorm:"not null;autoUpdateTime;index:idx_agent_atelier_task_graph_edges_updated"`
}

func (AtelierTaskGraphEdge) TableName() string { return "agent_atelier_task_graph_edges" }
