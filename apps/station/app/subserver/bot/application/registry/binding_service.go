package registry

import (
	"context"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
)

// SetAgentBinding creates or updates the bot↔Agent binding under optimistic
// concurrency. expectedVersion 0 creates the first revision; a stale version
// conflicts. The bound Agent must belong to the bot owner.
func (s *Service) SetAgentBinding(
	ctx context.Context,
	ownerPtid string,
	botPtid string,
	agentID string,
	enabled bool,
	expectedVersion int64,
) (*domain.AgentBinding, error) {
	bot, err := s.loadOwned(ctx, ownerPtid, botPtid)
	if err != nil {
		return nil, err
	}
	agentID = strings.TrimSpace(agentID)
	if agentID == "" {
		return nil, domain.NewError(domain.CodeInvalidArgument, "agent identity is required")
	}
	if s.roster == nil {
		return nil, domain.NewError(domain.CodeStateConflict, "agent roster is unavailable")
	}
	owned, err := s.roster.IsAgentOwnedBy(ctx, bot.OwnerPtid, agentID)
	if err != nil {
		return nil, err
	}
	if !owned {
		return nil, domain.NewError(
			domain.CodeInvalidArgument,
			"agent %s does not belong to the bot owner",
			agentID,
		)
	}
	existing, found, err := s.repo.GetAgentBinding(ctx, bot.BotPtid)
	if err != nil {
		return nil, err
	}
	switch {
	case !found && expectedVersion != 0:
		return nil, domain.NewNotFound(bot.BotPtid)
	case !found:
		binding, buildErr := domain.NewAgentBinding(bot.BotPtid, bot.OwnerPtid, agentID, enabled, s.now())
		if buildErr != nil {
			return nil, buildErr
		}
		if err := s.repo.CreateAgentBinding(ctx, binding); err != nil {
			return nil, err
		}
		return binding, nil
	case existing.Version != expectedVersion:
		return nil, domain.NewError(
			domain.CodeStateConflict,
			"binding revision %d does not match expected %d",
			existing.Version,
			expectedVersion,
		)
	default:
		if err := existing.Rebind(agentID, enabled, s.now()); err != nil {
			return nil, err
		}
		matched, err := s.repo.UpdateAgentBinding(ctx, existing)
		if err != nil {
			return nil, err
		}
		if !matched {
			return nil, domain.NewError(
				domain.CodeStateConflict,
				"binding for bot %s changed concurrently",
				bot.BotPtid,
			)
		}
		return existing, nil
	}
}

// AgentBinding returns the owner-scoped binding projection. found is false
// when the bot is not bound.
func (s *Service) AgentBinding(
	ctx context.Context,
	ownerPtid string,
	botPtid string,
) (*domain.AgentBinding, bool, error) {
	if _, err := s.loadOwned(ctx, ownerPtid, botPtid); err != nil {
		return nil, false, err
	}
	return s.repo.GetAgentBinding(ctx, botPtid)
}

// ListAgentBindings lists every binding owned by the actor.
func (s *Service) ListAgentBindings(
	ctx context.Context,
	ownerPtid string,
) ([]*domain.AgentBinding, error) {
	if ownerPtid == "" {
		return nil, domain.NewError(domain.CodeUnauthenticated, "owner identity required")
	}
	return s.repo.ListAgentBindings(ctx, ownerPtid)
}

// DeleteAgentBinding removes a binding at its expected revision. In-flight
// turns stop projecting replies because the binding lookup fails closed.
func (s *Service) DeleteAgentBinding(
	ctx context.Context,
	ownerPtid string,
	botPtid string,
	expectedVersion int64,
) error {
	if _, err := s.loadOwned(ctx, ownerPtid, botPtid); err != nil {
		return err
	}
	if expectedVersion <= 0 {
		return domain.NewError(domain.CodeInvalidArgument, "expected binding revision is required")
	}
	matched, err := s.repo.DeleteAgentBinding(ctx, botPtid, expectedVersion)
	if err != nil {
		return err
	}
	if matched {
		return nil
	}
	current, versionErr := s.repo.AgentBindingRevision(ctx, botPtid)
	if versionErr != nil {
		return versionErr
	}
	if current == 0 {
		return domain.NewNotFound(botPtid)
	}
	return domain.NewError(
		domain.CodeStateConflict,
		"binding revision %d does not match expected %d",
		current,
		expectedVersion,
	)
}

// ActiveBindingForBot is the Station-internal lookup used by the inbound turn
// projection. It enforces the single safety rule: only an enabled binding
// creates a turn; an absent or paused binding leaves the bot receive-only.
func (s *Service) ActiveBindingForBot(
	ctx context.Context,
	botPtid string,
) (*domain.AgentBinding, bool, error) {
	binding, found, err := s.repo.GetAgentBinding(ctx, strings.TrimSpace(botPtid))
	if err != nil || !found || !binding.Enabled {
		return nil, false, err
	}
	return binding, true, nil
}
