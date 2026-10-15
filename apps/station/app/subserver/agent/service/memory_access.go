package service

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"gorm.io/gorm"
)

// Authenticated aggregate reads retain their all-visible-Agents semantics.
// Internal workers have no request subject and retain their explicit Agent scope.
func memoryAccessPredicate(ctx context.Context, owned bool) (string, []any) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return "1=1", nil
	}
	if owned {
		return "agent_id IN (SELECT id FROM agents WHERE owner_actor_ptid = ?)", []any{subject.ID}
	}
	return "agent_id IN (SELECT id FROM agents WHERE owner_actor_ptid = ? OR visibility = ?)",
		[]any{subject.ID, string(domain.AgentVisibilityWorkspace)}
}

func memoryAccessQuery(ctx context.Context, query *gorm.DB, owned bool) *gorm.DB {
	predicate, values := memoryAccessPredicate(ctx, owned)
	return query.Where(predicate, values...)
}
