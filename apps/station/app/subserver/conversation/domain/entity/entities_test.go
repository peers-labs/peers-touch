package entity_test

import (
	"testing"
	"time"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

func TestAuthorityPlanLifecycle(t *testing.T) {
	now := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
	hash := valueobject.HashBytes([]byte("authority-plan"))

	t.Run("consume", func(t *testing.T) {
		plan := newAuthorityPlan(t, now, hash)

		if err := plan.Consume(hash, now.Add(time.Minute)); err != nil {
			t.Fatalf("Consume() error = %v", err)
		}
		if plan.State != entity.AuthorityPlanStateConsumed || plan.TerminalAt == nil {
			t.Fatalf("consumed plan = %+v, want consumed state and terminal time", plan)
		}
		if !plan.TerminalAt.Equal(now.Add(time.Minute)) {
			t.Fatalf("TerminalAt = %v, want %v", plan.TerminalAt, now.Add(time.Minute))
		}
		assertPlanErrorCode(
			t,
			plan.Consume(hash, now.Add(2*time.Minute)),
			conversationdomain.ErrorCodeAuthorityPlanStale,
		)
	})

	t.Run("rejects stale hash without mutation", func(t *testing.T) {
		plan := newAuthorityPlan(t, now, hash)

		err := plan.Consume(valueobject.HashBytes([]byte("stale-plan")), now.Add(time.Minute))
		assertPlanErrorCode(t, err, conversationdomain.ErrorCodeAuthorityPlanStale)
		if plan.State != entity.AuthorityPlanStatePrepared || plan.TerminalAt != nil {
			t.Fatalf("stale consume mutated plan: %+v", plan)
		}
	})

	t.Run("rejects expired consume", func(t *testing.T) {
		plan := newAuthorityPlan(t, now, hash)

		err := plan.Consume(hash, plan.ExpiresAt)
		assertPlanErrorCode(t, err, conversationdomain.ErrorCodeAuthorityPlanExpired)
		if plan.State != entity.AuthorityPlanStatePrepared || plan.TerminalAt != nil {
			t.Fatalf("expired consume mutated plan: %+v", plan)
		}
	})

	t.Run("supersede", func(t *testing.T) {
		plan := newAuthorityPlan(t, now, hash)

		if err := plan.Supersede(hash, now.Add(time.Minute)); err != nil {
			t.Fatalf("Supersede() error = %v", err)
		}
		if plan.State != entity.AuthorityPlanStateSuperseded || plan.TerminalAt == nil {
			t.Fatalf("superseded plan = %+v, want superseded state and terminal time", plan)
		}
		assertPlanErrorCode(
			t,
			plan.Expire(now.Add(10*time.Minute)),
			conversationdomain.ErrorCodeAuthorityPlanState,
		)
	})

	t.Run("expire", func(t *testing.T) {
		plan := newAuthorityPlan(t, now, hash)

		err := plan.Expire(plan.ExpiresAt.Add(-time.Nanosecond))
		assertPlanErrorCode(t, err, conversationdomain.ErrorCodeAuthorityPlanExpired)
		if plan.State != entity.AuthorityPlanStatePrepared {
			t.Fatalf("early expiry changed state to %q", plan.State)
		}

		if err := plan.Expire(plan.ExpiresAt); err != nil {
			t.Fatalf("Expire(at deadline) error = %v", err)
		}
		if plan.State != entity.AuthorityPlanStateExpired || plan.TerminalAt == nil {
			t.Fatalf("expired plan = %+v, want expired state and terminal time", plan)
		}
	})
}

func TestRehydrateAuthorityPlan(t *testing.T) {
	now := time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
	hash := valueobject.HashBytes([]byte("authority-plan"))
	input := entity.AuthorityPlan{
		ID:             valueobject.PlanID("plan-1"),
		ConversationID: valueobject.ConversationID("conversation-1"),
		FederationID:   valueobject.FederationID("federation-1"),
		AuthorityEpoch: valueobject.AuthorityEpoch(1),
		Requester:      authorityPlanEndpoint(t, "ptid:owner", "owner-device"),
		AuthorityHead: valueobject.AuthorityHead{
			Sequence:        4,
			EventHash:       valueobject.HashBytes([]byte("event-head")),
			MembershipEpoch: 3,
			MLSEpoch:        3,
		},
		PreEndpoints: []valueobject.Endpoint{
			authorityPlanEndpoint(t, "ptid:bob", "bob-device"),
			authorityPlanEndpoint(t, "ptid:alice", "alice-device"),
		},
		PostEndpoints: []valueobject.Endpoint{
			authorityPlanEndpoint(t, "ptid:charlie", "charlie-device"),
			authorityPlanEndpoint(t, "ptid:alice", "alice-device"),
		},
		Hash:      hash,
		State:     entity.AuthorityPlanStatePrepared,
		ExpiresAt: now.Add(5 * time.Minute),
		KeyPackageReservations: []valueobject.KeyPackageReservation{{
			ID:          "reservation-1",
			Endpoint:    authorityPlanEndpoint(t, "ptid:charlie", "charlie-device"),
			PackageID:   "package-1",
			KeyPackage:  []byte("package-1"),
			PackageHash: valueobject.HashBytes([]byte("package-1")),
			HomeStation: "station-a",
		}},
	}

	rehydrated, err := entity.RehydrateAuthorityPlan(input)
	if err != nil {
		t.Fatalf("RehydrateAuthorityPlan() error = %v", err)
	}
	if rehydrated.PreEndpoints[0].Actor != valueobject.PTID("ptid:alice") ||
		rehydrated.PostEndpoints[0].Actor != valueobject.PTID("ptid:alice") {
		t.Fatalf("rehydrated endpoints are not sorted: %+v", rehydrated)
	}

	input.PreEndpoints[0] = authorityPlanEndpoint(t, "ptid:mallory", "mallory-device")
	input.KeyPackageReservations[0].ID = "mutated"
	input.KeyPackageReservations[0].KeyPackage[0] = 'X'
	if rehydrated.PreEndpoints[0].Actor != valueobject.PTID("ptid:alice") ||
		rehydrated.KeyPackageReservations[0].ID != "reservation-1" ||
		string(rehydrated.KeyPackageReservations[0].KeyPackage) != "package-1" {
		t.Fatal("rehydrated plan aliases caller-owned slices")
	}
}

func newAuthorityPlan(
	t *testing.T,
	now time.Time,
	hash valueobject.Hash,
) *entity.AuthorityPlan {
	t.Helper()

	plan, err := entity.NewAuthorityPlan(entity.AuthorityPlan{
		ID:             valueobject.PlanID("plan-1"),
		ConversationID: valueobject.ConversationID("conversation-1"),
		FederationID:   valueobject.FederationID("federation-1"),
		AuthorityEpoch: valueobject.AuthorityEpoch(1),
		Requester:      authorityPlanEndpoint(t, "ptid:owner", "owner-device"),
		AuthorityHead: valueobject.AuthorityHead{
			Sequence:        1,
			EventHash:       valueobject.HashBytes([]byte("event-head")),
			MembershipEpoch: 1,
			MLSEpoch:        1,
		},
		Changes: []entity.MembershipChange{
			{
				Action:      entity.MembershipActionAddActor,
				Actor:       valueobject.PTID("ptid:member"),
				Device:      valueobject.DeviceID("member-device"),
				HomeStation: valueobject.StationID("station-a"),
				Role:        valueobject.MemberRoleMember,
			},
		},
		Hash:      hash,
		ExpiresAt: now.Add(5 * time.Minute),
	})
	if err != nil {
		t.Fatalf("NewAuthorityPlan() error = %v", err)
	}

	return plan
}

func authorityPlanEndpoint(
	t *testing.T,
	actor string,
	device string,
) valueobject.Endpoint {
	t.Helper()

	endpoint, err := valueobject.NewEndpoint(actor, device)
	if err != nil {
		t.Fatalf("NewEndpoint(%q, %q) error = %v", actor, device, err)
	}

	return endpoint
}

func assertPlanErrorCode(t *testing.T, err error, want conversationdomain.ErrorCode) {
	t.Helper()

	if !conversationdomain.IsCode(err, want) {
		t.Fatalf("error = %v (code %q), want code %q", err, conversationdomain.CodeOf(err), want)
	}
}
