package conversation

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/command"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	deliveryinfra "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/delivery"
	conversationfederation "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/federation"
	conversationhttp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/interface/http"
	federationinfra "github.com/peers-labs/peers-touch/station/app/subserver/federation/infrastructure"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const productionCommandProposalScope = "conversation-command-proposal"

var productionProposalLocks sync.Map

// RegisterFederationReceivers binds the three Conversation payload receivers
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
	receiver, err := conversationfederation.NewReceiver(
		conversationfederation.ReceiverConfig{
			LocalStationPeerID: shared.Federation.LocalStationPeerID(),
			ActorKeys:          shared.Actor,
			Federation:         productionFederationMembershipProjection{},
			AuthorityCommands:  &productionAuthorityCommandPort{composition: c},
			AuthorityResults:   &productionAuthorityResultPort{composition: c},
			DeviceDeliveries:   &productionDeviceDeliveryPort{composition: c},
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
		verified.Proposal == nil || verified.Proposal.GetCommand() == nil {
		return conversationfederation.AuthorityCommandOutcome{},
			fmt.Errorf("apply Conversation authority command: dependencies are incomplete")
	}
	boundUnitOfWork, err := p.composition.UnitOfWork.Bind(transaction.DB())
	if err != nil {
		return conversationfederation.AuthorityCommandOutcome{}, err
	}
	boundService, err := p.composition.CommandService.BindUnitOfWork(boundUnitOfWork)
	if err != nil {
		return conversationfederation.AuthorityCommandOutcome{}, err
	}
	proposal := verified.Proposal
	wireCommand := proposal.GetCommand()
	authenticated := conversationhttp.AuthenticatedActor{
		PTID:     proposal.GetActorPtid(),
		DeviceID: proposal.GetActorDeviceId(),
	}
	conversationID, err := valueobject.NewConversationID(
		wireCommand.GetConversationId(),
	)
	if err != nil {
		return productionAuthorityRejection(wireCommand, err), nil
	}
	sender, err := valueobject.NewEndpoint(
		proposal.GetActorPtid(),
		proposal.GetActorDeviceId(),
	)
	if err != nil {
		return productionAuthorityRejection(wireCommand, err), nil
	}
	sourceHomeStation, err := valueobject.NewStationID(verified.SourceHomeStation)
	if err != nil || string(sourceHomeStation) != proposal.GetHomeStationPeerId() {
		return productionAuthorityRejection(
			wireCommand,
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
		return productionAuthorityRejection(wireCommand, err), nil
	}
	preparation, err := boundService.PrepareCommand(
		ctx,
		command.PrepareCommandRequest{
			ConversationID:    conversationID,
			Sender:            sender,
			SenderHomeStation: sourceHomeStation,
			VerifiedRoutes:    verifiedRoutes,
		},
	)
	if err != nil {
		return productionAuthorityRejection(wireCommand, err), nil
	}
	plan, err := loadCommandAuthorityPlan(
		ctx,
		boundUnitOfWork,
		wireCommand,
	)
	if err != nil {
		return productionAuthorityRejection(wireCommand, err), nil
	}
	mapped, err := conversationhttp.MapSubmitCommand(
		authenticated,
		&chatmodel.SubmitConversationAuthorityCommandRequest{
			Submission: &chatmodel.SubmitConversationAuthorityCommandRequest_Command{
				Command: wireCommand,
			},
		},
		preparation,
		plan,
		p.composition.clock.Now(),
	)
	if err != nil {
		return productionAuthorityRejection(wireCommand, err), nil
	}
	if mapped.Membership == nil {
		mapped.VerifiedRoutes = verifiedRoutes
	}
	commandHash, err := valueobject.NewHash(proposal.GetCommandSha256())
	if err != nil {
		return productionAuthorityRejection(wireCommand, err), nil
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
				CommandID:      valueobject.CommandID(wireCommand.GetCommandId()),
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
		return productionAuthorityRejection(wireCommand, err), nil
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
			CommandId:          wireCommand.GetCommandId(),
			Accepted:           true,
			Event:              event,
			AuthoritySequence:  event.GetSequence(),
			AuthorityEventHash: append([]byte(nil), event.GetEventHash()...),
		},
		Replay: result.Replay,
	}, nil
}

func productionAuthorityRejection(
	command *chatmodel.ChatCommand,
	err error,
) conversationfederation.AuthorityCommandOutcome {
	commandID := ""
	if command != nil {
		commandID = command.GetCommandId()
	}

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
	if proposal.GetCommand().GetConversationId() != result.GetConversationId() ||
		!bytes.Equal(proposal.GetCommandSha256(), originatingCommandSHA256) {
		return false, conversationfederation.ErrAuthorityResultCommandHashMismatch
	}
	payload, err := deterministicProductionProto(result)
	if err != nil {
		return false, err
	}
	payloadHash := valueobject.HashBytes(payload)
	itemID := "conversation-command-result:" + payloadHash.String()
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
		Recipient: valueobject.Endpoint{
			Actor:  valueobject.PTID(proposal.GetActorPtid()),
			Device: valueobject.DeviceID(proposal.GetActorDeviceId()),
		},
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

func (s *subServer) forwardConversationProposal(
	ctx context.Context,
	authenticated conversationhttp.AuthenticatedActor,
	proposal *chatmodel.ConversationCommandProposal,
) error {
	if proposal == nil || proposal.GetCommand() == nil {
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
		proposal.GetCommand().GetSender() == nil ||
		proposal.GetCommand().GetSender().GetPtid() != authenticated.PTID ||
		proposal.GetCommand().GetSender().GetDeviceId() != authenticated.DeviceID {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalBinding,
			"production_federation.forward_proposal",
			"route",
			"does not match the authenticated Home Station endpoint",
		)
	}
	commandBytes, err := deterministicProductionProto(proposal.GetCommand())
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
		ConversationId:         proposal.GetCommand().GetConversationId(),
		CommandId:              proposal.GetCommand().GetCommandId(),
		CommandKind:            productionWireCommandKind(proposal.GetCommand()),
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
	identity := &productionIdentityDirectory{db: s.composition.database}
	verification, err := identity.VerifyDeviceSignature(
		ctx,
		valueobject.Endpoint{
			Actor:  valueobject.PTID(authenticated.PTID),
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

	lockValue, _ := productionProposalLocks.LoadOrStore(
		proposal.GetCommand().GetConversationId(),
		&sync.Mutex{},
	)
	lock := lockValue.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()

	return s.composition.database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if tx.Dialector.Name() == "postgres" {
			lockID := productionAdvisoryLockID(
				"conversation-proposal:" +
					proposal.GetCommand().GetConversationId(),
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
		orderingKey := "conversation-authority-command:" +
			proposal.GetCommand().GetConversationId()
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
	if fact.Kind != domainevent.KindConversationCreated {
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
