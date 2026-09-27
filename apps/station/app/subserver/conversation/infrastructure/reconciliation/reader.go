package reconciliation

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"time"

	reconciliationapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/reconciliation"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	deliveryinfra "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/delivery"
	conversationfederation "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/federation"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/persistence"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

type Clock interface {
	Now() time.Time
}

type Reader struct {
	db             *gorm.DB
	sealer         domainevent.Sealer
	localStationID string
	clock          Clock
}

func NewReader(
	db *gorm.DB,
	sealer domainevent.Sealer,
	localStationID string,
	clock Clock,
) (*Reader, error) {
	if db == nil ||
		sealer == nil ||
		localStationID == "" ||
		localStationID != strings.TrimSpace(localStationID) ||
		clock == nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"reconciliation_reader.new",
			"dependencies",
			"database, event sealer, local Station, and clock are required",
		)
	}
	return &Reader{
		db:             db,
		sealer:         sealer,
		localStationID: localStationID,
		clock:          clock,
	}, nil
}

func (r *Reader) Resolve(
	ctx context.Context,
	caller valueobject.Endpoint,
	reference reconciliationapp.Reference,
) (reconciliationapp.Resolution, error) {
	receipt, hasReceipt, err := r.authorityReceipt(ctx, caller, reference)
	if err != nil {
		return reconciliationapp.Resolution{}, err
	}
	outbox, hasOutbox, err := r.authorityCommandOutbox(ctx, caller, reference)
	if err != nil {
		return reconciliationapp.Resolution{}, err
	}
	inbox, hasInbox, err := r.commandResultInbox(ctx, caller, reference)
	if err != nil {
		return reconciliationapp.Resolution{}, err
	}
	if hasInbox && !hasOutbox {
		return reconciliationapp.Resolution{}, conflict(
			"reconciliation_reader.resolve",
			"device_inbox",
			"command result has no exact originating authority-command outbox binding",
		)
	}
	if hasReceipt && hasInbox && receipt.State != inbox.State {
		return reconciliationapp.Resolution{}, conflict(
			"reconciliation_reader.resolve",
			"canonical_sources",
			"authority receipt and Device Inbox result disagree",
		)
	}
	if hasInbox && hasOutbox &&
		outbox.State == reconciliationapp.StateTerminalRejected {
		return reconciliationapp.Resolution{}, conflict(
			"reconciliation_reader.resolve",
			"canonical_sources",
			"Device Inbox result conflicts with terminal authority-command outbox state",
		)
	}
	switch {
	case hasReceipt:
		return receipt, nil
	case hasInbox:
		return inbox, nil
	case hasOutbox:
		return outbox, nil
	default:
		return baseResolution(reference, reconciliationapp.StateNotFound), nil
	}
}

func (r *Reader) authorityReceipt(
	ctx context.Context,
	caller valueobject.Endpoint,
	reference reconciliationapp.Reference,
) (reconciliationapp.Resolution, bool, error) {
	var model persistence.ConversationCommandReceiptModel
	err := r.db.WithContext(ctx).First(
		&model,
		"conversation_id = ? AND command_id = ?",
		string(reference.ConversationID),
		string(reference.CommandID),
	).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return reconciliationapp.Resolution{}, false, nil
	}
	if err != nil {
		return reconciliationapp.Resolution{}, false, fmt.Errorf(
			"conversation reconciliation: load command receipt: %w",
			err,
		)
	}
	if !bytes.Equal(model.CommandHash, reference.CommandHash[:]) {
		return reconciliationapp.Resolution{}, false, conflict(
			"reconciliation_reader.authority_receipt",
			"command_sha256",
			"does not match the canonical authority receipt",
		)
	}
	switch repository.CommandReceiptOutcome(model.Outcome) {
	case repository.CommandReceiptOutcomeAccepted:
		event, err := persistence.ReadCanonicalEvent(
			ctx,
			r.db,
			r.sealer,
			valueobject.EventID(model.EventID),
		)
		if err != nil {
			return reconciliationapp.Resolution{}, false, err
		}
		if event.ConversationID != reference.ConversationID ||
			event.CommandID != reference.CommandID ||
			event.Actor != caller ||
			!bytes.Equal(event.Bytes(), model.EventBytes) ||
			model.RejectionCode != "" {
			return reconciliationapp.Resolution{}, false, integrity(
				"reconciliation_reader.authority_receipt",
				"receipt",
				"accepted receipt is not bound to the exact command endpoint and event",
			)
		}
		result := baseResolution(reference, reconciliationapp.StateAccepted)
		result.AuthorityEvent = &event
		return result, true, nil
	case repository.CommandReceiptOutcomeRejected:
		if model.EventID != "" || len(model.EventBytes) != 0 || model.RejectionCode == "" {
			return reconciliationapp.Resolution{}, false, integrity(
				"reconciliation_reader.authority_receipt",
				"receipt",
				"terminal receipt is malformed",
			)
		}
		result := baseResolution(reference, reconciliationapp.StateTerminalRejected)
		result.TerminalErrorCode = conversationdomain.ErrorCode(model.RejectionCode)
		return result, true, nil
	default:
		return reconciliationapp.Resolution{}, false, integrity(
			"reconciliation_reader.authority_receipt",
			"outcome",
			"is not canonical",
		)
	}
}

func (r *Reader) authorityCommandOutbox(
	ctx context.Context,
	caller valueobject.Endpoint,
	reference reconciliationapp.Reference,
) (reconciliationapp.Resolution, bool, error) {
	var rows []federationdelivery.OutboxRecord
	if err := r.db.WithContext(ctx).
		Where(
			"payload_kind = ? AND payload_id = ?",
			int32(federationdelivery.PayloadKindConversationAuthorityCommand),
			string(reference.CommandID),
		).
		Limit(2).
		Find(&rows).Error; err != nil {
		return reconciliationapp.Resolution{}, false, fmt.Errorf(
			"conversation reconciliation: load authority-command outbox: %w",
			err,
		)
	}
	if len(rows) == 0 {
		return reconciliationapp.Resolution{}, false, nil
	}
	if len(rows) != 1 {
		return reconciliationapp.Resolution{}, false, conflict(
			"reconciliation_reader.authority_command_outbox",
			"command_id",
			"identifies multiple canonical authority-command rows",
		)
	}
	row := rows[0]
	var frame federationdelivery.Frame
	if err := proto.Unmarshal(row.FrameBytes, &frame); err != nil {
		return reconciliationapp.Resolution{}, false, integrity(
			"reconciliation_reader.authority_command_outbox",
			"frame",
			"cannot be decoded",
		)
	}
	canonicalFrame, err := proto.MarshalOptions{Deterministic: true}.Marshal(&frame)
	if err != nil {
		return reconciliationapp.Resolution{}, false, err
	}
	canonicalHash, err := federationdelivery.CanonicalFrameSHA256(&frame)
	if err != nil {
		return reconciliationapp.Resolution{}, false, err
	}
	if !bytes.Equal(canonicalFrame, row.FrameBytes) ||
		frame.GetFrameId() != row.FrameID ||
		frame.GetSourceStationPeerId() != row.SourceStationPeerID ||
		frame.GetTargetStationPeerId() != row.TargetStationPeerID ||
		frame.GetIdempotencyKey() != row.IdempotencyKey ||
		int32(frame.GetPayloadKind()) != row.PayloadKind ||
		frame.GetPayloadId() != row.PayloadID ||
		frame.GetOrderingKey() != row.OrderingKey ||
		frame.GetOrderingSequence() != row.OrderingSequence ||
		frame.GetSourceStationPeerId() != r.localStationID ||
		!bytes.Equal(
			frame.GetPayloadSha256(),
			federationdelivery.PayloadSHA256(frame.GetOpaquePayload()),
		) ||
		!bytes.Equal(row.PayloadSHA256, frame.GetPayloadSha256()) ||
		!bytes.Equal(row.CanonicalSHA256, canonicalHash) {
		return reconciliationapp.Resolution{}, false, integrity(
			"reconciliation_reader.authority_command_outbox",
			"frame",
			"does not match the canonical outbox row",
		)
	}
	var proposal chatmodel.ConversationCommandProposal
	if err := proto.Unmarshal(frame.GetOpaquePayload(), &proposal); err != nil {
		return reconciliationapp.Resolution{}, false, integrity(
			"reconciliation_reader.authority_command_outbox",
			"proposal",
			"cannot be decoded",
		)
	}
	canonicalProposal, err := proto.MarshalOptions{Deterministic: true}.Marshal(&proposal)
	if err != nil {
		return reconciliationapp.Resolution{}, false, err
	}
	proposalCommand, err := conversationfederation.ParseProposalCommand(&proposal)
	if err != nil {
		return reconciliationapp.Resolution{}, false, integrity(
			"reconciliation_reader.authority_command_outbox",
			"proposal",
			"does not carry one canonical command",
		)
	}
	commandBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		proposalCommand.Message,
	)
	if err != nil {
		return reconciliationapp.Resolution{}, false, err
	}
	if !bytes.Equal(canonicalProposal, frame.GetOpaquePayload()) ||
		proposal.GetHomeStationPeerId() != r.localStationID ||
		proposal.GetAuthorityStationPeerId() != frame.GetTargetStationPeerId() ||
		proposalCommand.AuthorityStationPeerID != frame.GetTargetStationPeerId() ||
		proposalCommand.ConversationID != string(reference.ConversationID) ||
		proposalCommand.CommandID != string(reference.CommandID) ||
		proposal.GetActorPtid() != string(caller.Actor) ||
		proposal.GetActorDeviceId() != string(caller.Device) ||
		proposalCommand.Actor.GetPtid() != string(caller.Actor) ||
		proposalCommand.Actor.GetDeviceId() != string(caller.Device) ||
		!bytes.Equal(proposal.GetCommandSha256(), reference.CommandHash[:]) ||
		!bytes.Equal(
			proposal.GetCommandSha256(),
			federationdelivery.PayloadSHA256(commandBytes),
		) {
		return reconciliationapp.Resolution{}, false, conflict(
			"reconciliation_reader.authority_command_outbox",
			"command",
			"does not match the requested exact command and authenticated endpoint",
		)
	}
	if row.State == federationdelivery.OutboxStateExpired ||
		(row.State != federationdelivery.OutboxStateDelivered &&
			!row.ExpiresAt.After(r.clock.Now().UTC())) {
		result := baseResolution(reference, reconciliationapp.StateTerminalRejected)
		result.TerminalErrorCode = conversationdomain.ErrorCodeProposalExpired
		return result, true, nil
	}
	switch row.State {
	case federationdelivery.OutboxStatePending,
		federationdelivery.OutboxStateLeased,
		federationdelivery.OutboxStateRetryWait,
		federationdelivery.OutboxStateDelivered:
		return baseResolution(reference, reconciliationapp.StateHomePending), true, nil
	case federationdelivery.OutboxStateTerminal:
		result := baseResolution(reference, reconciliationapp.StateTerminalRejected)
		result.TerminalErrorCode = conversationdomain.ErrorCodeProposalInvalid
		return result, true, nil
	default:
		return reconciliationapp.Resolution{}, false, integrity(
			"reconciliation_reader.authority_command_outbox",
			"state",
			"is not canonical",
		)
	}
}

func (r *Reader) commandResultInbox(
	ctx context.Context,
	caller valueobject.Endpoint,
	reference reconciliationapp.Reference,
) (reconciliationapp.Resolution, bool, error) {
	itemID, err := deliveryinfra.CommandResultItemID(
		caller,
		reference.ConversationID,
		reference.CommandID,
	)
	if err != nil {
		return reconciliationapp.Resolution{}, false, err
	}
	var row deliveryinfra.DeviceQueueItemModel
	err = r.db.WithContext(ctx).
		Where(
			"item_id = ? AND recipient_ptid = ? AND recipient_device_id = ? AND payload_type = ?",
			itemID,
			string(caller.Actor),
			string(caller.Device),
			int32(chatmodel.DeviceInboxPayloadType_DEVICE_INBOX_PAYLOAD_TYPE_COMMAND_RESULT),
		).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return reconciliationapp.Resolution{}, false, nil
	}
	if err != nil {
		return reconciliationapp.Resolution{}, false, fmt.Errorf(
			"conversation reconciliation: load command-result Device Inbox row: %w",
			err,
		)
	}
	if len(row.OpaquePayload) == 0 ||
		len(row.PayloadSHA256) != sha256.Size ||
		!bytes.Equal(
			row.PayloadSHA256,
			federationdelivery.PayloadSHA256(row.OpaquePayload),
		) {
		return reconciliationapp.Resolution{}, false, integrity(
			"reconciliation_reader.command_result_inbox",
			"payload_sha256",
			"does not bind the stored command-result payload",
		)
	}
	var delivery chatmodel.ConversationCommandResultDelivery
	if err := proto.Unmarshal(row.OpaquePayload, &delivery); err != nil {
		return reconciliationapp.Resolution{}, false, integrity(
			"reconciliation_reader.command_result_inbox",
			"payload",
			"cannot be decoded",
		)
	}
	if delivery.GetCommandId() != string(reference.CommandID) ||
		delivery.GetConversationId() != string(reference.ConversationID) ||
		row.ConversationID != delivery.GetConversationId() {
		return reconciliationapp.Resolution{}, false, conflict(
			"reconciliation_reader.command_result_inbox",
			"identity",
			"does not match the requested exact command",
		)
	}
	resolved, err := inboxResolution(reference, caller, &delivery)
	if err != nil {
		return reconciliationapp.Resolution{}, false, err
	}
	return resolved, true, nil
}

func inboxResolution(
	reference reconciliationapp.Reference,
	caller valueobject.Endpoint,
	delivery *chatmodel.ConversationCommandResultDelivery,
) (reconciliationapp.Resolution, error) {
	result := delivery.GetResult()
	if result == nil || result.GetCommandId() != string(reference.CommandID) {
		return reconciliationapp.Resolution{}, integrity(
			"reconciliation_reader.command_result_inbox",
			"result",
			"is not bound to the command",
		)
	}
	switch delivery.GetState() {
	case chatmodel.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_ACCEPTED:
		event := result.GetEvent()
		if !result.GetAccepted() ||
			result.GetRetryable() ||
			event == nil ||
			event.GetConversationId() != string(reference.ConversationID) ||
			event.GetCommandId() != string(reference.CommandID) ||
			event.GetActor().GetPtid() != string(caller.Actor) ||
			event.GetActor().GetDeviceId() != string(caller.Device) ||
			event.GetSequence() <= 0 ||
			result.GetAuthoritySequence() != event.GetSequence() ||
			!bytes.Equal(result.GetAuthorityEventHash(), event.GetEventHash()) {
			return reconciliationapp.Resolution{}, integrity(
				"reconciliation_reader.command_result_inbox",
				"result",
				"accepted result is incomplete or endpoint-mismatched",
			)
		}
		resolved := baseResolution(reference, reconciliationapp.StateAccepted)
		canonical, err := canonicalProposalResult(result)
		if err != nil {
			return reconciliationapp.Resolution{}, err
		}
		resolved.CanonicalResult = canonical
		return resolved, nil
	case chatmodel.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_TERMINAL_REJECTED:
		if result.GetAccepted() ||
			result.GetRetryable() ||
			result.GetEvent() != nil ||
			result.GetRejectCode() ==
				chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_UNSPECIFIED {
			return reconciliationapp.Resolution{}, integrity(
				"reconciliation_reader.command_result_inbox",
				"result",
				"terminal result is incomplete",
			)
		}
		resolved := baseResolution(reference, reconciliationapp.StateTerminalRejected)
		canonical, err := canonicalProposalResult(result)
		if err != nil {
			return reconciliationapp.Resolution{}, err
		}
		resolved.CanonicalResult = canonical
		return resolved, nil
	default:
		return reconciliationapp.Resolution{}, integrity(
			"reconciliation_reader.command_result_inbox",
			"state",
			"is not terminal",
		)
	}
}

func canonicalProposalResult(
	result *chatmodel.ConversationCommandProposalResult,
) ([]byte, error) {
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(result)
	if err != nil {
		return nil, fmt.Errorf(
			"conversation reconciliation: encode canonical proposal result: %w",
			err,
		)
	}
	return encoded, nil
}

func baseResolution(
	reference reconciliationapp.Reference,
	state reconciliationapp.State,
) reconciliationapp.Resolution {
	return reconciliationapp.Resolution{
		Reference: reference,
		State:     state,
	}
}

func conflict(operation string, field string, message string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeCommandConflict,
		operation,
		field,
		message,
	)
}

func integrity(operation string, field string, message string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeHashChainInvalid,
		operation,
		field,
		message,
	)
}

var _ reconciliationapp.Reader = (*Reader)(nil)
