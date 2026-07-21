package federation

import (
	"context"
	"crypto/ed25519"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"google.golang.org/protobuf/proto"
)

type TestnetSeedConfig struct {
	FederationName string
	Stations       []SeedStation
}

type SeedStation struct {
	PeerID  string
	Name    string
	URL     string
	ActorID string
	Handle  string
}

func SeedTestnet(ctx context.Context, cfg *TestnetSeedConfig, fedSvc *application.FederationService, ledgerSvc *application.LedgerService) error {
	if len(cfg.Stations) == 0 {
		return fmt.Errorf("at least one station required for seed")
	}

	creator := cfg.Stations[0]

	fed, err := fedSvc.CreateFederation(ctx, &application.CreateFederationInput{
		Name:          cfg.FederationName,
		Description:   "Testnet federation seeded at boot",
		PolicyType:    "single_admin",
		ActorID:       creator.ActorID,
		ActorHandle:   creator.Handle,
		StationPeerID: creator.PeerID,
		StationName:   creator.Name,
		StationURL:    creator.URL,
	})
	if err != nil {
		return fmt.Errorf("seed: create federation: %w", err)
	}

	log.Infof(ctx, "[federation-seed] created federation %s (%s)", fed.FederationID, fed.Name)

	for i := 1; i < len(cfg.Stations); i++ {
		station := cfg.Stations[i]

		payload := &pb.StationJoinApprovedPayload{
			ApprovedStationPeerId:          station.PeerID,
			ApprovedByActorId:              creator.ActorID,
			ApprovedByActorFederatedHandle: creator.Handle,
			Role:                           "member_station",
		}
		payloadBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(payload)
		if err != nil {
			return fmt.Errorf("seed: marshal join payload for %s: %w", station.PeerID, err)
		}

		_, actorPriv, _ := ed25519.GenerateKey(nil)
		_, stationPriv, _ := ed25519.GenerateKey(nil)

		_, err = ledgerSvc.AppendEvent(ctx, &application.AppendEventInput{
			FederationID:      fed.FederationID,
			EventType:         pb.EventType_STATION_JOIN_APPROVED,
			PayloadBytes:      payloadBytes,
			ActorID:           creator.ActorID,
			ActorHandle:       creator.Handle,
			StationPeerID:     creator.PeerID,
			ActorPrivateKey:   actorPriv,
			StationPrivateKey: stationPriv,
		})
		if err != nil {
			return fmt.Errorf("seed: join station %s: %w", station.PeerID, err)
		}

		log.Infof(ctx, "[federation-seed] station %s joined %s", station.PeerID, fed.FederationID)
	}

	state, err := fedSvc.Replay(ctx, fed.FederationID)
	if err != nil {
		return fmt.Errorf("seed: replay verification: %w", err)
	}

	log.Infof(ctx, "[federation-seed] verified: head_seq=%d, members=%d", state.HeadSeq, len(state.ActiveMemberStations))
	return nil
}

func DefaultTestnetSeedConfig() *TestnetSeedConfig {
	return &TestnetSeedConfig{
		FederationName: "Peers Testnet",
		Stations: []SeedStation{
			{PeerID: "node-a", Name: "Station One", URL: "http://10.37.94.156:18080", ActorID: "actor-a", Handle: "@a@one.peers.touch"},
			{PeerID: "node-b", Name: "Station Two", URL: "http://10.37.118.48:18080", ActorID: "actor-b", Handle: "@a@two.peers.touch"},
			{PeerID: "node-c", Name: "Station Three", URL: "http://10.37.246.80:18080", ActorID: "actor-c", Handle: "@a@three.peers.touch"},
		},
	}
}

var _ = domain.ErrForkDetected
