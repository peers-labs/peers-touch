package conversation

import (
	"context"
	"errors"
	"fmt"
	"strings"

	interactionapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/interaction"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"google.golang.org/protobuf/proto"
)

// ProductionRealtimeAdapter publishes Conversation wakeups and projections
// through the canonical Station realtime event bus.
type ProductionRealtimeAdapter struct {
	resolveBus func() events.EventBus
}

// NewProductionRealtimeAdapter constructs a lazy adapter because Conversation
// may initialize before the events subserver installs the process EventBus.
func NewProductionRealtimeAdapter() *ProductionRealtimeAdapter {
	return newProductionRealtimeAdapter(events.GetBus)
}

func newProductionRealtimeAdapter(
	resolveBus func() events.EventBus,
) *ProductionRealtimeAdapter {
	return &ProductionRealtimeAdapter{resolveBus: resolveBus}
}

// NotifyCommitted emits device-targeted wake hints only after the caller's
// authority transaction has committed. The durable Device Inbox remains truth.
func (a *ProductionRealtimeAdapter) NotifyCommitted(
	ctx context.Context,
	deliveries []ports.CommittedDelivery,
) error {
	if ctx == nil {
		return fmt.Errorf("conversation production realtime: notify committed: context is required")
	}

	eventsToPublish := make([]productionRealtimePublication, 0, len(deliveries))
	seen := make(map[string]struct{}, len(deliveries))
	for _, delivery := range deliveries {
		if err := delivery.Recipient.Validate(); err != nil {
			return fmt.Errorf(
				"conversation production realtime: notify committed: invalid recipient: %w",
				err,
			)
		}
		if strings.TrimSpace(string(delivery.EventID)) == "" ||
			string(delivery.EventID) != strings.TrimSpace(string(delivery.EventID)) {
			return fmt.Errorf(
				"conversation production realtime: notify committed: event ID is required",
			)
		}

		key := delivery.Recipient.Key() + "\x00" + string(delivery.EventID)
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}

		wakePayload, err := marshalProductionRealtimePayload(
			&chatmodel.DeviceInboxWakeHint{
				Device: productionRealtimeEndpoint(delivery.Recipient),
			},
		)
		if err != nil {
			return fmt.Errorf(
				"conversation production realtime: encode delivery wake for event %s: %w",
				delivery.EventID,
				err,
			)
		}
		eventsToPublish = append(eventsToPublish, productionRealtimePublication{
			recipient: delivery.Recipient,
			event: &realtime.StreamEvent{
				Kind: &realtime.StreamEvent_EnvelopeDelivered{
					EnvelopeDelivered: &realtime.EnvelopeDelivered{
						InboxItemId:       string(delivery.EventID),
						EnvelopeId:        string(delivery.EventID),
						PayloadBytes:      wakePayload,
						RecipientDeviceId: string(delivery.Recipient.Device),
					},
				},
			},
		})
	}
	if len(eventsToPublish) == 0 {
		return nil
	}

	bus, err := a.bus()
	if err != nil {
		return err
	}

	var publishErrors []error
	for _, publication := range eventsToPublish {
		if err := ctx.Err(); err != nil {
			publishErrors = append(
				publishErrors,
				fmt.Errorf("conversation production realtime: notify committed: %w", err),
			)
			break
		}
		if _, err := bus.PublishToDevice(
			string(publication.recipient.Actor),
			string(publication.recipient.Device),
			publication.event,
		); err != nil {
			publishErrors = append(publishErrors, fmt.Errorf(
				"conversation production realtime: publish delivery wake actor=%s device=%s: %w",
				publication.recipient.Actor,
				publication.recipient.Device,
				err,
			))
		}
	}

	return errors.Join(publishErrors...)
}

// PublishTyping emits a droppable process-local typing projection.
func (a *ProductionRealtimeAdapter) PublishTyping(
	ctx context.Context,
	recipient valueobject.PTID,
	pulse interactionapp.TypingPulse,
) error {
	if ctx == nil {
		return fmt.Errorf("conversation production realtime: publish typing: context is required")
	}
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("conversation production realtime: publish typing: %w", err)
	}
	if strings.TrimSpace(string(recipient)) == "" ||
		string(recipient) != strings.TrimSpace(string(recipient)) ||
		pulse.ConversationID == "" ||
		pulse.Sender.Validate() != nil {
		return fmt.Errorf(
			"conversation production realtime: publish typing: recipient, conversation, and sender are required",
		)
	}

	bus, err := a.bus()
	if err != nil {
		return err
	}
	if _, err := bus.PublishEphemeral(string(recipient), &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_Typing{
			Typing: &realtime.TypingState{
				SessionUlid:   string(pulse.ConversationID),
				FromActorPtid: string(pulse.Sender.Actor),
				Typing:        pulse.IsTyping,
			},
		},
	}); err != nil {
		return fmt.Errorf(
			"conversation production realtime: publish typing recipient=%s conversation=%s: %w",
			recipient,
			pulse.ConversationID,
			err,
		)
	}

	return nil
}

func (a *ProductionRealtimeAdapter) bus() (events.EventBus, error) {
	if a == nil || a.resolveBus == nil {
		return nil, fmt.Errorf(
			"conversation production realtime: event bus resolver is unavailable",
		)
	}
	bus := a.resolveBus()
	if bus == nil {
		return nil, fmt.Errorf("conversation production realtime: event bus is unavailable")
	}

	return bus, nil
}

func productionRealtimeEndpoint(endpoint valueobject.Endpoint) *actormodel.ActorDeviceRef {
	return &actormodel.ActorDeviceRef{
		Actor: &actormodel.ActorRef{
			Ptid: string(endpoint.Actor),
		},
		DeviceId: string(endpoint.Device),
	}
}

func marshalProductionRealtimePayload(message proto.Message) ([]byte, error) {
	return proto.MarshalOptions{Deterministic: true}.Marshal(message)
}

type productionRealtimePublication struct {
	recipient valueobject.Endpoint
	event     *realtime.StreamEvent
}

var _ ProductionRealtime = (*ProductionRealtimeAdapter)(nil)
