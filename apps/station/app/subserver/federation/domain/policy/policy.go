package policy

import "context"

type Type string

const (
	SingleAdmin Type = "single_admin"
	OwnerAdmin  Type = "owner_admin"
	Quorum      Type = "quorum"
	MultiSig    Type = "multi_sig"
)

type PolicyAction int

const (
	ActionOrphaned PolicyAction = iota
	ActionReadOnly
	ActionElectNew
)

type Federation interface {
	GetSequencerStationPeerID() string
	GetPolicyType() Type
}

type StationMembership interface {
	GetStationPeerID() string
	GetRole() string
	GetStatus() string
}

type Proposal interface {
	GetStationPeerID() string
	GetActorPTID() string
	GetEventType() string
}

type HandoverRequest interface {
	GetOldSequencerPeerID() string
	GetNewSequencerPeerID() string
	GetInitiatedByActorPTID() string
}

type SequencerPolicy interface {
	ValidateAppend(ctx context.Context, federation Federation, station StationMembership) error
	ValidateProposal(ctx context.Context, federation Federation, proposal Proposal) error
	HandleSequencerUnreachable(ctx context.Context, federation Federation) (PolicyAction, error)
	ValidateHandover(ctx context.Context, federation Federation, request HandoverRequest) error
}

type Registry struct {
	policies map[Type]SequencerPolicy
}

func NewRegistry() *Registry {
	return &Registry{policies: make(map[Type]SequencerPolicy)}
}

func (r *Registry) Register(policyType Type, p SequencerPolicy) {
	r.policies[policyType] = p
}

func (r *Registry) Get(policyType Type) (SequencerPolicy, bool) {
	p, ok := r.policies[policyType]
	return p, ok
}
