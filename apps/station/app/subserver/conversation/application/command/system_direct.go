package command

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

// EnsureSystemDirectRequest is the internal creation input for a delegated
// service sender and its local recipient.
type EnsureSystemDirectRequest struct {
	Sender          valueobject.PTID
	Recipient       valueobject.PTID
	SystemSender    valueobject.Endpoint
	RecipientRoutes []ports.EndpointRoute
	FederationID    valueobject.FederationID
	AuthorityEpoch  valueobject.AuthorityEpoch
	CommandID       valueobject.CommandID
	ExactEventBytes []byte
}

// EnsureSystemDirect lazily creates the system-authored service Direct
// Conversation. Genesis deliveries go only to real owner devices; the
// reserved station-system creator authors the fact but receives no queue
// item. A second call with the same command id replays the receipt.
func (s *Service) EnsureSystemDirect(
	ctx context.Context,
	request EnsureSystemDirectRequest,
) (Result, error) {
	const operation = "application.ensure_system_direct"
	if request.Sender == "" || request.Recipient == "" ||
		request.CommandID == "" || len(request.ExactEventBytes) == 0 {
		return Result{}, invalid(operation, "request", "complete system direct creation input is required")
	}
	if request.SystemSender.Actor != request.Sender ||
		request.SystemSender.Device != valueobject.SystemStationDeviceID {
		return Result{}, invalid(operation, "creator", "creator must be the delegated sender under the reserved station-system device")
	}
	conversationID, err := valueobject.DirectConversationID(request.Sender, request.Recipient)
	if err != nil {
		return Result{}, err
	}
	commandHash := valueobject.HashBytes(request.ExactEventBytes)

	var result Result
	var notifications []ports.CommittedDelivery
	err = s.unitOfWork.ExecuteSerialized(
		ctx,
		conversationGenesisLockKey(conversationID),
		func(transaction ports.Transaction) error {
			if err := validateTransaction(transaction); err != nil {
				return err
			}
			if existing, loadErr := transaction.Repositories.Authority.LoadForUpdate(
				ctx,
				conversationID,
			); loadErr == nil {
				if err := validateExistingSystemDirect(existing, request, s.localStation); err != nil {
					return err
				}
				if _, receiptErr := transaction.Repositories.Receipts.Get(
					ctx,
					conversationID,
					request.CommandID,
				); receiptErr == nil {
					event, replayErr := replayCommittedCommand(
						ctx,
						transaction.Repositories,
						conversationID,
						request.CommandID,
						commandHash,
					)
					if replayErr != nil {
						return replayErr
					}
					result = Result{Conversation: existing, Event: event, Replay: true}
					return nil
				}
				// Conversation already exists under another system command;
				// creation is idempotent at the conversation level.
				result = Result{Conversation: existing, Replay: true}
				return nil
			} else if !conversationdomain.IsCode(
				loadErr,
				conversationdomain.ErrorCodeNotFound,
			) {
				return directCreationStage("load_authority", loadErr)
			}

			routes, err := canonicalActorRoutes(
				request.RecipientRoutes,
				[]valueobject.PTID{request.Recipient},
			)
			if err != nil {
				return err
			}
			for _, route := range routes {
				if route.HomeStation != s.localStation {
					return conversationdomain.NewError(
						conversationdomain.ErrorCodeUnauthorized,
						operation,
						"home_station",
						"system direct conversation is home-local in v1",
					)
				}
			}

			devices := []entity.MemberDevice{}
			botDevice, err := entity.NewMemberDevice(
				request.SystemSender,
				s.localStation,
				1,
			)
			if err != nil {
				return err
			}
			devices = append(devices, botDevice)
			for _, route := range routes {
				device, deviceErr := entity.NewMemberDevice(
					route.Endpoint,
					route.HomeStation,
					1,
				)
				if deviceErr != nil {
					return deviceErr
				}
				devices = append(devices, device)
			}

			genesisPayload, err := s.stateEncoder.EncodeConversationStateMarker(
				conversationID,
				valueobject.DeterministicEventID(conversationID, request.CommandID),
			)
			if err != nil {
				return err
			}
			deliveries := make([]valueobject.PreparedDelivery, 0, len(routes))
			for _, route := range routes {
				delivery, deliveryErr := valueobject.NewPreparedDelivery(
					route.Endpoint,
					route.HomeStation,
					valueobject.DeliveryKindConversation,
					genesisPayload,
				)
				if deliveryErr != nil {
					return deliveryErr
				}
				deliveries = append(deliveries, delivery)
			}

			created, transition, createErr := aggregate.CreateSystemDirect(
				aggregate.CreateInput{
					ID:               conversationID,
					Kind:             valueobject.ConversationKindDirect,
					FederationID:     request.FederationID,
					AuthorityStation: s.localStation,
					AuthorityEpoch:   request.AuthorityEpoch,
					Participants: []aggregate.Participant{
						{Actor: request.Sender, HomeStation: s.localStation},
						{Actor: request.Recipient, HomeStation: s.localStation},
					},
					Devices:      devices,
					CommandID:    request.CommandID,
					Creator:      request.SystemSender,
					Deliveries:   deliveries,
					EventPayload: request.ExactEventBytes,
					CreatedAt:    s.clock.Now(),
					EventSealer:  s.eventSealer,
				},
			)
			if createErr != nil {
				return createErr
			}
			if persistErr := s.persistTransition(
				ctx,
				transaction,
				created,
				transition,
				request.CommandID,
				commandHash,
				s.localStation,
			); persistErr != nil {
				return directPersistTransitionStage(persistErr)
			}
			notifications = committedDeliveries(transition, s.localStation)
			result = Result{
				Conversation: created.Snapshot(),
				Event:        transition.Event,
			}
			return nil
		},
	)
	if err != nil {
		return Result{}, err
	}
	result.PostCommitError = s.notify(ctx, notifications)
	return result, nil
}

func validateExistingSystemDirect(
	snapshot aggregate.Snapshot,
	request EnsureSystemDirectRequest,
	localStation valueobject.StationID,
) error {
	activeMembers := make(map[valueobject.PTID]bool, len(snapshot.Members))
	for _, member := range snapshot.Members {
		if member.Active() {
			activeMembers[member.Actor] = member.HomeStation == localStation
		}
	}
	systemSender := false
	for _, device := range snapshot.Devices {
		if device.Active && device.Endpoint == request.SystemSender &&
			device.HomeStation == localStation {
			systemSender = true
			break
		}
	}
	if snapshot.Kind != valueobject.ConversationKindDirect ||
		snapshot.Status != valueobject.ConversationStatusActive ||
		snapshot.AuthorityStation != localStation ||
		len(activeMembers) != 2 ||
		!activeMembers[request.Sender] ||
		!activeMembers[request.Recipient] ||
		!systemSender {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeCommandConflict,
			"application.ensure_system_direct",
			"conversation",
			"existing Direct is not the provisioned local service conversation",
		)
	}
	return nil
}
