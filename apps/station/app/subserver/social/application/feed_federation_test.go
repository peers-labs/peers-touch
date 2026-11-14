package application

import (
	"context"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

func TestFeedAuthorHomeFanoutIsNotMistakenForDirectVoterForwarding(t *testing.T) {
	s, database, _, request := feedServiceFixture(t)
	s.localStation = "station-b"
	s.projector = infrastructure.NewFeedProjector("station-b")
	receipt := &model.FeedInteraction{
		Genesis: request.Bundle.Genesis, WriterGrant: request.Bundle.WriterGrant,
		Event: request.Bundle.Events[0],
	}
	ctx := context.Background()
	if err := s.store.Execute(ctx, func(tx delivery.Transaction) error {
		_, err := s.receiveInteraction(ctx, tx, receipt, &delivery.Frame{
			SourceStationPeerId: "station-a", TargetStationPeerId: "station-b",
		})
		return err
	}); err != nil {
		t.Fatal(err)
	}
	var retained int64
	if err := database.Model(&infrastructure.FeedInteractionRecord{}).Count(&retained).Error; err != nil || retained != 1 {
		t.Fatal("author-Home fanout must retain the verified receipt until its parent arrives", retained, err)
	}
}
