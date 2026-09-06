package domain

import (
	"context"
	"time"
)

type AuthorityPlanState string

const (
	AuthorityPlanKindGroupGenesis         int32 = 1
	AuthorityPlanKindMembershipTransition int32 = 2
)

const (
	AuthorityPlanStatePrepared   AuthorityPlanState = "prepared"
	AuthorityPlanStateConsumed   AuthorityPlanState = "consumed"
	AuthorityPlanStateExpired    AuthorityPlanState = "expired"
	AuthorityPlanStateSuperseded AuthorityPlanState = "superseded"
)

type AuthorityPlan struct {
	PlanID              string
	PlanKind            int32
	ConversationID      string
	RequesterPTID       string
	RequesterDeviceID   string
	IntentBytes         []byte
	SnapshotBytes       []byte
	AuthorityPlanSHA256 []byte
	State               AuthorityPlanState
	ExpiresAt           time.Time
	ConsumedAt          *time.Time
}

type AuthorityPlanRepository interface {
	Create(ctx context.Context, plan *AuthorityPlan) error
	Get(ctx context.Context, planID string) (*AuthorityPlan, error)
	MarkConsumed(
		ctx context.Context,
		planID string,
		authorityPlanSHA256 []byte,
		consumedAt time.Time,
	) error
	MarkSuperseded(ctx context.Context, planID string, authorityPlanSHA256 []byte) error
	ExpirePrepared(ctx context.Context, now time.Time) error
}
