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
	EventTypeAgentCreated                  EventType = "agent.created"
	EventTypeAgentUpdated                  EventType = "agent.updated"
	EventTypeAgentDeleted                  EventType = "agent.deleted"
	EventTypeAgentConfigUpdated            EventType = "agent.config.updated"
	EventTypeAgentMemoryCreated            EventType = "agent.memory.created"
	EventTypeAgentMemoryUpdated            EventType = "agent.memory.updated"
	EventTypeAgentSkillInstalled           EventType = "agent.skill.installed"
	EventTypeAgentSkillUpdated             EventType = "agent.skill.updated"
	EventTypeAgentTurnStarted              EventType = "agent.turn.started"
	EventTypeAgentTurnCompleted            EventType = "agent.turn.completed"
	EventTypeAgentTurnFailed               EventType = "agent.turn.failed"
	EventTypeCollaborationTaskCreated      EventType = "agent.collaboration.task.created"
	EventTypeCollaborationTaskCompleted    EventType = "agent.collaboration.task.completed"
	EventTypeCollaborationTaskFailed       EventType = "agent.collaboration.task.failed"
	EventTypeCollaborationTaskCancelled    EventType = "agent.collaboration.task.cancelled"
	EventTypeCollaborationNodeRunning      EventType = "agent.collaboration.node.running"
	EventTypeCollaborationNodeCompleted    EventType = "agent.collaboration.node.completed"
	EventTypeCollaborationNodeFailed       EventType = "agent.collaboration.node.failed"
	EventTypeCollaborationExecutorLeased   EventType = "agent.collaboration.executor.leased"
	EventTypeCollaborationExecutorReleased EventType = "agent.collaboration.executor.released"
	EventTypeAgentGrowthFeedbackReceived   EventType = "agent.growth.feedback_received"
	EventTypeWorkspaceCreated              EventType = "agent.workspace.created"
	EventTypeWorkspaceChanged              EventType = "agent.workspace.changed"
)
