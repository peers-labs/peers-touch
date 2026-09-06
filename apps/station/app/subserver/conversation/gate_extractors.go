package conversation

import (
	"encoding/json"

	"github.com/peers-labs/peers-touch/station/frame/core/social_gate"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

// --- Operation extractors for gate wrappers ---
// Each extractor derives Operation fields from the raw request body payload.
// They are invoked by social_gate.NewGateWrapper before the inner handler runs.

// extractCreateDirectOp extracts the target actor PTID from a CreateDirectConversationRequest body.
func extractCreateDirectOp(body []byte) social_gate.Operation {
	var protobufRequest chat.CreateMessagingDirectConversationRequest
	if err := proto.Unmarshal(body, &protobufRequest); err == nil &&
		protobufRequest.PeerPtid != "" {
		return social_gate.Operation{TargetPtid: protobufRequest.PeerPtid}
	}
	var partial struct {
		PeerPtid string `json:"peer_ptid"`
	}
	_ = json.Unmarshal(body, &partial)
	return social_gate.Operation{
		TargetPtid: partial.PeerPtid,
	}
}

// extractFetchKeyPackageOp extracts the target actor PTID from a FetchKeyPackageRequest body.
func extractFetchKeyPackageOp(body []byte) social_gate.Operation {
	var partial struct {
		Ptid string `json:"ptid"`
	}
	_ = json.Unmarshal(body, &partial)
	return social_gate.Operation{
		TargetPtid: partial.Ptid,
	}
}

// extractDkxSendOp extracts the conversation and recipient from a SendDkxRequest body.
// DKX is allowed only for active members of the direct conversation.
func extractDkxSendOp(body []byte) social_gate.Operation {
	var partial struct {
		RecipientPtid string `json:"recipient_ptid"`
		SessionID     string `json:"session_id"`
	}
	_ = json.Unmarshal(body, &partial)
	return social_gate.Operation{
		TargetPtid:     partial.RecipientPtid,
		ConversationID: partial.SessionID,
	}
}
