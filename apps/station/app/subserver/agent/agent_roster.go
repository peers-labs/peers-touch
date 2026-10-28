package agent

import (
	"context"
	"errors"
	"net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
)

// IsAgentOwnedBy is the structural roster check consumed by the bot subserver
// when a bot is bound to an Agent. It deliberately requires strict ownership:
// workspace-shared agents owned by other actors cannot drive a bot that speaks
// with the owner's publishing grant.
func (s *agentSubServer) IsAgentOwnedBy(
	ctx context.Context,
	ownerPTID string,
	agentID string,
) (bool, error) {
	s.lifecycleMu.RLock()
	service := s.agentService
	s.lifecycleMu.RUnlock()
	if service == nil {
		return false, nil
	}
	agent, err := service.GetAgent(ctx, ownerPTID, agentID)
	if err != nil {
		var biz *errcode.BizError
		if errors.As(err, &biz) && biz.HTTPStatus == http.StatusNotFound {
			return false, nil
		}
		return false, err
	}
	return agent.OwnerActorPTID == ownerPTID, nil
}
