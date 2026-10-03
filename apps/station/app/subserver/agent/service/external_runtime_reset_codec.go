package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func externalRuntimeResetPayloadHash(
	actorPTID string,
	request *model.ResetConversationRuntimeRequest,
) string {
	encoded, _ := json.Marshal(struct {
		ActorPTID            string `json:"actor_ptid"`
		ConversationID       string `json:"conversation_id"`
		ExpectedVersion      uint64 `json:"expected_version"`
		IdempotencyKey       string `json:"idempotency_key"`
		DestructiveConfirmed bool   `json:"destructive_confirmed"`
	}{
		ActorPTID:            strings.TrimSpace(actorPTID),
		ConversationID:       strings.TrimSpace(request.GetConversationId()),
		ExpectedVersion:      request.GetExpectedConversationVersion(),
		IdempotencyKey:       strings.TrimSpace(request.GetClientIdempotencyKey()),
		DestructiveConfirmed: request.GetDestructiveConfirmed(),
	})
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:])
}

func encodeExternalRuntimeResetResult(
	result *ExternalRuntimeResetResult,
) (string, error) {
	response := &model.ResetConversationRuntimeResponse{
		Conversation:               externalRuntimeConversationToProto(result.Conversation),
		ClosedExternalSessionEpoch: result.ClosedEpoch,
	}
	encoded, err := protojson.Marshal(response)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func decodeExternalRuntimeResetResult(
	value string,
) (*ExternalRuntimeResetResult, error) {
	response := &model.ResetConversationRuntimeResponse{}
	if err := protojson.Unmarshal([]byte(value), response); err != nil {
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"stored external runtime reset response is invalid",
			err,
		)
	}
	return &ExternalRuntimeResetResult{
		Conversation: externalRuntimeConversationFromProto(response.GetConversation()),
		ClosedEpoch:  response.GetClosedExternalSessionEpoch(),
	}, nil
}

func externalRuntimeConversationToProto(
	conversation *domain.Conversation,
) *model.Conversation {
	if conversation == nil {
		return nil
	}
	result := &model.Conversation{
		ConversationId:        conversation.ConversationID,
		AgentId:               conversation.AgentID,
		ActorPtid:             conversation.ActorPTID,
		Title:                 conversation.Title,
		Description:           conversation.Description,
		ProviderId:            conversation.ProviderID,
		ModelName:             conversation.ModelName,
		Status:                string(conversation.Status),
		ParentId:              conversation.ParentID,
		Meta:                  conversation.Meta,
		ActiveBranchMessageId: conversation.ActiveBranchMessageID,
		QueuedTurnCount:       conversation.QueuedTurnCount,
		Version:               conversation.Version,
		CreatedAt:             timestamppb.New(conversation.CreatedAt),
		UpdatedAt:             timestamppb.New(conversation.UpdatedAt),
	}
	if conversation.RuntimeBinding != nil {
		result.RuntimeBinding = proto.Clone(
			conversation.RuntimeBinding,
		).(*model.ConversationRuntimeBinding)
	}
	return result
}

func externalRuntimeConversationFromProto(
	conversation *model.Conversation,
) *domain.Conversation {
	if conversation == nil {
		return nil
	}
	result := &domain.Conversation{
		ConversationID:        conversation.GetConversationId(),
		AgentID:               conversation.GetAgentId(),
		ActorPTID:             conversation.GetActorPtid(),
		Title:                 conversation.GetTitle(),
		Description:           conversation.GetDescription(),
		ProviderID:            conversation.GetProviderId(),
		ModelName:             conversation.GetModelName(),
		Status:                domain.ConversationStatus(conversation.GetStatus()),
		ParentID:              conversation.GetParentId(),
		Meta:                  conversation.GetMeta(),
		ActiveBranchMessageID: conversation.GetActiveBranchMessageId(),
		QueuedTurnCount:       conversation.GetQueuedTurnCount(),
		Version:               conversation.GetVersion(),
	}
	if conversation.GetRuntimeBinding() != nil {
		result.RuntimeBinding = proto.Clone(
			conversation.GetRuntimeBinding(),
		).(*model.ConversationRuntimeBinding)
	}
	if conversation.GetCreatedAt() != nil {
		result.CreatedAt = conversation.GetCreatedAt().AsTime()
	}
	if conversation.GetUpdatedAt() != nil {
		result.UpdatedAt = conversation.GetUpdatedAt().AsTime()
	}
	return result
}
