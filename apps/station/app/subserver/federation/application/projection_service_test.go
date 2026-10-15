package application

import (
	"context"
	"errors"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
)

type federatedContentPreKeyFederationRepo struct {
	record *domain.FederationRecord
	err    error
}

func (*federatedContentPreKeyFederationRepo) Create(
	context.Context,
	*domain.FederationRecord,
) error {
	return nil
}

func (r *federatedContentPreKeyFederationRepo) GetByID(
	context.Context,
	string,
) (*domain.FederationRecord, error) {
	return r.record, r.err
}

func (*federatedContentPreKeyFederationRepo) ListByStation(
	context.Context,
	string,
) ([]*domain.FederationRecord, error) {
	return nil, nil
}

func (*federatedContentPreKeyFederationRepo) UpdateHead(
	context.Context,
	string,
	[]byte,
	uint64,
) error {
	return nil
}

func (*federatedContentPreKeyFederationRepo) UpdateStatus(
	context.Context,
	string,
	string,
) error {
	return nil
}

type federatedContentPreKeyMembershipRepo struct {
	records map[string]*domain.MembershipRecord
	err     error
}

func (*federatedContentPreKeyMembershipRepo) Upsert(
	context.Context,
	*domain.MembershipRecord,
) error {
	return nil
}

func (r *federatedContentPreKeyMembershipRepo) GetByStation(
	_ context.Context,
	_ string,
	stationPeerID string,
) (*domain.MembershipRecord, error) {
	return r.records[stationPeerID], r.err
}

func (*federatedContentPreKeyMembershipRepo) ListByFederation(
	context.Context,
	string,
) ([]*domain.MembershipRecord, error) {
	return nil, nil
}

func (*federatedContentPreKeyMembershipRepo) UpdateStatus(
	context.Context,
	string,
	string,
	string,
) error {
	return nil
}

func TestFederatedContentPreKeyRequiresActiveStationPair(t *testing.T) {
	federations := &federatedContentPreKeyFederationRepo{
		record: &domain.FederationRecord{
			FederationID: "federation-one",
			Status:       "active",
		},
	}
	memberships := &federatedContentPreKeyMembershipRepo{
		records: map[string]*domain.MembershipRecord{
			"station-source": {
				FederationID:  "federation-one",
				StationPeerID: "station-source",
				Status:        "active",
			},
			"station-target": {
				FederationID:  "federation-one",
				StationPeerID: "station-target",
				Status:        "active",
			},
		},
	}
	service := NewProjectionService(federations, memberships, nil, nil)
	if err := service.ValidateActiveStationPair(
		context.Background(),
		"federation-one",
		"station-source",
		"station-target",
	); err != nil {
		t.Fatal(err)
	}
	memberships.records["station-target"].Status = "left"
	err := service.ValidateActiveStationPair(
		context.Background(),
		"federation-one",
		"station-source",
		"station-target",
	)
	if !errors.Is(err, domain.ErrInactiveStationPair) {
		t.Fatalf("inactive target Station error = %v", err)
	}

	repositoryErr := errors.New("temporary Federation repository failure")
	memberships.records["station-target"].Status = "active"
	memberships.err = repositoryErr
	err = service.ValidateActiveStationPair(
		context.Background(),
		"federation-one",
		"station-source",
		"station-target",
	)
	if !errors.Is(err, repositoryErr) {
		t.Fatalf("repository error = %v", err)
	}
	if errors.Is(err, domain.ErrInactiveStationPair) {
		t.Fatalf("repository error classified as inactive pair: %v", err)
	}
}
