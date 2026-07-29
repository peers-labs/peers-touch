package federation

import (
	"context"
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
)

type LedgerEventPublisher struct {
	actorRoleRepo domain.ActorRoleRepository
}

func NewLedgerEventPublisher(actorRoleRepo domain.ActorRoleRepository) *LedgerEventPublisher {
	return &LedgerEventPublisher{actorRoleRepo: actorRoleRepo}
}

func (p *LedgerEventPublisher) PublishToLocalActors(ctx context.Context, event *pb.LedgerEvent) error {
	bus := events.GetBus()
	if bus == nil {
		return nil
	}

	actors, err := p.actorRoleRepo.ListByFederation(ctx, event.FederationId)
	if err != nil {
		log.Warnf(ctx, "[federation] SSE publish: failed to list actors for %s: %v", event.FederationId, err)
		return nil
	}
	if len(actors) == 0 {
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

	var errs []error
	for _, actor := range actors {
		if _, pubErr := bus.Publish(actor.ActorID, streamEvent); pubErr != nil {
			errs = append(errs, pubErr)
		}
	}
	return errors.Join(errs...)
}
