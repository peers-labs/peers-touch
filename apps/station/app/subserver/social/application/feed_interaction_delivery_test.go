package application

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

type feedTransportSigner struct{}

func (feedTransportSigner) KeyID() string { return "station-key" }
func (feedTransportSigner) Sign(_ context.Context, wire []byte) ([]byte, error) {
	return ed25519.Sign(ed25519.NewKeyFromSeed(bytes.Repeat([]byte{7}, 32)), wire), nil
}

func TestFeedInteractionExpirationRenewsTransportAndOnlyACKMarksForwarded(t *testing.T) {
	s, database, _, request := feedServiceFixture(t)
	ctx := context.Background()
	now := time.Now().UTC()
	s.now = func() time.Time { return now }
	s.signer = feedTransportSigner{}
	repository, err := delivery.NewGORMRepository(database, delivery.SystemClock{})
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	event := request.Bundle.Events[0]
	receipt := &model.FeedInteraction{Genesis: request.Bundle.Genesis, WriterGrant: request.Bundle.WriterGrant, Event: event}
	wire, _ := signedlog.Canonical(receipt)
	eventHash, _ := domain.FeedEventHash(event)
	row := infrastructure.FeedInteractionRecord{ActorPTID: event.Statement.ActorPtid, ChainID: event.Statement.ChainId,
		Sequence: event.Statement.Sequence, HomeStation: "station-a", TargetStation: "station-b", Interaction: wire, EventHash: eventHash}
	if err := database.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	forward := func() {
		t.Helper()
		if err := s.store.Execute(ctx, func(tx delivery.Transaction) error {
			return s.forwardInteraction(ctx, tx, "station-b", receipt)
		}); err != nil {
			t.Fatal(err)
		}
		if err := database.Take(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	forward()
	first := row.OutboundFrameID
	if first == "" || row.Forwarded || row.DeliveryRevision != 1 {
		t.Fatalf("enqueue treated as delivery: %+v", row)
	}
	forward()
	if row.OutboundFrameID != first || row.DeliveryRevision != 1 || row.Forwarded {
		t.Fatal("pending attempt replaced or acknowledged")
	}
	now = now.Add(25 * time.Hour)
	forward()
	if row.OutboundFrameID == first || row.DeliveryRevision != 2 || row.Forwarded || !bytes.Equal(row.Interaction, wire) {
		t.Fatal("expiration did not preserve receipt while renewing transport")
	}
	var frames []delivery.OutboxRecord
	if err := database.Order("created_at").Find(&frames).Error; err != nil || len(frames) != 2 {
		t.Fatal(frames, err)
	}
	for _, row := range frames {
		frame := &delivery.Frame{}
		if err := signedlog.Decode(row.FrameBytes, frame); err != nil || !bytes.Equal(frame.OpaquePayload, wire) {
			t.Fatal("transport retry changed signed receipt", err)
		}
	}
	if err := database.Model(&delivery.OutboxRecord{}).Where("frame_id = ?", row.OutboundFrameID).
		Update("state", delivery.OutboxStateDelivered).Error; err != nil {
		t.Fatal(err)
	}
	forward()
	if !row.Forwarded || row.DeliveryRevision != 2 {
		t.Fatal("delivered ACK not retained")
	}
}
