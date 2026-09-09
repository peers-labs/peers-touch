package http

import (
	"context"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/delivery"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	touchmodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// DeviceInboxApplication is the transport-independent Device Inbox application boundary.
type DeviceInboxApplication interface {
	Claim(
		ctx context.Context,
		recipient valueobject.Endpoint,
		consumerID string,
		expectedConsumerEpoch uint64,
		afterLaneSequence int64,
		batchLimit uint32,
	) (delivery.ClaimResult, error)
	Acknowledge(ctx context.Context, request delivery.AcknowledgeRequest) (int64, error)
	Reject(ctx context.Context, request delivery.RejectRequest) (delivery.RejectResult, error)
}

// DeviceInboxHandler maps authenticated canonical protobuf requests to the delivery application.
type DeviceInboxHandler struct {
	service DeviceInboxApplication
}

// NewDeviceInboxHandler constructs the test-only canonical Device Inbox HTTP adapter.
func NewDeviceInboxHandler(service DeviceInboxApplication) (*DeviceInboxHandler, error) {
	if service == nil {
		return nil, delivery.NewError(
			delivery.ErrorCodeInvalidArgument,
			"device_inbox_handler.new",
			"service",
			"is required",
		)
	}

	return &DeviceInboxHandler{service: service}, nil
}

// Claim binds the request device to the authenticated endpoint and claims its exact lane head.
func (h *DeviceInboxHandler) Claim(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chat.ClaimDeviceInboxRequest,
) (*chat.ClaimDeviceInboxResponse, error) {
	if request == nil {
		return nil, delivery.NewError(
			delivery.ErrorCodeInvalidArgument,
			"device_inbox_handler.claim",
			"request",
			"is required",
		)
	}
	recipient, err := bindAuthenticatedDevice(
		authenticated,
		request.GetDevice(),
		"device_inbox_handler.claim",
	)
	if err != nil {
		return nil, err
	}
	result, err := h.service.Claim(
		ctx,
		recipient,
		request.GetConsumerId(),
		request.GetExpectedConsumerEpoch(),
		request.GetAfterLaneSequence(),
		request.GetBatchLimit(),
	)
	if err != nil {
		return nil, err
	}
	items := make([]*chat.DurableDeviceInboxItem, 0, len(result.Items))
	for index := range result.Items {
		item, err := deviceInboxItemToProto(result.Items[index])
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	return &chat.ClaimDeviceInboxResponse{
		ConsumerEpoch:        result.ConsumerEpoch,
		Items:                items,
		LaneHeadSequence:     result.LaneHead,
		AckedThroughSequence: result.AckedThrough,
	}, nil
}

// Acknowledge binds the request device and advances one durably consumed lane item.
func (h *DeviceInboxHandler) Acknowledge(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chat.AcknowledgeDeviceInboxItemRequest,
) (*chat.AcknowledgeDeviceInboxItemResponse, error) {
	if request == nil {
		return nil, delivery.NewError(
			delivery.ErrorCodeInvalidArgument,
			"device_inbox_handler.acknowledge",
			"request",
			"is required",
		)
	}
	recipient, err := bindAuthenticatedDevice(
		authenticated,
		request.GetDevice(),
		"device_inbox_handler.acknowledge",
	)
	if err != nil {
		return nil, err
	}
	payloadHash, err := valueobject.NewHash(request.GetPayloadSha256())
	if err != nil {
		return nil, delivery.NewError(
			delivery.ErrorCodeInvalidArgument,
			"device_inbox_handler.acknowledge",
			"payload_sha256",
			"must be a complete SHA-256 digest",
		)
	}
	ackedThrough, err := h.service.Acknowledge(ctx, delivery.AcknowledgeRequest{
		Recipient:     recipient,
		ItemID:        request.GetItemId(),
		LaneSequence:  request.GetLaneSequence(),
		ConsumerEpoch: request.GetConsumerEpoch(),
		PayloadHash:   payloadHash,
	})
	if err != nil {
		return nil, err
	}

	return &chat.AcknowledgeDeviceInboxItemResponse{
		AckedThroughSequence: ackedThrough,
	}, nil
}

// Reject binds the request device and applies the canonical retry classification.
func (h *DeviceInboxHandler) Reject(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chat.RejectDeviceInboxItemRequest,
) (*chat.RejectDeviceInboxItemResponse, error) {
	if request == nil {
		return nil, delivery.NewError(
			delivery.ErrorCodeInvalidArgument,
			"device_inbox_handler.reject",
			"request",
			"is required",
		)
	}
	recipient, err := bindAuthenticatedDevice(
		authenticated,
		request.GetDevice(),
		"device_inbox_handler.reject",
	)
	if err != nil {
		return nil, err
	}
	rejectCode, err := rejectCodeFromProto(request.GetErrorCode())
	if err != nil {
		return nil, err
	}
	result, err := h.service.Reject(ctx, delivery.RejectRequest{
		Recipient:     recipient,
		ItemID:        request.GetItemId(),
		LaneSequence:  request.GetLaneSequence(),
		ConsumerEpoch: request.GetConsumerEpoch(),
		Code:          rejectCode,
	})
	if err != nil {
		return nil, err
	}
	state, err := itemStateToProto(result.State)
	if err != nil {
		return nil, err
	}
	response := &chat.RejectDeviceInboxItemResponse{State: state}
	if result.NextAttemptAt != nil {
		response.NextAttemptAt = timestamppb.New(result.NextAttemptAt.UTC())
	}

	return response, nil
}

func bindAuthenticatedDevice(
	authenticated AuthenticatedActor,
	request *touchmodel.ActorDeviceRef,
	operation string,
) (valueobject.Endpoint, error) {
	if request == nil ||
		request.GetActor() == nil ||
		authenticated.PTID == "" ||
		authenticated.DeviceID == "" ||
		strings.TrimSpace(authenticated.PTID) != authenticated.PTID ||
		strings.TrimSpace(authenticated.DeviceID) != authenticated.DeviceID ||
		request.GetActor().GetPtid() != authenticated.PTID ||
		request.GetDeviceId() != authenticated.DeviceID {
		return valueobject.Endpoint{}, delivery.NewError(
			delivery.ErrorCodeUnauthorized,
			operation,
			"device",
			"does not match the authenticated endpoint",
		)
	}

	return valueobject.NewEndpoint(authenticated.PTID, authenticated.DeviceID)
}

func deviceInboxItemToProto(
	item delivery.Item,
) (*chat.DurableDeviceInboxItem, error) {
	payloadType, err := payloadTypeToProto(item.PayloadType)
	if err != nil {
		return nil, err
	}
	state, err := itemStateToProto(item.State)
	if err != nil {
		return nil, err
	}
	lastError, err := rejectCodeToProto(item.LastRejectCode)
	if err != nil {
		return nil, err
	}
	wire := &chat.DurableDeviceInboxItem{
		ItemId: item.ItemID,
		Recipient: &touchmodel.ActorDeviceRef{
			Actor:    &touchmodel.ActorRef{Ptid: string(item.Recipient.Actor)},
			DeviceId: string(item.Recipient.Device),
		},
		LaneSequence:   item.LaneSequence,
		EventId:        string(item.EventID),
		ConversationId: string(item.ConversationID),
		IdempotencyKey: item.IdempotencyKey,
		PayloadType:    payloadType,
		OpaquePayload:  append([]byte(nil), item.OpaquePayload...),
		PayloadSha256:  item.PayloadHash.Bytes(),
		State:          state,
		AttemptCount:   item.AttemptCount,
		FirstQueuedAt:  timestamppb.New(item.FirstQueuedAt.UTC()),
		NextAttemptAt:  timestamppb.New(item.NextAttemptAt.UTC()),
		LastErrorCode:  lastError,
	}
	if item.Lease != nil {
		wire.Lease = &chat.DeviceInboxLease{
			ConsumerId:    item.Lease.ConsumerID,
			ConsumerEpoch: item.Lease.ConsumerEpoch,
			ExpiresAt:     timestamppb.New(item.Lease.ExpiresAt.UTC()),
		}
	}
	if item.ExpiresAt != nil {
		wire.ExpiresAt = timestamppb.New(item.ExpiresAt.UTC())
	}
	if item.AckedAt != nil {
		wire.AckedAt = timestamppb.New(item.AckedAt.UTC())
	}

	return wire, nil
}

func payloadTypeToProto(payloadType delivery.PayloadType) (chat.DeviceInboxPayloadType, error) {
	switch payloadType {
	case delivery.PayloadTypeConversationEvent:
		return chat.DeviceInboxPayloadType_DEVICE_INBOX_PAYLOAD_TYPE_CONVERSATION_EVENT, nil
	case delivery.PayloadTypeDirectSessionInit:
		return chat.DeviceInboxPayloadType_DEVICE_INBOX_PAYLOAD_TYPE_DIRECT_SESSION_INIT, nil
	case delivery.PayloadTypeMLSTransition:
		return chat.DeviceInboxPayloadType_DEVICE_INBOX_PAYLOAD_TYPE_MLS_TRANSITION, nil
	case delivery.PayloadTypeCommandResult:
		return chat.DeviceInboxPayloadType_DEVICE_INBOX_PAYLOAD_TYPE_COMMAND_RESULT, nil
	case delivery.PayloadTypeDeviceReceipt:
		return chat.DeviceInboxPayloadType_DEVICE_INBOX_PAYLOAD_TYPE_DEVICE_RECEIPT, nil
	default:
		return 0, delivery.NewError(
			delivery.ErrorCodePersistence,
			"device_inbox_handler.payload_type_to_proto",
			"payload_type",
			"is not supported",
		)
	}
}

func itemStateToProto(state delivery.ItemState) (chat.DeviceInboxItemState, error) {
	switch state {
	case delivery.ItemStatePending:
		return chat.DeviceInboxItemState_DEVICE_INBOX_ITEM_STATE_PENDING, nil
	case delivery.ItemStateClaimed:
		return chat.DeviceInboxItemState_DEVICE_INBOX_ITEM_STATE_CLAIMED, nil
	case delivery.ItemStateRetryWait:
		return chat.DeviceInboxItemState_DEVICE_INBOX_ITEM_STATE_RETRY_WAIT, nil
	case delivery.ItemStateConsumed:
		return 0, delivery.NewError(
			delivery.ErrorCodePersistence,
			"device_inbox_handler.item_state_to_proto",
			"state",
			"persisted consumed state has no canonical inbox wire representation",
		)
	case delivery.ItemStateAcked:
		return chat.DeviceInboxItemState_DEVICE_INBOX_ITEM_STATE_ACKED, nil
	case delivery.ItemStateDeadLetter:
		return chat.DeviceInboxItemState_DEVICE_INBOX_ITEM_STATE_DEAD_LETTER, nil
	default:
		return 0, delivery.NewError(
			delivery.ErrorCodePersistence,
			"device_inbox_handler.item_state_to_proto",
			"state",
			"is not supported",
		)
	}
}

func rejectCodeFromProto(code chat.DeviceInboxRejectCode) (delivery.RejectCode, error) {
	switch code {
	case chat.DeviceInboxRejectCode_DEVICE_INBOX_REJECT_CODE_PAYLOAD_INVALID:
		return delivery.RejectCodePayloadInvalid, nil
	case chat.DeviceInboxRejectCode_DEVICE_INBOX_REJECT_CODE_CRYPTO_STATE_UNAVAILABLE:
		return delivery.RejectCodeCryptoStateUnavailable, nil
	case chat.DeviceInboxRejectCode_DEVICE_INBOX_REJECT_CODE_INTEGRITY_FAILED:
		return delivery.RejectCodeIntegrityFailed, nil
	case chat.DeviceInboxRejectCode_DEVICE_INBOX_REJECT_CODE_RECIPIENT_MISMATCH:
		return delivery.RejectCodeRecipientMismatch, nil
	case chat.DeviceInboxRejectCode_DEVICE_INBOX_REJECT_CODE_RETRY_LATER:
		return delivery.RejectCodeRetryLater, nil
	default:
		return "", delivery.NewError(
			delivery.ErrorCodeInvalidArgument,
			"device_inbox_handler.reject_code_from_proto",
			"error_code",
			"is not supported",
		)
	}
}

func rejectCodeToProto(code delivery.RejectCode) (chat.DeviceInboxRejectCode, error) {
	switch code {
	case "":
		return chat.DeviceInboxRejectCode_DEVICE_INBOX_REJECT_CODE_UNSPECIFIED, nil
	case delivery.RejectCodePayloadInvalid:
		return chat.DeviceInboxRejectCode_DEVICE_INBOX_REJECT_CODE_PAYLOAD_INVALID, nil
	case delivery.RejectCodeCryptoStateUnavailable:
		return chat.DeviceInboxRejectCode_DEVICE_INBOX_REJECT_CODE_CRYPTO_STATE_UNAVAILABLE, nil
	case delivery.RejectCodeIntegrityFailed:
		return chat.DeviceInboxRejectCode_DEVICE_INBOX_REJECT_CODE_INTEGRITY_FAILED, nil
	case delivery.RejectCodeRecipientMismatch:
		return chat.DeviceInboxRejectCode_DEVICE_INBOX_REJECT_CODE_RECIPIENT_MISMATCH, nil
	case delivery.RejectCodeRetryLater:
		return chat.DeviceInboxRejectCode_DEVICE_INBOX_REJECT_CODE_RETRY_LATER, nil
	default:
		return 0, delivery.NewError(
			delivery.ErrorCodePersistence,
			"device_inbox_handler.reject_code_to_proto",
			"last_error_code",
			"is not supported",
		)
	}
}

var _ DeviceInboxApplication = (*delivery.Service)(nil)
