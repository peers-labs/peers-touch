package service

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

// A client capability lease is a child credential of the actor session that
// registered it. Session takeover (renderer reload) and logout revoke the
// parent without waiting for an explicit lease revoke; the lease must stop
// being selectable and routable at that instant, rather than lingering until
// its own expiry.
func TestCapabilityLeaseFollowsParentActorSessionLifecycle(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	ctx := context.Background()
	sessionID := fixture.session.GetCapabilitySessionId()

	active, err := fixture.service.GetActiveCapabilitySession(ctx, fixture.actorID, sessionID)
	if err != nil {
		t.Fatalf("resolve lease under live parent: %v", err)
	}
	if active == nil || active.GetSessionId() != sessionID {
		t.Fatalf("registered lease must be active under its parent session: %+v", active)
	}
	listed, err := fixture.service.ListCapabilitySessions(ctx, fixture.actorID)
	if err != nil {
		t.Fatalf("list sessions under live parent: %v", err)
	}
	if len(listed.GetSessions()) != 1 || listed.GetSessions()[0].GetSessionId() != sessionID {
		t.Fatalf("live lease must be listed: %+v", listed.GetSessions())
	}

	// Simulate the session takeover kick: the parent actor session is revoked
	// while the capability lease row itself keeps an unrevoked, unexpired
	// shape — exactly the state a renderer reload leaves when the worker's
	// explicit revoke arrives after the parent died.
	if err := fixture.db.Model(&persistence.ActorSessionLiveness{}).
		Where("session_id = ?", "auth-session-1").
		Updates(map[string]interface{}{"revoked": true}).Error; err != nil {
		t.Fatalf("revoke parent actor session: %v", err)
	}

	activeAfterKick, err := fixture.service.GetActiveCapabilitySession(ctx, fixture.actorID, sessionID)
	if err != nil {
		t.Fatalf("resolve lease after parent kick: %v", err)
	}
	if activeAfterKick != nil {
		t.Fatalf("kicked parent session must deactivate its lease: %+v", activeAfterKick)
	}
	listedAfterKick, err := fixture.service.ListCapabilitySessions(ctx, fixture.actorID)
	if err != nil {
		t.Fatalf("list sessions after parent kick: %v", err)
	}
	if len(listedAfterKick.GetSessions()) != 0 {
		t.Fatalf("kicked parent session must hide its lease from selection: %+v", listedAfterKick.GetSessions())
	}

	// A client-owned tool pinned to the orphaned lease must not be dispatched.
	proposal := fixture.authorizedProposal(
		t,
		"orphan",
		model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO,
		model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_READY,
		true,
	)
	fixture.seedTurnAuthority(t, proposal)
	if _, err := fixture.service.ProposeAuthorizedBatch(ctx, proposal); err == nil {
		t.Fatal("proposal pinned to an orphaned capability lease must be rejected")
	}
	var dispatched int64
	if err := fixture.db.Model(&persistence.ToolCall{}).
		Where("status = ?", persistence.ToolCallStatusDispatchCommitted).
		Count(&dispatched).Error; err != nil {
		t.Fatalf("count dispatched calls: %v", err)
	}
	if dispatched != 0 {
		t.Fatalf("orphaned lease dispatched %d tool calls, want 0", dispatched)
	}
	var envelopes int64
	if err := fixture.db.Model(&persistence.ToolDispatchOutbox{}).
		Count(&envelopes).Error; err != nil {
		t.Fatalf("count dispatch envelopes: %v", err)
	}
	if envelopes != 0 {
		t.Fatalf("orphaned lease produced %d dispatch envelopes, want 0", envelopes)
	}
}

// An expired parent session deactivates its capability lease even when the
// parent row was never explicitly revoked.
func TestCapabilityLeaseDeactivatesWhenParentSessionExpires(t *testing.T) {
	fixture := newToolDispatchFixture(t)
	ctx := context.Background()
	sessionID := fixture.session.GetCapabilitySessionId()

	expiredAt := fixture.now.Add(-time.Second)
	if err := fixture.db.Model(&persistence.ActorSessionLiveness{}).
		Where("session_id = ?", "auth-session-1").
		Updates(map[string]interface{}{"expires_at": expiredAt}).Error; err != nil {
		t.Fatalf("expire parent actor session: %v", err)
	}

	active, err := fixture.service.GetActiveCapabilitySession(ctx, fixture.actorID, sessionID)
	if err != nil {
		t.Fatalf("resolve lease after parent expiry: %v", err)
	}
	if active != nil {
		t.Fatalf("expired parent session must deactivate its lease: %+v", active)
	}
}
