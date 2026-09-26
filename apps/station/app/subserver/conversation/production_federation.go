package conversation

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/command"
	interactionapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/interaction"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/query"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	deliveryinfra "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/delivery"
	conversationfederation "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/federation"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/persistence"
	conversationhttp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/interface/http"
	federationinfra "github.com/peers-labs/peers-touch/station/app/subserver/federation/infrastructure"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	productionCommandProposalScope       = "conversation-command-proposal"
	productionCommandProposalVersion     = uint32(1)
	productionMaxCommandProposalLifetime = 5 * time.Minute
	productionMaxProposalClockSkew       = 30 * time.Second
)

var productionProposalLocks sync.Map
var productionDeliveryReceiptLocks [256]sync.Mutex
var productionReadCursorLocks [256]sync.Mutex

// RegisterFederationReceivers binds the four Conversation payload receivers
// exactly once before the shared Federation runtime is sealed.
func (c *ProductionComposition) RegisterFederationReceivers(ctx context.Context) error {
	if ctx == nil {
		return fmt.Errorf("register Conversation Federation receivers: context is required")
	}
	c.federationMu.Lock()
	defer c.federationMu.Unlock()
	if c.federationRegistered {
		return nil
	}

	shared, err := c.ResolveSharedDependencies()
	if err != nil {
		return err
	}
	typingSender, err := conversationfederation.NewTypingSender(
		c.federationSender,
		shared.Federation,
	)
	if err != nil {
		return err
	}
	typingService, err := c.InteractionService.BindFederatedTyping(
		productionTypingRouteDirectory{
			composition: c,
		},
		typingSender,
	)
	if err != nil {
		return err
	}
	typingHandler, err := conversationhttp.NewInteractionHandler(typingService)
	if err != nil {
		return err
	}
	receiver, err := conversationfederation.NewReceiver(
		conversationfederation.ReceiverConfig{
			LocalStationPeerID: shared.Federation.LocalStationPeerID(),
			ActorKeys:          shared.Actor,
			Federation:         productionFederationMembershipProjection{},
			AuthorityCommands:  &productionAuthorityCommandPort{composition: c},
			AuthorityResults:   &productionAuthorityResultPort{composition: c},
			DeviceDeliveries:   &productionDeviceDeliveryPort{composition: c},
			DeliveryReceipts:   &productionDeliveryReceiptPort{composition: c},
			ReadCursors:        &productionReadCursorPort{composition: c},
			Typing:             typingService,
			Sender:             c.federationSender,
			Clock:              c.clock,
		},
	)
	if err != nil {
		return err
	}
	if err := shared.Federation.RegisterReceivers(
		func(registry *federationdelivery.Registry) error {
			return conversationfederation.RegisterReceivers(registry, receiver)
		},
	); err != nil {
		return err
	}

	c.federationCapabilities, err = conversationfederation.NewCapabilityAdapter(
		conversationfederation.CapabilityAdapterConfig{
			LocalStationPeerID: shared.Federation.LocalStationPeerID(),
			EndpointManifests:  shared.Actor,
			MLSKeyPackages:     shared.KeyExchange,
			LeaveIntents: conversationfederation.LeaveIntentFuncs{
				Submit: c.submitFederatedLeaveIntent,
				List:   c.listFederatedLeaveIntents,
			},
			EventSync: conversationfederation.EventSyncFunc(
				c.syncFederatedAuthorityEvents,
			),
			Attachments: conversationfederation.AttachmentDataPlaneFuncs{
				GetUploadFunc:      c.getFederatedAttachmentUpload,
				BeginUploadFunc:    c.beginFederatedAttachmentUpload,
				PutChunkFunc:       c.putFederatedAttachmentChunk,
				CompleteUploadFunc: c.completeFederatedAttachmentUpload,
				CancelUploadFunc:   c.cancelFederatedAttachmentUpload,
				GetObjectFunc:      c.getFederatedAttachmentObject,
			},
		},
	)
	if err != nil {
		return err
	}
	c.InteractionService = typingService
	c.InteractionHandler = typingHandler
	c.federationRegistered = true

	return nil
}

func (c *ProductionComposition) federationCapabilityAdapter() (
	*conversationfederation.CapabilityAdapter,
	error,
) {
	c.federationMu.Lock()
	defer c.federationMu.Unlock()
	if c.federationCapabilities == nil {
		return nil, fmt.Errorf(
			"Conversation Federation capabilities are not registered",
		)
	}

	return c.federationCapabilities, nil
}

type productionFederationMembershipProjection struct{}

func (productionFederationMembershipProjection) IsActiveStation(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	federationID string,
	stationPeerID string,
) (bool, error) {
	if transaction == nil || transaction.DB() == nil {
		return false, fmt.Errorf(
			"resolve Conversation Federation membership: transaction is required",
		)
	}
	record, err := federationinfra.NewRepos(transaction.DB()).Membership.GetByStation(
		ctx,
		federationID,
		stationPeerID,
	)
	if err != nil {
		return false, err
	}

	return record != nil && strings.EqualFold(record.Status, "active"), nil
}

type productionAuthorityCommandPort struct {
	composition *ProductionComposition
}

func (p *productionAuthorityCommandPort) ApplyAuthorityCommand(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	verified conversationfederation.VerifiedAuthorityCommand,
) (conversationfederation.AuthorityCommandOutcome, error) {
	if p == nil || p.composition == nil ||
		transaction == nil || transaction.DB() == nil ||
		verified.Proposal == nil {
		return conversationfederation.AuthorityCommandOutcome{},
			fmt.Errorf("apply Conversation authority command: dependencies are incomplete")
	}
	boundUnitOfWork, err := p.composition.UnitOfWork.Bind(transaction.DB())
	if err != nil {
		return conversationfederation.AuthorityCommandOutcome{}, err
	}
	boundService, err := p.composition.bindFederationCommandService(
		transaction,
		boundUnitOfWork,
	)
	if err != nil {
		return conversationfederation.AuthorityCommandOutcome{}, err
	}
	proposal := verified.Proposal
	proposalCommand, err := conversationfederation.ParseProposalCommand(proposal)
	if err != nil {
		return conversationfederation.AuthorityCommandOutcome{},
			fmt.Errorf("apply Conversation authority command: %w", err)
	}
	authenticated := conversationhttp.AuthenticatedActor{
		PTID:     proposal.GetActorPtid(),
		DeviceID: proposal.GetActorDeviceId(),
	}
	conversationID, err := valueobject.NewConversationID(
		proposalCommand.ConversationID,
	)
	if err != nil {
		return productionAuthorityRejection(proposalCommand.CommandID, err), nil
	}
	sender, err := valueobject.NewEndpoint(
		proposal.GetActorPtid(),
		proposal.GetActorDeviceId(),
	)
	if err != nil {
		return productionAuthorityRejection(proposalCommand.CommandID, err), nil
	}
	sourceHomeStation, err := valueobject.NewStationID(verified.SourceHomeStation)
	if err != nil || string(sourceHomeStation) != proposal.GetHomeStationPeerId() {
		return productionAuthorityRejection(
			proposalCommand.CommandID,
			conversationdomain.NewError(
				conversationdomain.ErrorCodeProposalBinding,
				"production_federation.apply_authority_command",
				"home_station",
				"does not match the authenticated Federation source",
			),
		), nil
	}
	verifiedRoutes, err := p.composition.productionCommandRoutes(
		ctx,
		boundService,
		conversationID,
		sender.Actor,
	)
	if err != nil {
		return productionAuthorityRejection(proposalCommand.CommandID, err), nil
	}
	prepareRequest, err := productionPrepareCommandRequest(
		conversationID,
		sender,
		sourceHomeStation,
		verifiedRoutes,
		proposalCommand.Kind,
	)
	if err != nil {
		return productionAuthorityRejection(proposalCommand.CommandID, err), nil
	}
	preparation, err := boundService.PrepareCommand(
		ctx,
		prepareRequest,
	)
	if err != nil {
		return productionAuthorityRejection(proposalCommand.CommandID, err), nil
	}
	var mapped command.SubmitRequest
	switch {
	case proposalCommand.Chat != nil:
		plan, loadErr := loadCommandAuthorityPlan(
			ctx,
			boundUnitOfWork,
			proposalCommand.Chat,
		)
		if loadErr != nil {
			return productionAuthorityRejection(proposalCommand.CommandID, loadErr), nil
		}
		mapped, err = conversationhttp.MapSubmitCommand(
			authenticated,
			&chatmodel.SubmitConversationAuthorityCommandRequest{
				Submission: &chatmodel.SubmitConversationAuthorityCommandRequest_Command{
					Command: proposalCommand.Chat,
				},
			},
			preparation,
			plan,
			p.composition.clock.Now(),
		)
		if err == nil {
			mapped.VerifiedRoutes, mapped.ManifestStateHash, err =
				p.composition.productionSubmitCommandRoutes(
					ctx,
					plan,
					mapped.Membership != nil,
					verifiedRoutes,
				)
		}
	case proposalCommand.MemberAuthority != nil:
		mapped, err = conversationhttp.MapMemberAuthorityCommand(
			authenticated,
			proposalCommand.MemberAuthority,
			preparation,
			p.composition.clock.Now(),
		)
		mapped.VerifiedRoutes = verifiedRoutes
	default:
		err = conversationdomain.NewError(
			conversationdomain.ErrorCodeUnsupportedTransition,
			"production_federation.apply_authority_command",
			"command_kind",
			"is not supported",
		)
	}
	if err != nil {
		return productionAuthorityRejection(proposalCommand.CommandID, err), nil
	}
	if !bytes.Equal(mapped.ExactCommandBytes, verified.CanonicalCommandBytes) {
		return productionAuthorityRejection(
			proposalCommand.CommandID,
			conversationdomain.NewError(
				conversationdomain.ErrorCodeProposalBinding,
				"production_federation.apply_authority_command",
				"command_bytes",
				"do not match the verified Federation payload",
			),
		), nil
	}
	commandHash, err := valueobject.NewHash(proposal.GetCommandSha256())
	if err != nil {
		return productionAuthorityRejection(proposalCommand.CommandID, err), nil
	}
	result, err := boundService.SubmitForwarded(
		ctx,
		command.ForwardedCommandRequest{
			Version:          proposal.GetVersion(),
			FederationID:     valueobject.FederationID(proposal.GetFederationId()),
			AuthorityStation: valueobject.StationID(proposal.GetAuthorityStationPeerId()),
			AuthorityEpoch:   valueobject.AuthorityEpoch(proposal.GetAuthorityEpoch()),
			HomeStation:      sourceHomeStation,
			Actor:            sender,
			SigningKeyID:     proposal.GetActorSigningKeyId(),
			CommandHash:      commandHash,
			Signature:        append([]byte(nil), proposal.GetActorSignature()...),
			CreatedAt:        time.UnixMilli(proposal.GetCreatedAtUnixMs()).UTC(),
			ExpiresAt:        time.UnixMilli(proposal.GetExpiresAtUnixMs()).UTC(),
			Claims: command.ForwardedCommandClaims{
				Scope:          productionCommandProposalScope,
				Issuer:         sourceHomeStation,
				Audience:       valueobject.StationID(proposal.GetAuthorityStationPeerId()),
				Subject:        valueobject.PTID(proposal.GetActorPtid()),
				FederationID:   valueobject.FederationID(proposal.GetFederationId()),
				ConversationID: conversationID,
				CommandID:      valueobject.CommandID(proposalCommand.CommandID),
				CommandKind:    mapped.Command.Kind,
				DeviceID:       valueobject.DeviceID(proposal.GetActorDeviceId()),
				SigningKeyID:   proposal.GetActorSigningKeyId(),
				CommandHash:    commandHash,
				AuthorityEpoch: valueobject.AuthorityEpoch(proposal.GetAuthorityEpoch()),
				ExpiresAt:      time.UnixMilli(proposal.GetExpiresAtUnixMs()).UTC(),
			},
			Command: mapped,
		},
	)
	if err != nil {
		return productionAuthorityRejection(proposalCommand.CommandID, err), nil
	}
	if result.PostCommitError != nil {
		return conversationfederation.AuthorityCommandOutcome{},
			fmt.Errorf(
				"publish forwarded Conversation event %s: %w",
				result.Event.ID,
				result.PostCommitError,
			)
	}
	event, err := conversationhttp.MapEvent(result.Event)
	if err != nil {
		return conversationfederation.AuthorityCommandOutcome{}, err
	}

	return conversationfederation.AuthorityCommandOutcome{
		Result: &chatmodel.ConversationCommandProposalResult{
			CommandId:          proposalCommand.CommandID,
			Accepted:           true,
			Event:              event,
			AuthoritySequence:  event.GetSequence(),
			AuthorityEventHash: append([]byte(nil), event.GetEventHash()...),
		},
		Replay: result.Replay,
	}, nil
}

func productionAuthorityRejection(
	commandID string,
	err error,
) conversationfederation.AuthorityCommandOutcome {
	return conversationfederation.AuthorityCommandOutcome{
		Result: &chatmodel.ConversationCommandProposalResult{
			CommandId:  commandID,
			RejectCode: conversationhttp.MapRejectCode(err),
			Retryable: conversationdomain.IsCode(
				err,
				conversationdomain.ErrorCodeActorKeyUnavailable,
			),
		},
	}
}

type productionAuthorityResultPort struct {
	composition *ProductionComposition
}

func (p *productionAuthorityResultPort) ApplyAuthorityResult(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	result *chatmodel.ConversationCommandResultDelivery,
	originatingCommandSHA256 []byte,
	sourceAuthorityStationPeerID string,
) (bool, error) {
	if p == nil || p.composition == nil ||
		transaction == nil || transaction.DB() == nil ||
		result == nil || result.GetResult() == nil ||
		len(originatingCommandSHA256) != sha256.Size {
		return false, fmt.Errorf(
			"apply Conversation authority result: dependencies or identity are incomplete",
		)
	}
	proposal, err := loadOutgoingConversationProposal(
		ctx,
		transaction.DB(),
		result.GetCommandId(),
		sourceAuthorityStationPeerID,
	)
	if err != nil {
		return false, err
	}
	proposalCommand, err := conversationfederation.ParseProposalCommand(proposal)
	if err != nil {
		return false, err
	}
	if proposalCommand.ConversationID != result.GetConversationId() ||
		!bytes.Equal(proposal.GetCommandSha256(), originatingCommandSHA256) {
		return false, conversationfederation.ErrAuthorityResultCommandHashMismatch
	}
	payload, err := deterministicProductionProto(result)
	if err != nil {
		return false, err
	}
	payloadHash := valueobject.HashBytes(payload)
	recipient := valueobject.Endpoint{
		Actor:  valueobject.PTID(proposal.GetActorPtid()),
		Device: valueobject.DeviceID(proposal.GetActorDeviceId()),
	}
	itemID, err := deliveryinfra.CommandResultItemID(
		recipient,
		valueobject.ConversationID(result.GetConversationId()),
		valueobject.CommandID(result.GetCommandId()),
	)
	if err != nil {
		return false, err
	}
	var existing deliveryinfra.DeviceQueueItemModel
	existingErr := transaction.DB().WithContext(ctx).
		Where(
			"recipient_ptid = ? AND recipient_device_id = ? AND idempotency_key = ?",
			proposal.GetActorPtid(),
			proposal.GetActorDeviceId(),
			itemID,
		).
		First(&existing).Error
	if existingErr == nil {
		if !bytes.Equal(existing.PayloadSHA256, payloadHash.Bytes()) {
			return false, conversationdomain.NewError(
				conversationdomain.ErrorCodeCommandConflict,
				"production_federation.apply_authority_result",
				"idempotency_key",
				"already identifies different result bytes",
			)
		}

		return true, nil
	}
	if !errors.Is(existingErr, gorm.ErrRecordNotFound) {
		return false, existingErr
	}
	adapter, err := p.composition.transactionalAdapters.Bind(transaction.DB())
	if err != nil {
		return false, err
	}
	eventSequence := valueobject.Sequence(1)
	eventID := valueobject.EventID(payloadHash.String())
	if event := result.GetResult().GetEvent(); event != nil {
		eventSequence = valueobject.Sequence(event.GetSequence())
		eventID = valueobject.EventID(event.GetEventId())
	} else if sequence := result.GetResult().GetAuthoritySequence(); sequence > 0 {
		eventSequence = valueobject.Sequence(sequence)
	}
	if err := adapter.DeviceInbox.Enqueue(ctx, ports.DeviceInboxIntent{
		IntentID:       itemID,
		ConversationID: valueobject.ConversationID(result.GetConversationId()),
		EventID:        eventID,
		EventSequence:  eventSequence,
		Recipient:      recipient,
		IdempotencyKey: itemID,
		PayloadKind:    ports.DeviceInboxPayloadCommandResult,
		OpaquePayload:  payload,
		PayloadHash:    payloadHash,
		CreatedAt:      p.composition.clock.Now().UTC(),
	}); err != nil {
		return false, err
	}

	return false, nil
}

type productionDeviceDeliveryPort struct {
	composition *ProductionComposition
}

func (p *productionDeviceDeliveryPort) ApplyDeviceDelivery(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	intent ports.DeviceInboxIntent,
	sourceAuthorityStationPeerID string,
) (bool, error) {
	if p == nil || p.composition == nil ||
		transaction == nil || transaction.DB() == nil {
		return false, fmt.Errorf(
			"apply Conversation device delivery: dependencies are incomplete",
		)
	}
	var existing deliveryinfra.DeviceQueueItemModel
	existingErr := transaction.DB().WithContext(ctx).
		Where(
			"recipient_ptid = ? AND recipient_device_id = ? AND idempotency_key = ?",
			string(intent.Recipient.Actor),
			string(intent.Recipient.Device),
			intent.IdempotencyKey,
		).
		First(&existing).Error
	if existingErr != nil && !errors.Is(existingErr, gorm.ErrRecordNotFound) {
		return false, existingErr
	}
	if intent.PayloadKind == ports.DeviceInboxPayloadDeviceReceipt {
		boundUnitOfWork, err := p.composition.UnitOfWork.Bind(transaction.DB())
		if err != nil {
			return false, err
		}
		boundQuery, err := query.NewService(boundUnitOfWork)
		if err != nil {
			return false, err
		}
		view, err := boundQuery.Get(
			ctx,
			intent.ConversationID,
			intent.Recipient.Actor,
		)
		if err != nil {
			return false, err
		}
		if err := validateFollowerDeviceDeliverySource(
			view,
			p.composition.localStation,
			valueobject.StationID(sourceAuthorityStationPeerID),
		); err != nil {
			return false, err
		}
		active, err := (productionFederationMembershipProjection{}).IsActiveStation(
			ctx,
			transaction,
			string(view.Conversation.FederationID),
			sourceAuthorityStationPeerID,
		)
		if err != nil {
			return false, err
		}
		if !active {
			return false, conversationdomain.NewError(
				conversationdomain.ErrorCodeUnauthorized,
				"production_federation.apply_device_delivery",
				"authority_station_peer_id",
				"is not active in the Conversation federation",
			)
		}
	}
	if intent.PayloadKind == ports.DeviceInboxPayloadConversationEvent {
		var delivery chatmodel.DeviceEventDelivery
		if err := proto.Unmarshal(intent.OpaquePayload, &delivery); err != nil {
			return false, fmt.Errorf(
				"decode Conversation device event delivery: %w",
				err,
			)
		}
		record, err := productionRecordFromWire(delivery.GetEvent())
		if err != nil {
			return false, err
		}
		if record.AuthorityStation !=
			valueobject.StationID(sourceAuthorityStationPeerID) {
			return false, conversationdomain.NewError(
				conversationdomain.ErrorCodeHashChainInvalid,
				"production_federation.apply_device_delivery",
				"authority_station_peer_id",
				"does not match the authenticated source Station",
			)
		}
		boundUnitOfWork, err := p.composition.UnitOfWork.Bind(transaction.DB())
		if err != nil {
			return false, err
		}
		boundService, err := p.composition.CommandService.BindUnitOfWork(boundUnitOfWork)
		if err != nil {
			return false, err
		}
		if err := boundService.ApplyFollowerEvent(ctx, record); err != nil {
			return false, err
		}
	}
	adapter, err := p.composition.transactionalAdapters.Bind(transaction.DB())
	if err != nil {
		return false, err
	}
	if err := adapter.DeviceInbox.Enqueue(ctx, intent); err != nil {
		return false, err
	}

	return existingErr == nil, nil
}

func validateFollowerDeviceDeliverySource(
	view query.ConversationView,
	localStation valueobject.StationID,
	sourceAuthority valueobject.StationID,
) error {
	if view.Source != query.SourceFollower ||
		view.FollowerStatus != repository.FollowerStatusActive ||
		view.Conversation.AuthorityStation == "" ||
		view.Conversation.AuthorityStation == localStation ||
		view.Conversation.AuthorityStation != sourceAuthority {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"production_federation.apply_device_delivery",
			"authority_station_peer_id",
			"does not match the active follower Conversation authority",
		)
	}

	return nil
}

type productionDeliveryReceiptForwarder struct {
	database     *gorm.DB
	sender       *conversationfederation.Sender
	clock        federationdelivery.Clock
	localStation valueobject.StationID
}

type productionReadCursorForwarder struct {
	database     *gorm.DB
	sender       *conversationfederation.Sender
	clock        federationdelivery.Clock
	localStation valueobject.StationID
}

type productionFederationPostCommitPublisher struct {
	registrar federationdelivery.AfterCommitRegistrar
	delegate  ports.PostCommitPublisher
}

type productionFederatedReadCursorAdvancer struct {
	service    *command.Service
	readerHome valueobject.StationID
	routes     []ports.EndpointRoute
}

type productionDeliveryReceiptCommitter struct {
	database     *gorm.DB
	adapters     *ProductionTransactionalAdapterFactory
	localStation valueobject.StationID
	clock        federationdelivery.Clock
}

func (c *productionDeliveryReceiptCommitter) CommitDeliveryReceipt(
	ctx context.Context,
	receipt interactionapp.DeliveryReceipt,
) (interactionapp.DeliveryRecordResult, error) {
	if c == nil || c.database == nil || c.adapters == nil ||
		c.localStation == "" || c.clock == nil {
		return interactionapp.DeliveryRecordResult{}, fmt.Errorf(
			"commit Conversation delivery receipt: dependencies are incomplete",
		)
	}
	var recorded interactionapp.DeliveryRecordResult
	err := c.database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		recorder, err := deliveryinfra.NewReceiptRecorder(tx)
		if err != nil {
			return err
		}
		recorded, err = recorder.Record(ctx, receipt)
		if err != nil {
			return err
		}
		if recorded.MessageID == "" ||
			recorded.Originator == receipt.Consumer.Actor {
			return nil
		}
		adapters, err := c.adapters.Bind(tx)
		if err != nil {
			return err
		}
		return enqueueDeliveryReceiptProjections(
			ctx,
			tx,
			adapters,
			c.localStation,
			c.clock.Now().UTC(),
			receipt,
			recorded,
		)
	})
	if err != nil {
		if interactionapp.CodeOf(err) != "" {
			return interactionapp.DeliveryRecordResult{}, err
		}
		return interactionapp.DeliveryRecordResult{}, interactionapp.WrapError(
			interactionapp.ErrorCodePersistence,
			"production_federation.commit_delivery_receipt",
			err,
		)
	}

	return recorded, nil
}

func enqueueDeliveryReceiptProjections(
	ctx context.Context,
	tx *gorm.DB,
	adapters persistence.TransactionalAdapters,
	localStation valueobject.StationID,
	projectionAt time.Time,
	receipt interactionapp.DeliveryReceipt,
	recorded interactionapp.DeliveryRecordResult,
) error {
	if tx == nil || projectionAt.IsZero() {
		return fmt.Errorf(
			"commit Conversation delivery receipt: transaction and projection time are required",
		)
	}
	payload, err := deterministicProductionProto(
		&chatmodel.MessageReceipt{
			ConversationId: string(receipt.ConversationID),
			MessageId:      string(recorded.MessageID),
			Ptid:           string(receipt.Consumer.Actor),
			DeviceId:       string(receipt.Consumer.Device),
			ReceiptType:    chatmodel.ReceiptType_RECEIPT_TYPE_DELIVERED,
			Ts:             timestamppb.New(receipt.ConsumedAt.UTC()),
		},
	)
	if err != nil {
		return err
	}
	payloadHash := valueobject.HashBytes(payload)
	for _, route := range recorded.OriginatorRoutes {
		if route.Endpoint.Validate() != nil ||
			route.Endpoint.Actor != recorded.Originator ||
			route.HomeStation == "" {
			return fmt.Errorf(
				"commit Conversation delivery receipt: invalid originator route",
			)
		}
		if route.Endpoint == receipt.Consumer {
			continue
		}
		intentID := valueobject.HashBytes(valueobject.CanonicalTuple(
			[]byte("conversation-delivery-receipt"),
			[]byte(receipt.ReceiptID),
			[]byte(route.Endpoint.Actor),
			[]byte(route.Endpoint.Device),
		)).String()
		intent := ports.DeviceInboxIntent{
			IntentID:       intentID,
			ConversationID: receipt.ConversationID,
			EventID:        valueobject.EventID(recorded.MessageID),
			EventSequence:  recorded.Aggregate.EventSequence,
			Recipient:      route.Endpoint,
			IdempotencyKey: intentID,
			PayloadKind:    ports.DeviceInboxPayloadDeviceReceipt,
			OpaquePayload:  payload,
			PayloadHash:    payloadHash,
			CreatedAt:      projectionAt,
		}
		if route.HomeStation == localStation {
			if err := adapters.DeviceInbox.Enqueue(ctx, intent); err != nil {
				return err
			}
			continue
		}
		existing, err := existingFederatedReceiptProjection(
			ctx,
			tx,
			localStation,
			route.HomeStation,
			intent,
		)
		if err != nil {
			return err
		}
		if existing {
			continue
		}
		if err := adapters.FederationOutbox.Enqueue(
			ctx,
			ports.FederationOutboxIntent{
				IntentID:       intent.IntentID,
				ConversationID: intent.ConversationID,
				EventID:        intent.EventID,
				EventSequence:  intent.EventSequence,
				Recipient:      intent.Recipient,
				TargetStation:  route.HomeStation,
				IdempotencyKey: intent.IdempotencyKey,
				PayloadKind:    intent.PayloadKind,
				OpaquePayload:  intent.OpaquePayload,
				PayloadHash:    intent.PayloadHash,
				CreatedAt:      intent.CreatedAt,
			},
		); err != nil {
			return err
		}
	}

	return nil
}

func existingFederatedReceiptProjection(
	ctx context.Context,
	tx *gorm.DB,
	localStation valueobject.StationID,
	targetStation valueobject.StationID,
	intent ports.DeviceInboxIntent,
) (bool, error) {
	var existing federationdelivery.OutboxRecord
	err := tx.WithContext(ctx).Where(
		"source_station_peer_id = ? AND idempotency_key = ?",
		string(localStation),
		intent.IdempotencyKey,
	).First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var frame federationdelivery.Frame
	if err := proto.Unmarshal(existing.FrameBytes, &frame); err != nil {
		return false, err
	}
	var item chatmodel.DurableDeviceInboxItem
	if err := proto.Unmarshal(frame.GetOpaquePayload(), &item); err != nil {
		return false, err
	}
	if frame.GetPayloadKind() !=
		federationdelivery.PayloadKindConversationDeviceDelivery ||
		frame.GetTargetStationPeerId() != string(targetStation) ||
		frame.GetOrderingSequence() != int64(intent.EventSequence) ||
		item.GetItemId() != intent.IntentID ||
		item.GetIdempotencyKey() != intent.IdempotencyKey ||
		item.GetConversationId() != string(intent.ConversationID) ||
		item.GetEventId() != string(intent.EventID) ||
		item.GetRecipient().GetActor().GetPtid() != string(intent.Recipient.Actor) ||
		item.GetRecipient().GetDeviceId() != string(intent.Recipient.Device) ||
		item.GetPayloadType() !=
			chatmodel.DeviceInboxPayloadType_DEVICE_INBOX_PAYLOAD_TYPE_DEVICE_RECEIPT ||
		!bytes.Equal(item.GetOpaquePayload(), intent.OpaquePayload) ||
		!bytes.Equal(item.GetPayloadSha256(), intent.PayloadHash.Bytes()) {
		return false, interactionapp.NewError(
			interactionapp.ErrorCodeIdempotencyConflict,
			"production_federation.commit_delivery_receipt",
			"idempotency_key",
			"already identifies different receipt projection bytes",
		)
	}

	return true, nil
}

func (f *productionDeliveryReceiptForwarder) ForwardDeliveryReceipt(
	ctx context.Context,
	authority valueobject.StationID,
	receipt interactionapp.DeliveryReceipt,
) (bool, error) {
	if f == nil || f.database == nil || f.sender == nil || f.clock == nil ||
		f.localStation == "" {
		return false, fmt.Errorf(
			"forward Conversation delivery receipt: dependencies are incomplete",
		)
	}
	wire, err := productionDeliveryReceiptToWire(receipt)
	if err != nil {
		return false, err
	}
	payload, err := deterministicProductionProto(wire)
	if err != nil {
		return false, err
	}
	lockDigest := sha256.Sum256([]byte(receipt.ReceiptID))
	lock := &productionDeliveryReceiptLocks[lockDigest[0]]
	lock.Lock()
	defer lock.Unlock()

	var replay bool
	err = f.database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if tx.Dialector.Name() == "postgres" {
			lockID := productionAdvisoryLockID(
				"conversation-delivery-receipt:" + receipt.ReceiptID,
			)
			if err := tx.Exec(
				"SELECT pg_advisory_xact_lock(?)",
				lockID,
			).Error; err != nil {
				return fmt.Errorf(
					"lock Conversation delivery receipt: %w",
					err,
				)
			}
		}
		recorder, err := deliveryinfra.NewReceiptRecorder(tx)
		if err != nil {
			return err
		}
		if _, err := recorder.RecordFollowerConsumption(
			ctx,
			authority,
			receipt,
		); err != nil {
			return err
		}
		var existing federationdelivery.OutboxRecord
		existingErr := tx.Where(
			"source_station_peer_id = ? AND payload_kind = ? AND payload_id = ?",
			string(f.localStation),
			int32(federationdelivery.PayloadKindConversationDeliveryReceipt),
			receipt.ReceiptID,
		).First(&existing).Error
		if existingErr == nil {
			var frame federationdelivery.Frame
			if err := proto.Unmarshal(existing.FrameBytes, &frame); err != nil {
				return err
			}
			if frame.GetPayloadKind() !=
				federationdelivery.PayloadKindConversationDeliveryReceipt ||
				frame.GetTargetStationPeerId() != string(authority) ||
				frame.GetPayloadId() != receipt.ReceiptID ||
				!bytes.Equal(frame.GetOpaquePayload(), payload) {
				return interactionapp.NewError(
					interactionapp.ErrorCodeIdempotencyConflict,
					"production_federation.forward_delivery_receipt",
					"receipt_id",
					"already identifies different receipt bytes",
				)
			}
			replay = true

			return nil
		}
		if !errors.Is(existingErr, gorm.ErrRecordNotFound) {
			return existingErr
		}
		outbox, err := federationdelivery.NewGORMRepository(tx, f.clock)
		if err != nil {
			return err
		}
		result, err := f.sender.EnqueueDeliveryReceipt(
			ctx,
			outbox,
			string(authority),
			wire,
		)
		if err != nil {
			return err
		}
		replay = result.Duplicate

		return nil
	})
	if err != nil {
		if errors.Is(err, federationdelivery.ErrPayloadHashConflict) {
			return false, interactionapp.NewError(
				interactionapp.ErrorCodeIdempotencyConflict,
				"production_federation.forward_delivery_receipt",
				"receipt_id",
				"already identifies different receipt bytes",
			)
		}
		return false, fmt.Errorf(
			"forward Conversation delivery receipt to authority %s: %w",
			authority,
			err,
		)
	}

	return replay, nil
}

func (f *productionReadCursorForwarder) ForwardReadCursor(
	ctx context.Context,
	authority valueobject.StationID,
	federationID valueobject.FederationID,
	authorityEpoch valueobject.AuthorityEpoch,
	request interactionapp.ReadCursorRequest,
) (bool, error) {
	if f == nil || f.database == nil || f.sender == nil || f.clock == nil ||
		f.localStation == "" {
		return false, fmt.Errorf(
			"forward Conversation read cursor: dependencies are incomplete",
		)
	}
	wire, err := productionReadCursorToWire(
		request,
		federationID,
		authority,
		authorityEpoch,
		f.localStation,
	)
	if err != nil {
		return false, err
	}
	payload, err := deterministicProductionProto(wire)
	if err != nil {
		return false, err
	}
	payloadID, err := conversationfederation.ReadCursorPayloadID(wire)
	if err != nil {
		return false, err
	}
	lockDigest := sha256.Sum256([]byte(payloadID))
	lock := &productionReadCursorLocks[lockDigest[0]]
	lock.Lock()
	defer lock.Unlock()

	var replay bool
	err = f.database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if tx.Dialector.Name() == "postgres" {
			lockID := productionAdvisoryLockID(
				"conversation-read-cursor:" + payloadID,
			)
			if err := tx.Exec(
				"SELECT pg_advisory_xact_lock(?)",
				lockID,
			).Error; err != nil {
				return fmt.Errorf(
					"lock Conversation read cursor: %w",
					err,
				)
			}
		}
		var existing federationdelivery.OutboxRecord
		existingErr := tx.Where(
			"source_station_peer_id = ? AND payload_kind = ? AND payload_id = ?",
			string(f.localStation),
			int32(federationdelivery.PayloadKindConversationReadCursor),
			payloadID,
		).First(&existing).Error
		if existingErr == nil {
			var frame federationdelivery.Frame
			if err := proto.Unmarshal(existing.FrameBytes, &frame); err != nil {
				return err
			}
			if frame.GetPayloadKind() !=
				federationdelivery.PayloadKindConversationReadCursor ||
				frame.GetTargetStationPeerId() != string(authority) ||
				frame.GetPayloadId() != payloadID ||
				frame.GetOrderingSequence() != int64(request.Sequence) ||
				!bytes.Equal(frame.GetOpaquePayload(), payload) {
				return interactionapp.NewError(
					interactionapp.ErrorCodeIdempotencyConflict,
					"production_federation.forward_read_cursor",
					"cursor",
					"already identifies different read cursor bytes",
				)
			}
			replay = true

			return nil
		}
		if !errors.Is(existingErr, gorm.ErrRecordNotFound) {
			return existingErr
		}
		outbox, err := federationdelivery.NewGORMRepository(tx, f.clock)
		if err != nil {
			return err
		}
		result, err := f.sender.EnqueueReadCursor(
			ctx,
			outbox,
			string(authority),
			wire,
		)
		if err != nil {
			return err
		}
		replay = result.Duplicate

		return nil
	})
	if err != nil {
		if errors.Is(err, federationdelivery.ErrPayloadHashConflict) {
			return false, interactionapp.NewError(
				interactionapp.ErrorCodeIdempotencyConflict,
				"production_federation.forward_read_cursor",
				"cursor",
				"already identifies different read cursor bytes",
			)
		}
		return false, fmt.Errorf(
			"forward Conversation read cursor to authority %s: %w",
			authority,
			err,
		)
	}

	return replay, nil
}

func (p *productionFederationPostCommitPublisher) NotifyCommitted(
	ctx context.Context,
	deliveries []ports.CommittedDelivery,
) error {
	if p == nil || p.registrar == nil || p.delegate == nil || ctx == nil {
		return fmt.Errorf(
			"defer Conversation Federation wake: dependencies are incomplete",
		)
	}
	pending := append([]ports.CommittedDelivery(nil), deliveries...)

	return p.registrar.AfterCommit(func(callbackContext context.Context) error {
		return p.delegate.NotifyCommitted(callbackContext, pending)
	})
}

func (c *ProductionComposition) bindFederationCommandService(
	transaction federationdelivery.Transaction,
	unitOfWork ports.UnitOfWork,
) (*command.Service, error) {
	if c == nil || transaction == nil || unitOfWork == nil || c.realtime == nil {
		return nil, fmt.Errorf(
			"bind Conversation Federation command service: dependencies are incomplete",
		)
	}
	registrar, ok := transaction.(federationdelivery.AfterCommitRegistrar)
	if !ok {
		return nil, fmt.Errorf(
			"bind Conversation Federation command service: post-commit registrar is required",
		)
	}
	bound, err := c.CommandService.BindUnitOfWork(unitOfWork)
	if err != nil {
		return nil, err
	}

	return bound.BindPostCommitPublisher(
		&productionFederationPostCommitPublisher{
			registrar: registrar,
			delegate:  c.realtime,
		},
	)
}

func (a *productionFederatedReadCursorAdvancer) AdvanceReadCursor(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	reader valueobject.Endpoint,
	sequence valueobject.Sequence,
) (command.ReadCursorResult, error) {
	if a == nil || a.service == nil || a.readerHome == "" {
		return command.ReadCursorResult{}, fmt.Errorf(
			"advance federated Conversation read cursor: dependencies are incomplete",
		)
	}

	return a.service.AdvanceReadCursorFromVerifiedHome(
		ctx,
		conversationID,
		reader,
		a.readerHome,
		sequence,
		a.routes,
	)
}

type productionDeliveryReceiptPort struct {
	composition *ProductionComposition
}

func (p *productionDeliveryReceiptPort) ApplyDeliveryReceipt(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	wire *chatmodel.DeviceConsumptionReceipt,
	sourceHomeStationPeerID string,
) (bool, error) {
	if p == nil || p.composition == nil ||
		transaction == nil || transaction.DB() == nil {
		return false, fmt.Errorf(
			"apply Conversation delivery receipt: dependencies are incomplete",
		)
	}
	receipt, err := productionDeliveryReceiptFromWire(
		wire,
		sourceHomeStationPeerID,
	)
	if err != nil {
		return false, fmt.Errorf(
			"%w: %v",
			conversationfederation.ErrDeliveryReceiptRejected,
			err,
		)
	}
	boundUnitOfWork, err := p.composition.UnitOfWork.Bind(transaction.DB())
	if err != nil {
		return false, err
	}
	boundQuery, err := query.NewService(boundUnitOfWork)
	if err != nil {
		return false, err
	}
	route, err := boundQuery.ResolveRoute(
		ctx,
		receipt.ConversationID,
	)
	if err != nil ||
		route.Source != query.SourceAuthority ||
		route.AuthorityStation != p.composition.localStation {
		return false, fmt.Errorf(
			"%w: receipt does not target the local Conversation authority",
			conversationfederation.ErrDeliveryReceiptRejected,
		)
	}
	boundCommitter := &productionDeliveryReceiptCommitter{
		database:     transaction.DB(),
		adapters:     p.composition.transactionalAdapters,
		localStation: p.composition.localStation,
		clock:        p.composition.clock,
	}
	boundService, err := p.composition.InteractionService.BindAuthorityPorts(
		boundQuery,
		productionInteractionDeviceDirectory{
			identity: &productionIdentityDirectory{db: transaction.DB()},
		},
		boundCommitter,
	)
	if err != nil {
		return false, err
	}
	result, err := boundService.SubmitDeliveryReceipt(
		ctx,
		receipt,
	)
	if err == nil {
		return result.Replay, nil
	}
	switch interactionapp.CodeOf(err) {
	case interactionapp.ErrorCodeIdempotencyConflict:
		return false, fmt.Errorf(
			"%w: %v",
			conversationfederation.ErrDeliveryReceiptConflict,
			err,
		)
	case interactionapp.ErrorCodeInvalidArgument,
		interactionapp.ErrorCodeUnauthorized,
		interactionapp.ErrorCodeIntegrityFailed:
		return false, fmt.Errorf(
			"%w: %v",
			conversationfederation.ErrDeliveryReceiptRejected,
			err,
		)
	default:
		return false, err
	}
}

type productionReadCursorPort struct {
	composition *ProductionComposition
}

func (p *productionReadCursorPort) ApplyReadCursor(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	wire *chatmodel.FederatedConversationReadCursor,
	sourceHomeStationPeerID string,
) error {
	if p == nil || p.composition == nil ||
		transaction == nil || transaction.DB() == nil {
		return fmt.Errorf(
			"apply Conversation read cursor: dependencies are incomplete",
		)
	}
	request, federationID, authority, authorityEpoch, err :=
		productionReadCursorFromWire(wire, sourceHomeStationPeerID)
	if err != nil {
		return fmt.Errorf("%w: %v", conversationfederation.ErrReadCursorRejected, err)
	}
	boundUnitOfWork, err := p.composition.UnitOfWork.Bind(transaction.DB())
	if err != nil {
		return err
	}
	boundQuery, err := query.NewService(boundUnitOfWork)
	if err != nil {
		return err
	}
	view, err := boundQuery.Get(ctx, request.ConversationID, request.Reader.Actor)
	if err != nil ||
		view.Source != query.SourceAuthority ||
		view.Conversation.FederationID != federationID ||
		view.Conversation.AuthorityStation != authority ||
		authority != p.composition.localStation ||
		view.Conversation.AuthorityEpoch != authorityEpoch {
		return fmt.Errorf(
			"%w: cursor does not target the local Conversation authority",
			conversationfederation.ErrReadCursorRejected,
		)
	}
	active, err := (productionFederationMembershipProjection{}).IsActiveStation(
		ctx,
		transaction,
		string(federationID),
		sourceHomeStationPeerID,
	)
	if err != nil {
		return err
	}
	if !active {
		return fmt.Errorf(
			"%w: cursor source Station is not active in the Conversation federation",
			conversationfederation.ErrReadCursorRejected,
		)
	}
	boundCommand, err := p.composition.bindFederationCommandService(
		transaction,
		boundUnitOfWork,
	)
	if err != nil {
		return err
	}
	verifiedRoutes, err := p.composition.productionCommandRoutes(
		ctx,
		boundCommand,
		request.ConversationID,
		request.Reader.Actor,
	)
	if err != nil {
		return err
	}
	boundService, err := p.composition.InteractionService.BindReadCursorAuthorityPorts(
		boundQuery,
		productionInteractionDeviceDirectory{
			identity: &productionIdentityDirectory{db: transaction.DB()},
		},
		&productionFederatedReadCursorAdvancer{
			service:    boundCommand,
			readerHome: request.SourceStation,
			routes:     verifiedRoutes,
		},
	)
	if err != nil {
		return err
	}
	result, err := boundService.SubmitReadCursor(ctx, request)
	if err == nil && result.Result.PostCommitError != nil {
		return result.Result.PostCommitError
	}
	if err == nil {
		return nil
	}
	switch interactionapp.CodeOf(err) {
	case interactionapp.ErrorCodeIdempotencyConflict:
		return fmt.Errorf("%w: %v", conversationfederation.ErrReadCursorConflict, err)
	case interactionapp.ErrorCodeInvalidArgument,
		interactionapp.ErrorCodeUnauthorized,
		interactionapp.ErrorCodeIntegrityFailed:
		return fmt.Errorf("%w: %v", conversationfederation.ErrReadCursorRejected, err)
	default:
		return err
	}
}

func productionDeliveryReceiptToWire(
	receipt interactionapp.DeliveryReceipt,
) (*chatmodel.DeviceConsumptionReceipt, error) {
	if receipt.Consumer.Validate() != nil || receipt.ConsumedAt.IsZero() {
		return nil, fmt.Errorf(
			"encode Conversation delivery receipt: receipt is incomplete",
		)
	}

	return &chatmodel.DeviceConsumptionReceipt{
		ReceiptId:      receipt.ReceiptID,
		ConversationId: string(receipt.ConversationID),
		EventId:        string(receipt.EventID),
		Consumer: &chatmodel.CryptoEndpoint{
			Ptid:     string(receipt.Consumer.Actor),
			DeviceId: string(receipt.Consumer.Device),
		},
		EventSequence: int64(receipt.EventSequence),
		LaneSequence:  receipt.LaneSequence,
		PayloadSha256: receipt.PayloadHash.Bytes(),
		ConsumedAt:    timestamppb.New(receipt.ConsumedAt.UTC()),
	}, nil
}

func productionReadCursorToWire(
	request interactionapp.ReadCursorRequest,
	federationID valueobject.FederationID,
	authority valueobject.StationID,
	authorityEpoch valueobject.AuthorityEpoch,
	readerHome valueobject.StationID,
) (*chatmodel.FederatedConversationReadCursor, error) {
	if request.ConversationID == "" ||
		request.Reader.Validate() != nil ||
		request.Sequence == 0 ||
		federationID == "" ||
		authority == "" ||
		authorityEpoch == 0 ||
		readerHome == "" {
		return nil, fmt.Errorf(
			"encode Conversation read cursor: cursor is incomplete",
		)
	}
	return &chatmodel.FederatedConversationReadCursor{
		FormatVersion:          1,
		FederationId:           string(federationID),
		ConversationId:         string(request.ConversationID),
		AuthorityStationPeerId: string(authority),
		AuthorityEpoch:         uint64(authorityEpoch),
		Reader: &chatmodel.CryptoEndpoint{
			Ptid:     string(request.Reader.Actor),
			DeviceId: string(request.Reader.Device),
		},
		ReaderHomeStationPeerId: string(readerHome),
		LastReadSequence:        int64(request.Sequence),
	}, nil
}

func productionReadCursorFromWire(
	wire *chatmodel.FederatedConversationReadCursor,
	sourceHomeStationPeerID string,
) (
	interactionapp.ReadCursorRequest,
	valueobject.FederationID,
	valueobject.StationID,
	valueobject.AuthorityEpoch,
	error,
) {
	if wire == nil ||
		wire.GetFormatVersion() != 1 ||
		wire.GetReader() == nil ||
		wire.GetReaderHomeStationPeerId() != sourceHomeStationPeerID ||
		wire.GetAuthorityEpoch() == 0 ||
		wire.GetLastReadSequence() <= 0 {
		return interactionapp.ReadCursorRequest{}, "", "", 0,
			fmt.Errorf("decode Conversation read cursor: cursor is incomplete")
	}
	conversationID, err := valueobject.NewConversationID(wire.GetConversationId())
	if err != nil {
		return interactionapp.ReadCursorRequest{}, "", "", 0, err
	}
	reader, err := valueobject.NewEndpoint(
		wire.GetReader().GetPtid(),
		wire.GetReader().GetDeviceId(),
	)
	if err != nil {
		return interactionapp.ReadCursorRequest{}, "", "", 0, err
	}
	federationID, err := valueobject.NewFederationID(wire.GetFederationId())
	if err != nil {
		return interactionapp.ReadCursorRequest{}, "", "", 0, err
	}
	authority, err := valueobject.NewStationID(wire.GetAuthorityStationPeerId())
	if err != nil {
		return interactionapp.ReadCursorRequest{}, "", "", 0, err
	}
	return interactionapp.ReadCursorRequest{
			ConversationID: conversationID,
			Reader:         reader,
			Sequence:       valueobject.Sequence(wire.GetLastReadSequence()),
			SourceStation:  valueobject.StationID(sourceHomeStationPeerID),
		},
		federationID,
		authority,
		valueobject.AuthorityEpoch(wire.GetAuthorityEpoch()),
		nil
}

func productionDeliveryReceiptFromWire(
	wire *chatmodel.DeviceConsumptionReceipt,
	sourceHomeStationPeerID string,
) (interactionapp.DeliveryReceipt, error) {
	if wire == nil || wire.GetConsumer() == nil ||
		wire.GetConsumedAt() == nil || !wire.GetConsumedAt().IsValid() {
		return interactionapp.DeliveryReceipt{}, fmt.Errorf(
			"decode Conversation delivery receipt: receipt is incomplete",
		)
	}
	conversationID, err := valueobject.NewConversationID(wire.GetConversationId())
	if err != nil {
		return interactionapp.DeliveryReceipt{}, err
	}
	eventID, err := valueobject.NewEventID(wire.GetEventId())
	if err != nil {
		return interactionapp.DeliveryReceipt{}, err
	}
	consumer, err := valueobject.NewEndpoint(
		wire.GetConsumer().GetPtid(),
		wire.GetConsumer().GetDeviceId(),
	)
	if err != nil {
		return interactionapp.DeliveryReceipt{}, err
	}
	sourceStation, err := valueobject.NewStationID(sourceHomeStationPeerID)
	if err != nil {
		return interactionapp.DeliveryReceipt{}, err
	}
	payloadHash, err := valueobject.NewHash(wire.GetPayloadSha256())
	if err != nil {
		return interactionapp.DeliveryReceipt{}, err
	}

	return interactionapp.DeliveryReceipt{
		ReceiptID:      wire.GetReceiptId(),
		ConversationID: conversationID,
		EventID:        eventID,
		Consumer:       consumer,
		SourceStation:  sourceStation,
		EventSequence:  valueobject.Sequence(wire.GetEventSequence()),
		LaneSequence:   wire.GetLaneSequence(),
		PayloadHash:    payloadHash,
		ConsumedAt:     wire.GetConsumedAt().AsTime(),
	}, nil
}

func (s *subServer) forwardConversationProposal(
	ctx context.Context,
	authenticated conversationhttp.AuthenticatedActor,
	proposal *chatmodel.ConversationCommandProposal,
) error {
	command, err := conversationfederation.ParseProposalCommand(proposal)
	if err != nil {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalInvalid,
			"production_federation.forward_proposal",
			"proposal",
			"is required",
		)
	}
	if proposal.GetHomeStationPeerId() != string(s.localStation) ||
		proposal.GetAuthorityStationPeerId() == string(s.localStation) ||
		proposal.GetActorPtid() != authenticated.PTID ||
		proposal.GetActorDeviceId() != authenticated.DeviceID ||
		command.Actor == nil ||
		command.Actor.GetPtid() != authenticated.PTID ||
		command.Actor.GetDeviceId() != authenticated.DeviceID {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalBinding,
			"production_federation.forward_proposal",
			"route",
			"does not match the authenticated Home Station endpoint",
		)
	}
	commandBytes, err := deterministicProductionProto(command.Message)
	if err != nil {
		return err
	}
	if !bytes.Equal(
		proposal.GetCommandSha256(),
		federationdelivery.PayloadSHA256(commandBytes),
	) {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalBinding,
			"production_federation.forward_proposal",
			"command_sha256",
			"does not match the canonical command bytes",
		)
	}
	signingInput := &chatmodel.ConversationCommandProposalSigningInput{
		Version:                proposal.GetVersion(),
		FederationId:           proposal.GetFederationId(),
		AuthorityStationPeerId: proposal.GetAuthorityStationPeerId(),
		AuthorityEpoch:         proposal.GetAuthorityEpoch(),
		HomeStationPeerId:      proposal.GetHomeStationPeerId(),
		ConversationId:         command.ConversationID,
		CommandId:              command.CommandID,
		CommandKind:            command.Kind,
		ActorPtid:              proposal.GetActorPtid(),
		ActorDeviceId:          proposal.GetActorDeviceId(),
		ActorSigningKeyId:      proposal.GetActorSigningKeyId(),
		CommandSha256:          append([]byte(nil), proposal.GetCommandSha256()...),
		CreatedAtUnixMs:        proposal.GetCreatedAtUnixMs(),
		ExpiresAtUnixMs:        proposal.GetExpiresAtUnixMs(),
	}
	signingBytes, err := deterministicProductionProto(signingInput)
	if err != nil {
		return err
	}
	conversationID, err := valueobject.NewConversationID(
		command.ConversationID,
	)
	if err != nil {
		return err
	}
	actor, err := valueobject.NewPTID(authenticated.PTID)
	if err != nil {
		return err
	}

	lockValue, _ := productionProposalLocks.LoadOrStore(
		command.ConversationID,
		&sync.Mutex{},
	)
	lock := lockValue.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()

	return s.composition.database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if tx.Dialector.Name() == "postgres" {
			lockID := productionAdvisoryLockID(
				"conversation-proposal:" +
					command.ConversationID,
			)
			if err := tx.Exec(
				"SELECT pg_advisory_xact_lock(?)",
				lockID,
			).Error; err != nil {
				return fmt.Errorf(
					"lock Conversation proposal lane: %w",
					err,
				)
			}
		}
		exactReplay, err := existingConversationProposalReplay(
			ctx,
			tx,
			string(s.localStation),
			proposal,
			s.composition.clock.Now().UTC(),
		)
		if err != nil {
			return err
		}
		if exactReplay {
			return nil
		}
		if err := validateNewConversationProposal(
			proposal,
			s.composition.clock.Now().UTC(),
		); err != nil {
			return err
		}
		identity := &productionIdentityDirectory{db: tx}
		verification, err := identity.VerifyDeviceSignature(
			ctx,
			valueobject.Endpoint{
				Actor:  actor,
				Device: valueobject.DeviceID(authenticated.DeviceID),
			},
			proposal.GetActorSigningKeyId(),
			signingBytes,
			proposal.GetActorSignature(),
		)
		if err != nil {
			return err
		}
		if verification.KeyRevoked {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeActorKeyRevoked,
				"production_federation.forward_proposal",
				"actor_signing_key",
				"is revoked",
			)
		}
		boundUnitOfWork, err := s.composition.UnitOfWork.Bind(tx)
		if err != nil {
			return err
		}
		boundQuery, err := query.NewService(boundUnitOfWork)
		if err != nil {
			return err
		}
		head, err := boundQuery.PublicHead(ctx, conversationID, actor)
		if err != nil {
			return err
		}
		if err := validateConversationProposalFollowerHead(proposal, head); err != nil {
			return err
		}
		orderingKey := "conversation-authority-command:" +
			command.ConversationID
		var current int64
		if err := tx.Model(&federationdelivery.OutboxRecord{}).
			Where(
				"source_station_peer_id = ? AND target_station_peer_id = ? AND ordering_key = ?",
				string(s.localStation),
				proposal.GetAuthorityStationPeerId(),
				orderingKey,
			).
			Select("COALESCE(MAX(ordering_sequence), 0)").
			Scan(&current).Error; err != nil {
			return fmt.Errorf(
				"load Conversation proposal lane head: %w",
				err,
			)
		}
		outbox, err := federationdelivery.NewGORMRepository(
			tx,
			s.composition.clock,
		)
		if err != nil {
			return err
		}
		_, err = s.composition.federationSender.EnqueueAuthorityCommand(
			ctx,
			outbox,
			proto.Clone(proposal).(*chatmodel.ConversationCommandProposal),
			current+1,
		)

		return err
	})
}

func existingConversationProposalReplay(
	ctx context.Context,
	database *gorm.DB,
	localStationPeerID string,
	proposal *chatmodel.ConversationCommandProposal,
	now time.Time,
) (bool, error) {
	command, err := conversationfederation.ParseProposalCommand(proposal)
	if err != nil {
		return false, err
	}
	var records []federationdelivery.OutboxRecord
	if err := database.WithContext(ctx).
		Where(
			"source_station_peer_id = ? AND payload_kind = ? AND payload_id = ?",
			localStationPeerID,
			int32(federationdelivery.PayloadKindConversationAuthorityCommand),
			command.CommandID,
		).
		Limit(2).
		Find(&records).Error; err != nil {
		return false, fmt.Errorf("load existing Conversation proposal: %w", err)
	}
	if len(records) == 0 {
		return false, nil
	}
	if len(records) != 1 {
		return false, conversationdomain.NewError(
			conversationdomain.ErrorCodeCommandConflict,
			"production_federation.forward_proposal",
			"command_id",
			"identifies multiple outgoing authority commands",
		)
	}
	var frame federationdelivery.Frame
	if err := proto.Unmarshal(records[0].FrameBytes, &frame); err != nil {
		return false, fmt.Errorf("decode existing Conversation proposal frame: %w", err)
	}
	proposalBytes, err := deterministicProductionProto(proposal)
	if err != nil {
		return false, err
	}
	if frame.GetSourceStationPeerId() != localStationPeerID ||
		frame.GetTargetStationPeerId() != proposal.GetAuthorityStationPeerId() ||
		frame.GetPayloadKind() != federationdelivery.PayloadKindConversationAuthorityCommand ||
		frame.GetPayloadId() != command.CommandID ||
		!bytes.Equal(frame.GetOpaquePayload(), proposalBytes) {
		return false, conversationdomain.NewError(
			conversationdomain.ErrorCodeCommandConflict,
			"production_federation.forward_proposal",
			"command_id",
			"already identifies different proposal bytes",
		)
	}
	switch records[0].State {
	case federationdelivery.OutboxStatePending,
		federationdelivery.OutboxStateLeased,
		federationdelivery.OutboxStateRetryWait:
		if !records[0].ExpiresAt.After(now) {
			return false, conversationdomain.NewError(
				conversationdomain.ErrorCodeProposalExpired,
				"production_federation.forward_proposal",
				"command_id",
				"identifies an expired authority command",
			)
		}
		return true, nil
	case federationdelivery.OutboxStateDelivered:
		return true, nil
	case federationdelivery.OutboxStateExpired:
		return false, conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalExpired,
			"production_federation.forward_proposal",
			"command_id",
			"identifies an expired authority command",
		)
	default:
		return false, conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalInvalid,
			"production_federation.forward_proposal",
			"command_id",
			"identifies a terminal authority command",
		)
	}

}

func validateNewConversationProposal(
	proposal *chatmodel.ConversationCommandProposal,
	now time.Time,
) error {
	command, commandErr := conversationfederation.ParseProposalCommand(proposal)
	if proposal == nil ||
		commandErr != nil ||
		proposal.GetVersion() != productionCommandProposalVersion ||
		proposal.GetFederationId() == "" ||
		proposal.GetAuthorityStationPeerId() == "" ||
		proposal.GetHomeStationPeerId() == "" ||
		proposal.GetActorPtid() == "" ||
		proposal.GetActorDeviceId() == "" ||
		proposal.GetActorSigningKeyId() == "" ||
		command.CommandID == "" ||
		command.ConversationID == "" ||
		command.AuthorityStationPeerID != proposal.GetAuthorityStationPeerId() ||
		len(proposal.GetCommandSha256()) != sha256.Size ||
		len(proposal.GetActorSignature()) != ed25519.SignatureSize ||
		command.Kind == chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_UNSPECIFIED {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalInvalid,
			"production_federation.forward_proposal",
			"proposal",
			"is incomplete or unsupported",
		)
	}
	createdAt := time.UnixMilli(proposal.GetCreatedAtUnixMs()).UTC()
	expiresAt := time.UnixMilli(proposal.GetExpiresAtUnixMs()).UTC()
	if proposal.GetCreatedAtUnixMs() <= 0 ||
		proposal.GetExpiresAtUnixMs() <= proposal.GetCreatedAtUnixMs() ||
		expiresAt.Sub(createdAt) > productionMaxCommandProposalLifetime ||
		createdAt.After(now.Add(productionMaxProposalClockSkew)) {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalInvalid,
			"production_federation.forward_proposal",
			"proposal_time",
			"is invalid",
		)
	}
	if !expiresAt.After(now) {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalExpired,
			"production_federation.forward_proposal",
			"proposal_time",
			"has expired",
		)
	}
	if member := command.MemberAuthority; member != nil {
		if member.GetFederationId() != proposal.GetFederationId() ||
			member.GetAuthorityEpoch() != proposal.GetAuthorityEpoch() ||
			member.GetClientTimestamp() == nil ||
			member.GetDeadline() == nil ||
			member.GetClientTimestamp().AsTime().UTC().UnixMilli() !=
				proposal.GetCreatedAtUnixMs() ||
			member.GetDeadline().AsTime().UTC().UnixMilli() !=
				proposal.GetExpiresAtUnixMs() {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeProposalBinding,
				"production_federation.forward_proposal",
				"member_authority",
				"does not match the signed proposal scope",
			)
		}
	}

	return nil
}

func validateConversationProposalFollowerHead(
	proposal *chatmodel.ConversationCommandProposal,
	head query.PublicHead,
) error {
	command, err := conversationfederation.ParseProposalCommand(proposal)
	if proposal == nil ||
		err != nil ||
		head.Source != query.SourceFollower ||
		head.FollowerStatus != repository.FollowerStatusActive ||
		head.Status != valueobject.ConversationStatusActive ||
		string(head.ConversationID) != command.ConversationID ||
		string(head.FederationID) != proposal.GetFederationId() ||
		string(head.AuthorityStation) != proposal.GetAuthorityStationPeerId() ||
		int64(head.AuthorityEpoch) != proposal.GetAuthorityEpoch() {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalBinding,
			"production_federation.forward_proposal",
			"follower_head",
			"does not match the active durable follower projection",
		)
	}

	return nil
}

func productionAdvisoryLockID(key string) int64 {
	hash := sha256.Sum256([]byte(key))

	return int64(binary.BigEndian.Uint64(hash[:8]))
}

func loadOutgoingConversationProposal(
	ctx context.Context,
	database *gorm.DB,
	commandID string,
	authorityStationPeerID string,
) (*chatmodel.ConversationCommandProposal, error) {
	var record federationdelivery.OutboxRecord
	err := database.WithContext(ctx).
		Where(
			"payload_kind = ? AND payload_id = ? AND target_station_peer_id = ?",
			int32(federationdelivery.PayloadKindConversationAuthorityCommand),
			commandID,
			authorityStationPeerID,
		).
		Order("created_at DESC").
		First(&record).Error
	if err != nil {
		return nil, fmt.Errorf(
			"load originating Conversation proposal frame: %w",
			err,
		)
	}
	var frame federationdelivery.Frame
	if err := proto.Unmarshal(record.FrameBytes, &frame); err != nil {
		return nil, fmt.Errorf(
			"decode originating Conversation proposal frame: %w",
			err,
		)
	}
	var proposal chatmodel.ConversationCommandProposal
	if err := proto.Unmarshal(frame.GetOpaquePayload(), &proposal); err != nil {
		return nil, fmt.Errorf(
			"decode originating Conversation proposal: %w",
			err,
		)
	}

	return &proposal, nil
}

func loadCommandAuthorityPlan(
	ctx context.Context,
	unitOfWork ports.UnitOfWork,
	wireCommand *chatmodel.ChatCommand,
) (*entity.AuthorityPlan, error) {
	transition := wireCommand.GetMembershipTransition()
	if transition == nil {
		return nil, nil
	}
	var plan entity.AuthorityPlan
	err := unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		var loadErr error
		plan, loadErr = transaction.Repositories.AuthorityPlans.LoadForUpdate(
			ctx,
			valueobject.PlanID(transition.GetAuthorityPlanId()),
		)

		return loadErr
	})
	if err != nil {
		return nil, err
	}

	return &plan, nil
}

func productionRecordFromWire(
	wire *chatmodel.ConversationEvent,
) (domainevent.Record, error) {
	if wire == nil ||
		wire.GetActor() == nil ||
		wire.GetCommittedAt() == nil ||
		!wire.GetCommittedAt().IsValid() {
		return domainevent.Record{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"production_federation.map_event",
			"event",
			"is incomplete",
		)
	}
	previousHash, err := productionWireHash(wire.GetPreviousHash(), true)
	if err != nil {
		return domainevent.Record{}, err
	}
	eventHash, err := productionWireHash(wire.GetEventHash(), false)
	if err != nil {
		return domainevent.Record{}, err
	}
	actor, err := valueobject.NewEndpoint(
		wire.GetActor().GetPtid(),
		wire.GetActor().GetDeviceId(),
	)
	if err != nil {
		return domainevent.Record{}, err
	}
	fact, err := productionFactFromWire(wire)
	if err != nil {
		return domainevent.Record{}, err
	}
	commitments := make(
		[]valueobject.Hash,
		0,
		len(wire.GetDeliveryCommitments()),
	)
	for _, encoded := range wire.GetDeliveryCommitments() {
		hash, err := productionWireHash(encoded, false)
		if err != nil {
			return domainevent.Record{}, err
		}
		commitments = append(commitments, hash)
	}
	encoded, err := deterministicProductionProto(wire)
	if err != nil {
		return domainevent.Record{}, err
	}

	return domainevent.SealTransportRecord(
		domainevent.RecordInput{
			ID:                  valueobject.EventID(wire.GetEventId()),
			ConversationID:      valueobject.ConversationID(wire.GetConversationId()),
			Sequence:            valueobject.Sequence(wire.GetSequence()),
			CommandID:           valueobject.CommandID(wire.GetCommandId()),
			Actor:               actor,
			PreviousHash:        previousHash,
			CommittedAt:         wire.GetCommittedAt().AsTime().UTC(),
			MembershipEpoch:     valueobject.Epoch(wire.GetMembershipEpoch()),
			MLSEpoch:            valueobject.Epoch(wire.GetMlsEpoch()),
			AuthorityStation:    valueobject.StationID(wire.GetAuthorityStationPeerId()),
			DeliveryCommitments: commitments,
			Fact:                fact,
		},
		eventHash,
		encoded,
	)
}

func productionFactFromWire(
	wire *chatmodel.ConversationEvent,
) (domainevent.Fact, error) {
	command := &chatmodel.ChatCommand{}
	fact := domainevent.Fact{}
	switch payload := wire.GetPayload().(type) {
	case *chatmodel.ConversationEvent_ConversationCreated:
		created := payload.ConversationCreated
		state, err := productionStateFromWire(created.GetPostState(), wire.GetSequence())
		if err != nil {
			return domainevent.Fact{}, err
		}
		members := make([]valueobject.PTID, 0, len(created.GetMembers()))
		for _, member := range created.GetMembers() {
			members = append(members, valueobject.PTID(member.GetPtid()))
		}
		fact = domainevent.Fact{
			Kind: domainevent.KindConversationCreated,
			Created: &domainevent.ConversationCreated{
				Kind:    productionConversationKindFromProto(created.GetKind()),
				Name:    created.GetName(),
				Owner:   valueobject.PTID(created.GetOwnerPtid()),
				Members: members,
			},
			PostState: state,
		}
	case *chatmodel.ConversationEvent_MessageCommitted:
		message := payload.MessageCommitted
		command.Payload = &chatmodel.ChatCommand_SendMessage{
			SendMessage: &chatmodel.SendMessageIntent{
				MessageId:           message.GetMessageId(),
				ContentKind:         message.GetContentKind(),
				ReplyToMessageId:    message.GetReplyToMessageId(),
				ThreadRootMessageId: message.GetThreadRootMessageId(),
				Attachments:         message.GetAttachments(),
			},
		}
		command.ClientTimestamp = message.GetClientTimestamp()
		fact.Kind = domainevent.KindMessageCommitted
		fact.MessageID = valueobject.MessageID(message.GetMessageId())
	case *chatmodel.ConversationEvent_MessageEdited:
		message := payload.MessageEdited
		command.Payload = &chatmodel.ChatCommand_EditMessage{
			EditMessage: &chatmodel.EditMessageIntent{
				MessageId: message.GetMessageId(),
			},
		}
		fact.Kind = domainevent.KindMessageEdited
		fact.MessageID = valueobject.MessageID(message.GetMessageId())
	case *chatmodel.ConversationEvent_MessageRetracted:
		message := payload.MessageRetracted
		command.Payload = &chatmodel.ChatCommand_RetractMessage{
			RetractMessage: &chatmodel.RetractMessageIntent{
				MessageId: message.GetMessageId(),
			},
		}
		fact.Kind = domainevent.KindMessageRetracted
		fact.MessageID = valueobject.MessageID(message.GetMessageId())
	case *chatmodel.ConversationEvent_MessageHiddenForActor:
		message := payload.MessageHiddenForActor
		command.Payload = &chatmodel.ChatCommand_HideMessageForActor{
			HideMessageForActor: &chatmodel.HideMessageForActorIntent{
				MessageId: message.GetMessageId(),
			},
		}
		fact.Kind = domainevent.KindMessageHiddenForActor
		fact.MessageID = valueobject.MessageID(message.GetMessageId())
	case *chatmodel.ConversationEvent_MessageModerated:
		message := payload.MessageModerated
		command.Payload = &chatmodel.ChatCommand_ModerateMessage{
			ModerateMessage: &chatmodel.ModerateMessageIntent{
				MessageId:  message.GetMessageId(),
				ReasonCode: message.GetReasonCode(),
			},
		}
		fact.Kind = domainevent.KindMessageModerated
		fact.MessageID = valueobject.MessageID(message.GetMessageId())
	case *chatmodel.ConversationEvent_MessageForwarded:
		message := payload.MessageForwarded
		command.Payload = &chatmodel.ChatCommand_ForwardMessage{
			ForwardMessage: &chatmodel.ForwardMessageIntent{
				DestinationMessageId:   message.GetDestinationMessageId(),
				ContentKind:            message.GetContentKind(),
				DestinationAttachments: message.GetDestinationAttachments(),
			},
		}
		command.ClientTimestamp = message.GetClientTimestamp()
		fact.Kind = domainevent.KindMessageForwarded
		fact.MessageID = valueobject.MessageID(
			message.GetDestinationMessageId(),
		)
	case *chatmodel.ConversationEvent_ReactionCommitted:
		reaction := payload.ReactionCommitted
		command.Payload = &chatmodel.ChatCommand_Reaction{
			Reaction: &chatmodel.ReactionIntent{
				MessageId: reaction.GetMessageId(),
				Reaction:  reaction.GetReaction(),
				Remove:    reaction.GetRemoved(),
			},
		}
		fact.Kind = domainevent.KindReactionCommitted
		fact.MessageID = valueobject.MessageID(reaction.GetMessageId())
	case *chatmodel.ConversationEvent_MessagePinCommitted:
		pin := payload.MessagePinCommitted
		command.Payload = &chatmodel.ChatCommand_PinMessage{
			PinMessage: &chatmodel.PinMessageIntent{
				MessageId: pin.GetMessageId(),
				Remove:    pin.GetRemoved(),
			},
		}
		fact.Kind = domainevent.KindMessagePinCommitted
		fact.MessageID = valueobject.MessageID(pin.GetMessageId())
	case *chatmodel.ConversationEvent_ConversationUpdated:
		update := payload.ConversationUpdated
		command.Payload = &chatmodel.ChatCommand_UpdateConversation{
			UpdateConversation: &chatmodel.UpdateConversationIntent{
				Name:                  update.Name,
				Description:           update.Description,
				AvatarObjectId:        update.AvatarObjectId,
				DisappearTimerSeconds: update.DisappearTimerSeconds,
				Visibility:            update.Visibility,
			},
		}
		fact.Kind = domainevent.KindConversationSettings
		fact.SettingsPatch = productionSettingsPatchFromWire(update)
	case *chatmodel.ConversationEvent_MembershipTransitionCommitted:
		transition := payload.MembershipTransitionCommitted
		changes := productionMembershipChangesFromWire(transition.GetChanges())
		command.Payload = &chatmodel.ChatCommand_MembershipTransition{
			MembershipTransition: &chatmodel.MembershipTransitionIntent{
				TransitionId:        transition.GetTransitionId(),
				FromMembershipEpoch: transition.GetFromMembershipEpoch(),
				FromMlsEpoch:        transition.GetFromMlsEpoch(),
				ToMlsEpoch:          transition.GetToMlsEpoch(),
				MlsCommitSha256:     append([]byte(nil), transition.GetMlsCommitSha256()...),
				LeaveIntentId:       transition.GetLeaveIntentId(),
			},
		}
		state, err := productionStateFromWire(transition.GetPostState(), wire.GetSequence())
		if err != nil {
			return domainevent.Fact{}, err
		}
		fact.Kind = domainevent.KindMembershipCommitted
		fact.MembershipChanges = changes
		fact.PostState = state
	case *chatmodel.ConversationEvent_MemberAuthorityCommitted:
		committed := payload.MemberAuthorityCommitted
		state, err := productionStateFromWire(committed.GetPostState(), wire.GetSequence())
		if err != nil {
			return domainevent.Fact{}, err
		}
		mutation := &domainevent.MemberAuthorityMutation{
			Action:              productionMemberAuthorityActionFromProto(committed.GetAction()),
			Target:              valueobject.PTID(committed.GetTargetPtid()),
			PreviousOwner:       valueobject.PTID(committed.GetPreviousOwnerPtid()),
			Owner:               valueobject.PTID(committed.GetOwnerPtid()),
			FromMembershipEpoch: valueobject.Epoch(committed.GetFromMembershipEpoch()),
			ToMembershipEpoch:   valueobject.Epoch(committed.GetToMembershipEpoch()),
		}
		if committed.Role != nil {
			role := productionMemberRole(committed.GetRole())
			mutation.Role = &role
		}
		if committed.Muted != nil {
			muted := committed.GetMuted()
			mutation.Muted = &muted
		}
		if committed.GetMutedUntil() != nil {
			mutedUntil := committed.GetMutedUntil().AsTime().UTC()
			mutation.MutedUntil = &mutedUntil
		}
		fact.Kind = domainevent.KindMemberAuthority
		fact.MemberAuthority = mutation
		fact.PostState = state
	case *chatmodel.ConversationEvent_ConversationDissolved:
		command.Payload = &chatmodel.ChatCommand_DissolveConversation{
			DissolveConversation: &chatmodel.DissolveConversationIntent{},
		}
		fact.Kind = domainevent.KindConversationDissolved
	default:
		return domainevent.Fact{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnsupportedTransition,
			"production_federation.map_event",
			"payload",
			"is not supported",
		)
	}
	if fact.Kind != domainevent.KindConversationCreated &&
		fact.Kind != domainevent.KindMemberAuthority {
		encoded, err := deterministicProductionProto(command)
		if err != nil {
			return domainevent.Fact{}, err
		}
		fact.Payload = encoded
	}

	return fact, nil
}

func productionStateFromWire(
	wire *chatmodel.ConversationAuthoritySnapshot,
	sequence int64,
) (*domainevent.ConversationState, error) {
	if wire == nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"production_federation.map_state",
			"post_state",
			"is required",
		)
	}
	members := make([]entity.Member, 0, len(wire.GetActiveMembers()))
	homeByActor := make(map[valueobject.PTID]valueobject.StationID)
	for _, member := range wire.GetActiveMembers() {
		mapped := entity.Member{
			Actor:       valueobject.PTID(member.GetPtid()),
			Role:        valueobject.MemberRole(member.GetRole()),
			Status:      valueobject.MemberStatusActive,
			HomeStation: valueobject.StationID(member.GetHomeStationPeerId()),
			JoinedAt:    1,
			Muted:       member.GetMuted(),
		}
		if member.GetMutedUntil() != nil {
			mutedUntil := member.GetMutedUntil().AsTime().UTC()
			mapped.MutedUntil = &mutedUntil
		}
		if err := mapped.Validate(); err != nil {
			return nil, err
		}
		members = append(members, mapped)
		homeByActor[mapped.Actor] = mapped.HomeStation
	}
	devices := make([]entity.MemberDevice, 0, len(wire.GetActiveEndpointRoutes()))
	for _, route := range wire.GetActiveEndpointRoutes() {
		if route.GetEndpoint() == nil {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeInvalidArgument,
				"production_federation.map_state",
				"active_endpoint_routes",
				"contains an incomplete endpoint",
			)
		}
		device := entity.MemberDevice{
			Endpoint: valueobject.Endpoint{
				Actor:  valueobject.PTID(route.GetEndpoint().GetPtid()),
				Device: valueobject.DeviceID(route.GetEndpoint().GetDeviceId()),
			},
			HomeStation: valueobject.StationID(route.GetHomeStationPeerId()),
			Active:      true,
			JoinedAt:    valueobject.Sequence(maximumInt64(1, sequence)),
		}
		if homeByActor[device.Endpoint.Actor] != device.HomeStation {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeHashChainInvalid,
				"production_federation.map_state",
				"home_station_peer_id",
				"member and endpoint routes disagree",
			)
		}
		if err := device.Validate(); err != nil {
			return nil, err
		}
		devices = append(devices, device)
	}
	endpoints := make([]valueobject.Endpoint, 0, len(wire.GetActiveEndpoints()))
	for _, endpoint := range wire.GetActiveEndpoints() {
		mapped, err := valueobject.NewEndpoint(
			endpoint.GetPtid(),
			endpoint.GetDeviceId(),
		)
		if err != nil {
			return nil, err
		}
		endpoints = append(endpoints, mapped)
	}

	return &domainevent.ConversationState{
		Kind:            productionConversationKindFromProto(wire.GetKind()),
		FederationID:    valueobject.FederationID(wire.GetFederationId()),
		AuthorityEpoch:  valueobject.AuthorityEpoch(wire.GetAuthorityEpoch()),
		Owner:           valueobject.PTID(wire.GetOwnerPtid()),
		Settings:        productionConversationSettingsFromWire(wire),
		ActiveMembers:   members,
		ActiveEndpoints: endpoints,
		ActiveDevices:   devices,
		MembershipEpoch: valueobject.Epoch(wire.GetMembershipEpoch()),
		MLSEpoch:        valueobject.Epoch(wire.GetMlsEpoch()),
	}, nil
}

func productionMembershipChangesFromWire(
	values []*chatmodel.MessagingMembershipChangeCommitted,
) []entity.MembershipChange {
	result := make([]entity.MembershipChange, 0, len(values))
	for _, value := range values {
		if value == nil {
			continue
		}
		result = append(result, entity.MembershipChange{
			Action:      productionMembershipActionFromProto(value.GetAction()),
			Actor:       valueobject.PTID(value.GetPtid()),
			Device:      valueobject.DeviceID(value.GetDeviceId()),
			HomeStation: valueobject.StationID(value.GetHomeStationPeerId()),
			Role:        valueobject.MemberRole(value.GetRole()),
		})
	}

	return result
}

func productionMembershipActionFromProto(
	action chatmodel.MessagingMembershipAction,
) entity.MembershipAction {
	switch action {
	case chatmodel.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_ACTOR:
		return entity.MembershipActionAddActor
	case chatmodel.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_ACTOR:
		return entity.MembershipActionRemoveActor
	case chatmodel.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_LEAVE:
		return entity.MembershipActionLeave
	case chatmodel.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_CHANGE_ROLE:
		return entity.MembershipActionChangeRole
	case chatmodel.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_DEVICE:
		return entity.MembershipActionAddDevice
	case chatmodel.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_DEVICE:
		return entity.MembershipActionRemoveDevice
	default:
		return ""
	}
}

func productionMemberAuthorityActionFromProto(
	action chatmodel.ConversationMemberAuthorityAction,
) domainevent.MemberAuthorityAction {
	switch action {
	case chatmodel.ConversationMemberAuthorityAction_CONVERSATION_MEMBER_AUTHORITY_ACTION_UPDATE_MEMBER:
		return domainevent.MemberAuthorityActionUpdateMember
	case chatmodel.ConversationMemberAuthorityAction_CONVERSATION_MEMBER_AUTHORITY_ACTION_TRANSFER_OWNERSHIP:
		return domainevent.MemberAuthorityActionTransferOwnership
	default:
		return ""
	}
}

func productionSettingsPatchFromWire(
	wire *chatmodel.ConversationUpdatedFact,
) valueobject.SettingsPatch {
	patch := valueobject.SettingsPatch{
		Name:                  wire.Name,
		Description:           wire.Description,
		AvatarObjectID:        wire.AvatarObjectId,
		DisappearTimerSeconds: wire.DisappearTimerSeconds,
	}
	if wire.Visibility != nil {
		visibility := productionConversationVisibilityFromProto(*wire.Visibility)
		patch.Visibility = &visibility
	}

	return patch
}

func productionConversationSettingsFromWire(
	wire *chatmodel.ConversationAuthoritySnapshot,
) valueobject.ConversationSettings {
	return valueobject.ConversationSettings{
		Name:                  wire.GetName(),
		Description:           wire.GetDescription(),
		AvatarObjectID:        wire.GetAvatarObjectId(),
		Visibility:            productionConversationVisibilityFromProto(wire.GetVisibility()),
		DisappearTimerSeconds: wire.GetDisappearTimerSeconds(),
	}
}

func productionConversationKindFromProto(
	kind chatmodel.ConversationKind,
) valueobject.ConversationKind {
	switch kind {
	case chatmodel.ConversationKind_CONVERSATION_KIND_DIRECT:
		return valueobject.ConversationKindDirect
	case chatmodel.ConversationKind_CONVERSATION_KIND_GROUP:
		return valueobject.ConversationKindGroup
	default:
		return ""
	}
}

func productionConversationVisibilityFromProto(
	visibility chatmodel.GroupVisibilityV1,
) valueobject.ConversationVisibility {
	switch visibility {
	case chatmodel.GroupVisibilityV1_GROUP_VISIBILITY_V1_PUBLIC:
		return valueobject.ConversationVisibilityPublic
	case chatmodel.GroupVisibilityV1_GROUP_VISIBILITY_V1_PRIVATE:
		return valueobject.ConversationVisibilityPrivate
	default:
		return ""
	}
}

func productionWireHash(value []byte, optional bool) (valueobject.Hash, error) {
	if optional && len(value) == 0 {
		return valueobject.Hash{}, nil
	}

	return valueobject.NewHash(value)
}

func productionWireCommandKind(
	command *chatmodel.ChatCommand,
) chatmodel.ConversationCommandKind {
	switch command.GetPayload().(type) {
	case *chatmodel.ChatCommand_SendMessage:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_SEND_MESSAGE
	case *chatmodel.ChatCommand_EditMessage:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_EDIT_MESSAGE
	case *chatmodel.ChatCommand_RetractMessage:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_RETRACT_MESSAGE
	case *chatmodel.ChatCommand_HideMessageForActor:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_HIDE_MESSAGE_FOR_ACTOR
	case *chatmodel.ChatCommand_ModerateMessage:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_MODERATE_MESSAGE
	case *chatmodel.ChatCommand_ForwardMessage:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_FORWARD_MESSAGE
	case *chatmodel.ChatCommand_DissolveConversation:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_DISSOLVE
	case *chatmodel.ChatCommand_UpdateConversation:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_UPDATE_SETTINGS
	case *chatmodel.ChatCommand_Reaction:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_REACT
	case *chatmodel.ChatCommand_PinMessage:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_PIN_MESSAGE
	case *chatmodel.ChatCommand_MembershipTransition:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_MEMBERSHIP_TRANSITION
	default:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_UNSPECIFIED
	}
}

func maximumInt64(left int64, right int64) int64 {
	if left > right {
		return left
	}

	return right
}

var (
	_ conversationfederation.FederationMembershipProjection = productionFederationMembershipProjection{}
	_ conversationfederation.AuthorityCommandPort           = (*productionAuthorityCommandPort)(nil)
	_ conversationfederation.AuthorityResultPort            = (*productionAuthorityResultPort)(nil)
	_ conversationfederation.DeviceDeliveryPort             = (*productionDeviceDeliveryPort)(nil)
	_                                                       = clause.Locking{}
	_                                                       = aggregate.CommandPreparation{}
	_                                                       = repository.FollowerStatusActive
)
