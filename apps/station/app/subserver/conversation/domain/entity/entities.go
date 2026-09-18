package entity

import (
	"bytes"
	"time"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

type Member struct {
	Actor       valueobject.PTID
	Role        valueobject.MemberRole
	Status      valueobject.MemberStatus
	HomeStation valueobject.StationID
	JoinedAt    valueobject.Sequence
	LeftAt      valueobject.Sequence
	Muted       bool
	MutedUntil  *time.Time
}

func NewMember(
	actor valueobject.PTID,
	role valueobject.MemberRole,
	homeStation valueobject.StationID,
	joinedAt valueobject.Sequence,
) (Member, error) {
	if actor == "" || homeStation == "" || joinedAt == 0 {
		return Member{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"entity.new_member",
			"member",
			"actor, home Station, and joined sequence are required",
		)
	}
	if err := role.Validate(); err != nil {
		return Member{}, err
	}
	return Member{
		Actor:       actor,
		Role:        role,
		Status:      valueobject.MemberStatusActive,
		HomeStation: homeStation,
		JoinedAt:    joinedAt,
	}, nil
}

func (m Member) Active() bool {
	return m.Status == valueobject.MemberStatusActive
}

func (m Member) MutedAt(at time.Time) bool {
	return m.Muted && (m.MutedUntil == nil || m.MutedUntil.After(at.UTC()))
}

func (m Member) Validate() error {
	if m.Actor == "" || m.HomeStation == "" || m.JoinedAt == 0 {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"entity.validate_member",
			"member",
			"actor, home Station, and joined sequence are required",
		)
	}
	if err := m.Role.Validate(); err != nil {
		return err
	}
	if err := m.Status.Validate(); err != nil {
		return err
	}
	if m.Active() && m.LeftAt != 0 {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"entity.validate_member",
			"left_sequence",
			"must be zero for an active member",
		)
	}
	if !m.Active() && m.LeftAt <= m.JoinedAt {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"entity.validate_member",
			"left_sequence",
			"must follow the joined sequence for an inactive member",
		)
	}
	if !m.Muted && m.MutedUntil != nil {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"entity.validate_member",
			"muted_until",
			"requires muted state",
		)
	}
	if m.MutedUntil != nil && m.MutedUntil.IsZero() {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"entity.validate_member",
			"muted_until",
			"must be a valid timestamp",
		)
	}
	return nil
}

func (m Member) WithRole(role valueobject.MemberRole) (Member, error) {
	if err := role.Validate(); err != nil {
		return Member{}, err
	}
	m.Role = role
	return m, nil
}

func (m Member) WithAuthorityState(
	role *valueobject.MemberRole,
	muted *bool,
	mutedUntil *time.Time,
) (Member, error) {
	if role != nil {
		if err := role.Validate(); err != nil {
			return Member{}, err
		}
		m.Role = *role
	}
	if muted == nil {
		if mutedUntil != nil {
			return Member{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeInvalidArgument,
				"entity.update_member_authority",
				"muted_until",
				"requires an explicit muted value",
			)
		}
		return m, m.Validate()
	}
	m.Muted = *muted
	m.MutedUntil = nil
	if *muted && mutedUntil != nil {
		normalized := mutedUntil.UTC().Truncate(time.Microsecond)
		m.MutedUntil = &normalized
	}
	if !*muted && mutedUntil != nil {
		return Member{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"entity.update_member_authority",
			"muted_until",
			"must be absent when muted is false",
		)
	}
	return m, m.Validate()
}

func (m Member) Leave(sequence valueobject.Sequence, status valueobject.MemberStatus) (Member, error) {
	if !m.Active() || sequence == 0 {
		return Member{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeMembershipConflict,
			"entity.leave_member",
			"member",
			"active membership and sequence are required",
		)
	}
	if status != valueobject.MemberStatusLeft && status != valueobject.MemberStatusRemoved {
		return Member{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"entity.leave_member",
			"status",
			"must be left or removed",
		)
	}
	m.Status = status
	m.LeftAt = sequence
	return m, nil
}

type MemberDevice struct {
	Endpoint    valueobject.Endpoint
	HomeStation valueobject.StationID
	Active      bool
	JoinedAt    valueobject.Sequence
	LeftAt      valueobject.Sequence
}

func NewMemberDevice(
	endpoint valueobject.Endpoint,
	homeStation valueobject.StationID,
	joinedAt valueobject.Sequence,
) (MemberDevice, error) {
	if err := endpoint.Validate(); err != nil {
		return MemberDevice{}, err
	}
	if homeStation == "" || joinedAt == 0 {
		return MemberDevice{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"entity.new_member_device",
			"device",
			"home Station and joined sequence are required",
		)
	}
	return MemberDevice{
		Endpoint:    endpoint,
		HomeStation: homeStation,
		Active:      true,
		JoinedAt:    joinedAt,
	}, nil
}

func (d MemberDevice) Remove(sequence valueobject.Sequence) (MemberDevice, error) {
	if !d.Active || sequence == 0 {
		return MemberDevice{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeDeviceConflict,
			"entity.remove_member_device",
			"device",
			"active device and sequence are required",
		)
	}
	d.Active = false
	d.LeftAt = sequence
	return d, nil
}

func (d MemberDevice) Validate() error {
	if err := d.Endpoint.Validate(); err != nil {
		return err
	}
	if d.HomeStation == "" || d.JoinedAt == 0 {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"entity.validate_member_device",
			"device",
			"home Station and joined sequence are required",
		)
	}
	if d.Active && d.LeftAt != 0 {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"entity.validate_member_device",
			"left_sequence",
			"must be zero for an active device",
		)
	}
	if !d.Active && d.LeftAt <= d.JoinedAt {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"entity.validate_member_device",
			"left_sequence",
			"must follow the joined sequence for an inactive device",
		)
	}
	return nil
}

type MembershipAction string

const (
	MembershipActionAddActor     MembershipAction = "add_actor"
	MembershipActionRemoveActor  MembershipAction = "remove_actor"
	MembershipActionLeave        MembershipAction = "leave"
	MembershipActionChangeRole   MembershipAction = "change_role"
	MembershipActionAddDevice    MembershipAction = "add_device"
	MembershipActionRemoveDevice MembershipAction = "remove_device"
)

type MembershipChange struct {
	Action      MembershipAction
	Actor       valueobject.PTID
	Device      valueobject.DeviceID
	HomeStation valueobject.StationID
	Role        valueobject.MemberRole
}

func (c MembershipChange) Validate() error {
	if c.Actor == "" {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"entity.membership_change",
			"actor",
			"is required",
		)
	}
	switch c.Action {
	case MembershipActionAddActor:
		if c.HomeStation == "" {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeInvalidArgument,
				"entity.membership_change",
				"home_station",
				"is required when adding an actor",
			)
		}
		return c.Role.Validate()
	case MembershipActionRemoveActor, MembershipActionLeave:
		return nil
	case MembershipActionChangeRole:
		return c.Role.Validate()
	case MembershipActionAddDevice:
		if c.Device == "" || c.HomeStation == "" {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeInvalidArgument,
				"entity.membership_change",
				"device",
				"device and home Station are required",
			)
		}
		return nil
	case MembershipActionRemoveDevice:
		if c.Device == "" {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeInvalidArgument,
				"entity.membership_change",
				"device",
				"is required",
			)
		}
		return nil
	default:
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeUnsupportedTransition,
			"entity.membership_change",
			"action",
			"is not supported",
		)
	}
}

type AuthorityPlanState string

const (
	AuthorityPlanStatePrepared   AuthorityPlanState = "prepared"
	AuthorityPlanStateConsumed   AuthorityPlanState = "consumed"
	AuthorityPlanStateSuperseded AuthorityPlanState = "superseded"
	AuthorityPlanStateExpired    AuthorityPlanState = "expired"
)

type AuthorityPlan struct {
	ID                        valueobject.PlanID
	ConversationID            valueobject.ConversationID
	FederationID              valueobject.FederationID
	AuthorityEpoch            valueobject.AuthorityEpoch
	PreparedName              string
	Requester                 valueobject.Endpoint
	AuthorityHead             valueobject.AuthorityHead
	Changes                   []MembershipChange
	PreEndpoints              []valueobject.Endpoint
	PostEndpoints             []valueobject.Endpoint
	AddedEndpoints            []valueobject.Endpoint
	RemovedEndpoints          []valueobject.Endpoint
	EndpointManifestSetHash   valueobject.Hash
	EndpointManifestStateHash valueobject.Hash
	Hash                      valueobject.Hash
	State                     AuthorityPlanState
	ExpiresAt                 time.Time
	TerminalAt                *time.Time
	KeyPackageReservations    []valueobject.KeyPackageReservation
}

func NewAuthorityPlan(plan AuthorityPlan) (*AuthorityPlan, error) {
	if plan.ID == "" || plan.ConversationID == "" || plan.FederationID == "" ||
		plan.AuthorityEpoch == 0 || plan.Requester.Validate() != nil ||
		plan.Hash.IsZero() || plan.ExpiresAt.IsZero() {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"entity.new_authority_plan",
			"plan",
			"identity, requester, hash, and expiry are required",
		)
	}
	if plan.EndpointManifestSetHash.IsZero() !=
		plan.EndpointManifestStateHash.IsZero() {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"entity.new_authority_plan",
			"endpoint_manifest",
			"binding and stable state hashes must be present together",
		)
	}
	if plan.State == "" {
		plan.State = AuthorityPlanStatePrepared
	}
	if plan.State != AuthorityPlanStatePrepared {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeAuthorityPlanState,
			"entity.new_authority_plan",
			"state",
			"new plan must be prepared",
		)
	}
	plan.Changes = append([]MembershipChange(nil), plan.Changes...)
	plan.PreEndpoints = valueobject.SortEndpoints(plan.PreEndpoints)
	plan.PostEndpoints = valueobject.SortEndpoints(plan.PostEndpoints)
	plan.AddedEndpoints = valueobject.SortEndpoints(plan.AddedEndpoints)
	plan.RemovedEndpoints = valueobject.SortEndpoints(plan.RemovedEndpoints)
	plan.KeyPackageReservations = valueobject.SortKeyPackageReservations(
		plan.KeyPackageReservations,
	)
	for _, reservation := range plan.KeyPackageReservations {
		if err := reservation.Validate(); err != nil {
			return nil, err
		}
	}
	return &plan, nil
}

func RehydrateAuthorityPlan(plan AuthorityPlan) (*AuthorityPlan, error) {
	if plan.ID == "" || plan.ConversationID == "" || plan.FederationID == "" ||
		plan.AuthorityEpoch == 0 || plan.Hash.IsZero() || plan.State == "" {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"entity.rehydrate_authority_plan",
			"plan",
			"persisted plan is incomplete",
		)
	}
	if plan.EndpointManifestSetHash.IsZero() !=
		plan.EndpointManifestStateHash.IsZero() {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeAuthorityPlanStale,
			"entity.rehydrate_authority_plan",
			"endpoint_manifest",
			"binding and stable state hashes disagree",
		)
	}
	plan.Changes = append([]MembershipChange(nil), plan.Changes...)
	plan.PreEndpoints = valueobject.SortEndpoints(plan.PreEndpoints)
	plan.PostEndpoints = valueobject.SortEndpoints(plan.PostEndpoints)
	plan.AddedEndpoints = valueobject.SortEndpoints(plan.AddedEndpoints)
	plan.RemovedEndpoints = valueobject.SortEndpoints(plan.RemovedEndpoints)
	plan.KeyPackageReservations = valueobject.SortKeyPackageReservations(
		plan.KeyPackageReservations,
	)
	for _, reservation := range plan.KeyPackageReservations {
		if err := reservation.Validate(); err != nil {
			return nil, err
		}
	}
	return &plan, nil
}

func (p *AuthorityPlan) Consume(expected valueobject.Hash, at time.Time) error {
	if err := p.ensurePrepared(expected, at); err != nil {
		return err
	}
	p.State = AuthorityPlanStateConsumed
	p.TerminalAt = timePointer(at)
	return nil
}

func (p *AuthorityPlan) Supersede(expected valueobject.Hash, at time.Time) error {
	if p.State != AuthorityPlanStatePrepared || !bytes.Equal(p.Hash[:], expected[:]) {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeAuthorityPlanStale,
			"entity.supersede_authority_plan",
			"plan",
			"plan state or hash is stale",
		)
	}
	p.State = AuthorityPlanStateSuperseded
	p.TerminalAt = timePointer(at)
	return nil
}

func (p *AuthorityPlan) Expire(at time.Time) error {
	if p.State != AuthorityPlanStatePrepared {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeAuthorityPlanState,
			"entity.expire_authority_plan",
			"state",
			"only a prepared plan can expire",
		)
	}
	if at.Before(p.ExpiresAt) {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeAuthorityPlanExpired,
			"entity.expire_authority_plan",
			"expires_at",
			"plan has not expired",
		)
	}
	p.State = AuthorityPlanStateExpired
	p.TerminalAt = timePointer(at)
	return nil
}

func (p *AuthorityPlan) ensurePrepared(expected valueobject.Hash, at time.Time) error {
	if p.State != AuthorityPlanStatePrepared || !bytes.Equal(p.Hash[:], expected[:]) {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeAuthorityPlanStale,
			"entity.consume_authority_plan",
			"plan",
			"plan state or hash is stale",
		)
	}
	if !p.ExpiresAt.After(at) {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeAuthorityPlanExpired,
			"entity.consume_authority_plan",
			"expires_at",
			"plan has expired",
		)
	}
	return nil
}

func timePointer(value time.Time) *time.Time {
	copy := value.UTC()
	return &copy
}
