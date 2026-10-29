package conversation

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	"github.com/peers-labs/peers-touch/station/frame/core/social_gate"
)

// productionCrossStationAuthorizer makes the positive cross-station
// membership decision that the social gate delegates outside same-station
// scope. Both the subject's and the target's Home Stations must be active
// members of the Federation named by the operation scope; anything else is a
// fail-closed denial. It never treats a Local scope as cross-station — the
// gate rejects that combination before reaching this authorizer.
type productionCrossStationAuthorizer struct {
	federation ports.FederationDirectory
}

func newProductionCrossStationAuthorizer(
	federation ports.FederationDirectory,
) social_gate.CrossStationAuthorizer {
	return &productionCrossStationAuthorizer{federation: federation}
}

func (a *productionCrossStationAuthorizer) AuthorizeCrossStation(
	ctx context.Context,
	op social_gate.CrossStationOperation,
) error {
	if a == nil || a.federation == nil {
		// No positive membership decision may be made without the directory.
		return fmt.Errorf("cross-station federation membership directory is unavailable")
	}
	federationID, err := valueobject.NewFederationID(op.Scope)
	if err != nil {
		return fmt.Errorf("cross-station scope is not a canonical Federation id: %w", err)
	}
	if op.SubjectStationPeerID == "" || op.TargetStationPeerID == "" {
		return fmt.Errorf("cross-station operation requires both Home Stations")
	}
	for _, station := range []struct {
		role string
		id   valueobject.StationID
	}{
		{role: "subject", id: valueobject.StationID(op.SubjectStationPeerID)},
		{role: "target", id: valueobject.StationID(op.TargetStationPeerID)},
	} {
		active, err := a.federation.IsActiveStation(ctx, federationID, station.id)
		if err != nil {
			return fmt.Errorf("resolve %s Station Federation membership: %w", station.role, err)
		}
		if !active {
			return fmt.Errorf(
				"%s Station %s is not an active member of Federation %s",
				station.role,
				station.id,
				federationID,
			)
		}
	}
	return nil
}
