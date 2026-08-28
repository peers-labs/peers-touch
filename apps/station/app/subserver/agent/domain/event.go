package domain

import (
	"context"
	"time"
)

type EventHandler func(ctx context.Context, event DomainEvent) error

type EventBus interface {
	Publish(ctx context.Context, event DomainEvent) error
	Subscribe(eventType string, handler EventHandler)
	SubscribeAll(handler EventHandler)
	Unsubscribe(eventType string, handler EventHandler)
}

type DomainEvent struct {
	EventID    string
	EventType  string
	OccurredAt time.Time
	ActorID    string
	Payload    interface{}
	Metadata   map[string]string
}

type EventType string

const (
	EventTypeAgentCreated                    EventType = "agent.created"
	EventTypeAgentUpdated                    EventType = "agent.updated"
	EventTypeAgentDeleted                    EventType = "agent.deleted"
	EventTypeAgentAuthorityInvalidated       EventType = "agent.authority.invalidated"
	EventTypeAgentConfigUpdated              EventType = "agent.config.updated"
	EventTypeAgentMemoryCreated              EventType = "agent.memory.created"
	EventTypeAgentMemoryUpdated              EventType = "agent.memory.updated"
	EventTypeAgentSkillInstalled             EventType = "agent.skill.installed"
	EventTypeAgentSkillUpdated               EventType = "agent.skill.updated"
	EventTypeAgentTurnStarted                EventType = "agent.turn.started"
	EventTypeAgentTurnCompleted              EventType = "agent.turn.completed"
	EventTypeAgentTurnFailed                 EventType = "agent.turn.failed"
	EventTypeAgentTurnCancelled              EventType = "agent.turn.cancelled"
	EventTypeCollaborationTaskCreated        EventType = "agent.collaboration.task.created"
	EventTypeCollaborationTaskCompleted      EventType = "agent.collaboration.task.completed"
	EventTypeCollaborationTaskFailed         EventType = "agent.collaboration.task.failed"
	EventTypeCollaborationTaskCancelled      EventType = "agent.collaboration.task.cancelled"
	EventTypeCollaborationNodeRunning        EventType = "agent.collaboration.node.running"
	EventTypeCollaborationNodeCompleted      EventType = "agent.collaboration.node.completed"
	EventTypeCollaborationNodeFailed         EventType = "agent.collaboration.node.failed"
	EventTypeCollaborationExecutorLeased     EventType = "agent.collaboration.executor.leased"
	EventTypeCollaborationExecutorReleased   EventType = "agent.collaboration.executor.released"
	EventTypeCollaborationArtifactCreated    EventType = "agent.collaboration.artifact.created"
	EventTypeCollaborationGateResult         EventType = "agent.collaboration.gate.result"
	EventTypeCollaborationInterruptRequested EventType = "agent.collaboration.interrupt.requested"
	EventTypeCollaborationInterruptResolved  EventType = "agent.collaboration.interrupt.resolved"
	EventTypeCollaborationFeedbackRecorded   EventType = "agent.collaboration.feedback.recorded"
	EventTypeAgentGrowthFeedbackReceived     EventType = "agent.growth.feedback_received"
	EventTypeWorkspaceCreated                EventType = "agent.workspace.created"
	EventTypeWorkspaceChanged                EventType = "agent.workspace.changed"
)

type AgentAuthorityInvalidationReason string

const (
	AgentAuthorityInvalidationAgentUpdated       AgentAuthorityInvalidationReason = "agent_updated"
	AgentAuthorityInvalidationBindingUpsert      AgentAuthorityInvalidationReason = "capability_binding_upserted"
	AgentAuthorityInvalidationBindingDelete      AgentAuthorityInvalidationReason = "capability_binding_deleted"
	AgentAuthorityInvalidationManifestRegistered AgentAuthorityInvalidationReason = "capability_manifest_registered"
	AgentAuthorityInvalidationManifestRetired    AgentAuthorityInvalidationReason = "capability_manifest_retired"
)

// AgentAuthorityInvalidation tells long-lived projections which authoritative
// Agent capability state must be reloaded after a committed mutation.
type AgentAuthorityInvalidation struct {
	Reason            AgentAuthorityInvalidationReason `json:"reason"`
	AgentID           string                           `json:"agent_id"`
	AgentVersion      uint64                           `json:"agent_version"`
	BindingID         string                           `json:"binding_id,omitempty"`
	BindingRevision   uint64                           `json:"binding_revision,omitempty"`
	CapabilityID      string                           `json:"capability_id,omitempty"`
	CapabilityVersion string                           `json:"capability_version,omitempty"`
}
