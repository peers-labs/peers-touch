package conversation

import (
	"encoding/json"

	"github.com/peers-labs/peers-touch/station/frame/core/social_gate"
)

// --- Operation extractors for gate wrappers ---
// Each extractor derives Operation fields from the raw request body payload.
// They are invoked by social_gate.NewGateWrapper before the inner handler runs.

// extractCreateDirectOp extracts the target actor DID from a CreateDirectConversationRequest body.
func extractCreateDirectOp(body []byte) social_gate.Operation {
	var partial struct {
		PeerPtid string `json:"peer_ptid"`
	}
	_ = json.Unmarshal(body, &partial)
	return social_gate.Operation{
		TargetPtid: partial.PeerPtid,
	}
}

// extractSubmitCommandOp extracts the conversation_id from a SubmitConversationCommandRequest body.
// The gate uses "send_message" as a general membership check for all command submissions.
// The command-level action dispatching (add_member, remove_member, dissolve) is handled
// at the service layer, which has full access to the deserialized protobuf command.
func extractSubmitCommandOp(body []byte) social_gate.Operation {
	var partial struct {
		Command struct {
			ConversationID string `json:"conversation_id"`
		} `json:"command"`
	}
	_ = json.Unmarshal(body, &partial)

	// Fallback: try top-level conversation_id for flat payloads
	convID := partial.Command.ConversationID
	if convID == "" {
		var flat struct {
			ConversationID string `json:"conversation_id"`
		}
		_ = json.Unmarshal(body, &flat)
		convID = flat.ConversationID
	}

	return social_gate.Operation{
		ConversationID: convID,
	}
}

// extractFetchKeyPackageOp extracts the target actor DID from a FetchKeyPackageRequest body.
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
