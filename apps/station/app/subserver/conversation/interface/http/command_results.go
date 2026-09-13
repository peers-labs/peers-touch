package http

import (
	"bytes"
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/reconciliation"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

type CommandResultApplication interface {
	Resolve(
		ctx context.Context,
		caller valueobject.Endpoint,
		references []reconciliation.Reference,
	) ([]reconciliation.Resolution, error)
}

type CommandResultHandler struct {
	service CommandResultApplication
}

func NewCommandResultHandler(
	service CommandResultApplication,
) (*CommandResultHandler, error) {
	if service == nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"command_result_handler.new",
			"service",
			"is required",
		)
	}
	return &CommandResultHandler{service: service}, nil
}

func (h *CommandResultHandler) Resolve(
	ctx context.Context,
	authenticated AuthenticatedActor,
	request *chatmodel.ResolveConversationCommandResultsRequest,
) (*chatmodel.ResolveConversationCommandResultsResponse, error) {
	caller, err := valueobject.NewEndpoint(authenticated.PTID, authenticated.DeviceID)
	if err != nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"command_result_handler.resolve",
			"caller",
			"is not a valid authenticated endpoint",
		)
	}
	if request == nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"command_result_handler.resolve",
			"request",
			"is required",
		)
	}
	references := make([]reconciliation.Reference, 0, len(request.GetCommands()))
	for _, wire := range request.GetCommands() {
		if wire == nil {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeInvalidArgument,
				"command_result_handler.resolve",
				"commands",
				"contains an empty command reference",
			)
		}
		conversationID, err := valueobject.NewConversationID(wire.GetConversationId())
		if err != nil {
			return nil, err
		}
		commandID, err := valueobject.NewCommandID(wire.GetCommandId())
		if err != nil {
			return nil, err
		}
		commandHash, err := valueobject.NewHash(wire.GetCommandSha256())
		if err != nil {
			return nil, err
		}
		references = append(references, reconciliation.Reference{
			ConversationID: conversationID,
			CommandID:      commandID,
			CommandHash:    commandHash,
		})
	}
	resolved, err := h.service.Resolve(ctx, caller, references)
	if err != nil {
		return nil, err
	}
	response := &chatmodel.ResolveConversationCommandResultsResponse{
		Results: make([]*chatmodel.ResolvedConversationCommandResult, 0, len(resolved)),
	}
	for index := range resolved {
		wire, err := commandResolutionToProto(resolved[index])
		if err != nil {
			return nil, err
		}
		response.Results = append(response.Results, wire)
	}
	return response, nil
}

func commandResolutionToProto(
	resolved reconciliation.Resolution,
) (*chatmodel.ResolvedConversationCommandResult, error) {
	wire := &chatmodel.ResolvedConversationCommandResult{
		ConversationId: string(resolved.ConversationID),
		CommandId:      string(resolved.CommandID),
		CommandSha256:  resolved.CommandHash.Bytes(),
	}
	switch resolved.State {
	case reconciliation.StateHomePending:
		wire.State = chatmodel.ConversationCommandResolutionState_CONVERSATION_COMMAND_RESOLUTION_STATE_HOME_PENDING
	case reconciliation.StateNotFound:
		wire.State = chatmodel.ConversationCommandResolutionState_CONVERSATION_COMMAND_RESOLUTION_STATE_NOT_FOUND
	case reconciliation.StateAccepted:
		wire.State = chatmodel.ConversationCommandResolutionState_CONVERSATION_COMMAND_RESOLUTION_STATE_ACCEPTED
		if len(resolved.CanonicalResult) != 0 {
			result, err := decodeCanonicalProposalResult(resolved.CanonicalResult)
			if err != nil {
				return nil, err
			}
			wire.Result = result
			return wire, nil
		}
		event, err := MapEvent(*resolved.AuthorityEvent)
		if err != nil {
			return nil, err
		}
		wire.Result = &chatmodel.ConversationCommandProposalResult{
			CommandId:          wire.CommandId,
			Accepted:           true,
			Event:              event,
			AuthoritySequence:  event.GetSequence(),
			AuthorityEventHash: append([]byte(nil), event.GetEventHash()...),
		}
	case reconciliation.StateTerminalRejected:
		wire.State = chatmodel.ConversationCommandResolutionState_CONVERSATION_COMMAND_RESOLUTION_STATE_TERMINAL_REJECTED
		if len(resolved.CanonicalResult) != 0 {
			result, err := decodeCanonicalProposalResult(resolved.CanonicalResult)
			if err != nil {
				return nil, err
			}
			wire.Result = result
			wire.TerminalErrorCode = wire.Result.GetRejectCode()
			return wire, nil
		}
		rejection := conversationdomain.NewError(
			resolved.TerminalErrorCode,
			"command_result_handler.resolve",
			"command_id",
			"was terminally rejected",
		)
		wire.TerminalErrorCode = MapRejectCode(rejection)
		wire.Result = &chatmodel.ConversationCommandProposalResult{
			CommandId:  wire.CommandId,
			RejectCode: wire.TerminalErrorCode,
		}
	default:
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"command_result_handler.resolve",
			"state",
			"is not canonical",
		)
	}
	return wire, nil
}

func decodeCanonicalProposalResult(
	encoded []byte,
) (*chatmodel.ConversationCommandProposalResult, error) {
	var result chatmodel.ConversationCommandProposalResult
	if err := proto.Unmarshal(encoded, &result); err != nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"command_result_handler.decode_result",
			"result",
			"cannot be decoded",
		)
	}
	canonical, err := proto.MarshalOptions{Deterministic: true}.Marshal(&result)
	if err != nil || !bytes.Equal(canonical, encoded) {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"command_result_handler.decode_result",
			"result",
			"is not canonical",
		)
	}
	return &result, nil
}

var _ CommandResultApplication = (*reconciliation.Service)(nil)
