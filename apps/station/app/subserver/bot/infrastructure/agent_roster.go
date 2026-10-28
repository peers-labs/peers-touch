package infrastructure

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/application/registry"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

const agentInstanceKey = "agent"

var ErrAgentRosterUnavailable = errors.New("bot: agent roster capability is unavailable")

// agentRosterTarget is implemented by the agent subserver. The interface is
// declared here to keep the cross-subserver discovery structural (same
// pattern as LazyPublishingManager) without importing the agent subserver.
type agentRosterTarget interface {
	IsAgentOwnedBy(ctx context.Context, ownerPTID, agentID string) (bool, error)
}

type LazyAgentRoster struct{}

func NewLazyAgentRoster() LazyAgentRoster { return LazyAgentRoster{} }

func (LazyAgentRoster) IsAgentOwnedBy(
	ctx context.Context,
	ownerPTID string,
	agentID string,
) (bool, error) {
	options := server.GetOptions()
	if options == nil {
		return false, ErrAgentRosterUnavailable
	}
	instance := options.SubserverInstances[agentInstanceKey]
	target, ok := instance.(agentRosterTarget)
	if !ok || target == nil {
		return false, ErrAgentRosterUnavailable
	}
	return target.IsAgentOwnedBy(ctx, ownerPTID, agentID)
}

var _ registry.AgentRoster = LazyAgentRoster{}
