package federation

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
)

// LedgerEventPublisher bridges federation governance events into the
// SSE event stream, notifying all connected clients on this station
// that a new ledger event has been appended.
type LedgerEventPublisher struct{}

func NewLedgerEventPublisher() *LedgerEventPublisher {
	return &LedgerEventPublisher{}
}

// PublishToLocalActors broadcasts a ledger event to all actors connected
// to this station's SSE stream. Federation governance state is station-wide
// (all actors on the same station see the same federation membership), so
// we publish to a broadcast actor ID that the events subserver fans out.
func (p *LedgerEventPublisher) PublishToLocalActors(_ context.Context, event *pb.LedgerEvent) error {
	bus := events.GetBus()
	if bus == nil {
		return nil
	}

	streamEvent := &realtime.StreamEvent{
		TsUnixMs: time.Now().UnixMilli(),
		Kind: &realtime.StreamEvent_LedgerEventDelivered{
			LedgerEventDelivered: &realtime.LedgerEventDelivered{
				FederationId:           event.FederationId,
				Seq:                    event.Seq,
				EventHash:              event.EventHash,
				PrevHash:               event.PrevHash,
				EventType:              event.EventType.String(),
				PayloadBytes:           event.PayloadBytes,
				PayloadHash:            event.PayloadHash,
				ActorSignature:         event.ActorSignature,
				StationSignature:       event.StationSignature,
				SequencerSignature:     event.SequencerSignature,
				ActorId:                event.ActorId,
				ActorFederatedHandle:   event.ActorFederatedHandle,
				StationPeerId:          event.StationPeerId,
				SequencerStationPeerId: event.SequencerStationPeerId,
				CreatedAtUnixMs:        event.CreatedAtUnixMs,
			},
		},
	}

	// Broadcast to all connected actors using the wildcard publish.
	// The events bus delivers to every active SSE connection on this station.
	_, err := bus.Publish("*", streamEvent)
	return err
}
