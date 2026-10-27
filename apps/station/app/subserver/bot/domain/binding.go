package domain

import (
	"strings"
	"time"
)

// AgentBinding binds a bot's inbound messages to a Station Agent. It is a
// distinct aggregate from Bot: the bot identity and its publishing grant
// exist without a binding, and binding changes never rewrite historical
// messages or turns.
type AgentBinding struct {
	BotPtid   string
	OwnerPtid string
	AgentID   string
	Enabled   bool
	Version   int64
	CreatedAt time.Time
	UpdatedAt time.Time
}

// NewAgentBinding opens the first binding revision (version 1).
func NewAgentBinding(
	botPtid string,
	ownerPtid string,
	agentID string,
	enabled bool,
	now time.Time,
) (*AgentBinding, error) {
	botPtid = strings.TrimSpace(botPtid)
	ownerPtid = strings.TrimSpace(ownerPtid)
	agentID = strings.TrimSpace(agentID)
	if botPtid == "" || ownerPtid == "" || agentID == "" {
		return nil, NewError(CodeInvalidArgument, "bot, owner, and agent identities are required")
	}
	at := now.UTC()
	return &AgentBinding{
		BotPtid:   botPtid,
		OwnerPtid: ownerPtid,
		AgentID:   agentID,
		Enabled:   enabled,
		Version:   1,
		CreatedAt: at,
		UpdatedAt: at,
	}, nil
}

// Rebind points the binding at another Agent, producing the next revision.
func (b *AgentBinding) Rebind(agentID string, enabled bool, now time.Time) error {
	agentID = strings.TrimSpace(agentID)
	if agentID == "" {
		return NewError(CodeInvalidArgument, "agent identity is required")
	}
	b.AgentID = agentID
	b.Enabled = enabled
	b.Version++
	b.UpdatedAt = now.UTC()
	return nil
}

// SetEnabled toggles automatic replies without changing the bound Agent.
func (b *AgentBinding) SetEnabled(enabled bool, now time.Time) {
	if b.Enabled == enabled {
		return
	}
	b.Enabled = enabled
	b.Version++
	b.UpdatedAt = now.UTC()
}

// Owns reports whether the actor owns the binding.
func (b *AgentBinding) Owns(actorPtid string) bool {
	return b.OwnerPtid == actorPtid
}
