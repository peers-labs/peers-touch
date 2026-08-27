package domain

import "time"

type AgentVisibility string

const (
	AgentVisibilityPrivate   AgentVisibility = "private"
	AgentVisibilityWorkspace AgentVisibility = "workspace"
)

type ThinkingMode string

const (
	ThinkingModeAuto     ThinkingMode = "auto"
	ThinkingModeEnabled  ThinkingMode = "enabled"
	ThinkingModeDisabled ThinkingMode = "disabled"
)

type Agent struct {
	AgentID      string
	Name         string
	Title        string
	Description  string
	ProviderID   string
	ModelName    string
	Effort       string
	ThinkingMode ThinkingMode
	Visibility   AgentVisibility
	OwnerActorID string
	ConfigJSON   string
	Version      int64
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type AgentListOptions struct {
	ActorID    string
	Visibility AgentVisibility
	Page       int
	PageSize   int
}

type AgentUpsertOptions struct {
	ActorID      string
	AgentID      string
	Name         string
	Title        string
	Description  string
	ProviderID   string
	ModelName    string
	Effort       string
	ThinkingMode ThinkingMode
	Visibility   AgentVisibility
	ConfigJSON   string
	Version      int64
}
