package federation

import (
	"context"
	"fmt"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/application"
)

type testnetSeedConfig struct {
	FederationName string
	Stations       []seedStation
}

type seedStation struct {
	PeerID          string
	Name            string
	URL             string
	ActorPTID       string
	FederatedHandle string
}

func seedTestnet(t *testing.T, ctx context.Context, cfg *testnetSeedConfig, fedSvc *application.FederationService, _ *application.LedgerService) error {
	t.Helper()
	if len(cfg.Stations) == 0 {
		return fmt.Errorf("at least one station required for seed")
	}

	creator := cfg.Stations[0]

	fed, err := fedSvc.CreateFederation(ctx, &application.CreateFederationInput{
		Name:                 cfg.FederationName,
		Description:          "Testnet federation seeded for testing",
		PolicyType:           "single_admin",
		ActorPTID:            creator.ActorPTID,
		ActorFederatedHandle: creator.FederatedHandle,
		StationPeerID:        creator.PeerID,
		StationName:          creator.Name,
		StationURL:           creator.URL,
	})
	if err != nil {
		return fmt.Errorf("seed: create federation: %w", err)
	}

	t.Logf("[seed] created federation %s (%s)", fed.FederationID, fed.Name)

	for i := 1; i < len(cfg.Stations); i++ {
		station := cfg.Stations[i]
		_, err = fedSvc.ApproveJoinAsSequencer(
			ctx,
			fed.FederationID,
			station.PeerID,
			station.Name,
			station.URL,
		)
		if err != nil {
			return fmt.Errorf("seed: join station %s: %w", station.PeerID, err)
		}

		t.Logf("[seed] station %s joined %s", station.PeerID, fed.FederationID)
	}

	state, err := fedSvc.Replay(ctx, fed.FederationID)
	if err != nil {
		return fmt.Errorf("seed: replay verification: %w", err)
	}

	t.Logf("[seed] verified: head_seq=%d, members=%d", state.HeadSeq, len(state.ActiveMemberStations))
	return nil
}

func defaultTestnetSeedConfig() *testnetSeedConfig {
	return &testnetSeedConfig{
		FederationName: "Peers Testnet",
		Stations: []seedStation{
			{PeerID: "node-a", Name: "Station One", URL: "http://localhost:18080", ActorPTID: "ptid:v1:actor:peers:p:a", FederatedHandle: "@a@one.peers.touch"},
			{PeerID: "node-b", Name: "Station Two", URL: "http://localhost:18081", ActorPTID: "ptid:v1:actor:peers:p:b", FederatedHandle: "@a@two.peers.touch"},
			{PeerID: "node-c", Name: "Station Three", URL: "http://localhost:18082", ActorPTID: "ptid:v1:actor:peers:p:c", FederatedHandle: "@a@three.peers.touch"},
		},
	}
}
