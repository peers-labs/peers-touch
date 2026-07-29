package policy

import (
	"context"
	"errors"
)

var (
	ErrNotSequencer      = errors.New("station is not the active sequencer")
	ErrNotActiveMember   = errors.New("station is not an active member")
	ErrHandoverDenied    = errors.New("only current sequencer can initiate handover under single_admin policy")
)

type singleAdminPolicy struct{}

func NewSingleAdminPolicy() SequencerPolicy {
	return &singleAdminPolicy{}
}

func (p *singleAdminPolicy) ValidateAppend(_ context.Context, federation Federation, station StationMembership) error {
	if station.GetStationPeerID() != federation.GetSequencerStationPeerID() {
		return ErrNotSequencer
	}
	if station.GetStatus() != "active" {
		return ErrNotActiveMember
	}
	return nil
}

func (p *singleAdminPolicy) ValidateProposal(_ context.Context, _ Federation, proposal Proposal) error {
	if proposal.GetStationPeerID() == "" {
		return ErrNotActiveMember
	}
	return nil
}

func (p *singleAdminPolicy) HandleSequencerUnreachable(_ context.Context, _ Federation) (PolicyAction, error) {
	return ActionOrphaned, nil
}

func (p *singleAdminPolicy) ValidateHandover(_ context.Context, federation Federation, request HandoverRequest) error {
	if request.GetOldSequencerPeerID() != federation.GetSequencerStationPeerID() {
		return ErrHandoverDenied
	}
	return nil
}
