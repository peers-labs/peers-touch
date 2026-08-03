package conversation

import (
	"context"
	"strings"

	feddomain "github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
)

type federationMembershipAdapter struct {
	repo feddomain.MembershipRepository
}

func (a federationMembershipAdapter) IsActiveStation(
	ctx context.Context,
	federationID string,
	stationPeerID string,
) (bool, error) {
	record, err := a.repo.GetByStation(ctx, federationID, stationPeerID)
	if err != nil {
		return false, err
	}
	return record != nil && strings.EqualFold(record.Status, "active"), nil
}
