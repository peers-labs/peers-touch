package conversation

import (
	"context"
	"errors"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	"github.com/peers-labs/peers-touch/station/frame/core/social_gate"
)

type crossStationDirectoryStub struct {
	active map[string]map[string]bool
	err    error
}

func (d crossStationDirectoryStub) IsActiveStation(
	_ context.Context,
	federationID valueobject.FederationID,
	station valueobject.StationID,
) (bool, error) {
	if d.err != nil {
		return false, d.err
	}
	return d.active[string(federationID)][string(station)], nil
}

func (d crossStationDirectoryStub) ResolveSharedFederation(
	_ context.Context,
	stationA valueobject.StationID,
	stationB valueobject.StationID,
) (valueobject.FederationID, error) {
	for federationID, stations := range d.active {
		if stations[string(stationA)] && stations[string(stationB)] {
			return valueobject.FederationID(federationID), nil
		}
	}
	return "", errors.New("no shared federation")
}

func TestProductionCrossStationAuthorizerAllowsTwoActiveStations(t *testing.T) {
	directory := crossStationDirectoryStub{active: map[string]map[string]bool{
		"fed_01J0network": {"station-a": true, "station-b": true},
	}}
	authorizer := newProductionCrossStationAuthorizer(directory)
	err := authorizer.AuthorizeCrossStation(context.Background(), social_gate.CrossStationOperation{
		Action:               "create_direct",
		Scope:                "fed_01J0network",
		SubjectStationPeerID: "station-a",
		TargetStationPeerID:  "station-b",
	})
	if err != nil {
		t.Fatalf("active federation stations must be authorized: %v", err)
	}
}

func TestProductionCrossStationAuthorizerDeniesInactiveTarget(t *testing.T) {
	directory := crossStationDirectoryStub{active: map[string]map[string]bool{
		"fed_01J0network": {"station-a": true},
	}}
	authorizer := newProductionCrossStationAuthorizer(directory)
	err := authorizer.AuthorizeCrossStation(context.Background(), social_gate.CrossStationOperation{
		Action:               "create_direct",
		Scope:                "fed_01J0network",
		SubjectStationPeerID: "station-a",
		TargetStationPeerID:  "station-b",
	})
	if err == nil {
		t.Fatal("inactive target station must be denied")
	}
}

func TestProductionCrossStationAuthorizerRejectsLocalOrEmptyScope(t *testing.T) {
	authorizer := newProductionCrossStationAuthorizer(crossStationDirectoryStub{
		active: map[string]map[string]bool{},
	})
	for _, scope := range []string{"", "local:station-a"} {
		err := authorizer.AuthorizeCrossStation(context.Background(), social_gate.CrossStationOperation{
			Scope:                scope,
			SubjectStationPeerID: "station-a",
			TargetStationPeerID:  "station-b",
		})
		if err == nil {
			t.Fatalf("scope %q must not be authorized cross-station", scope)
		}
	}
}

func TestProductionCrossStationAuthorizerFailsClosedWithoutDirectory(t *testing.T) {
	authorizer := newProductionCrossStationAuthorizer(nil)
	if err := authorizer.AuthorizeCrossStation(context.Background(), social_gate.CrossStationOperation{
		Scope:                "fed_01J0network",
		SubjectStationPeerID: "station-a",
		TargetStationPeerID:  "station-b",
	}); err == nil {
		t.Fatal("nil directory must fail closed")
	}

	var nilAuthorizer *productionCrossStationAuthorizer
	if err := nilAuthorizer.AuthorizeCrossStation(context.Background(), social_gate.CrossStationOperation{}); err == nil {
		t.Fatal("nil authorizer must fail closed")
	}
}

func TestProductionCrossStationAuthorizerPropagatesDirectoryError(t *testing.T) {
	wantErr := errors.New("membership store unavailable")
	authorizer := newProductionCrossStationAuthorizer(crossStationDirectoryStub{err: wantErr})
	err := authorizer.AuthorizeCrossStation(context.Background(), social_gate.CrossStationOperation{
		Scope:                "fed_01J0network",
		SubjectStationPeerID: "station-a",
		TargetStationPeerID:  "station-b",
	})
	if !errors.Is(err, wantErr) {
		t.Fatalf("want wrapped directory error, got %v", err)
	}
}
