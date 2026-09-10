package conversation

import (
	"testing"

	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
)

func TestValidateFederatedAttachmentClaimValuesBindsExactOperation(t *testing.T) {
	claims := &authfed.VerifiedClaims{
		Scope:    federationruntime.ConversationAttachmentScope,
		Issuer:   "station-home",
		Audience: "station-authority",
		Subject:  "ptid:alice",
		Custom: map[string]string{
			federationruntime.ClaimConversationID:       "conversation-1",
			federationruntime.ClaimActorPTID:            "ptid:alice",
			federationruntime.ClaimDeviceID:             "alice-device",
			federationruntime.ClaimAttachmentAction:     productionAttachmentActionChunk,
			federationruntime.ClaimAttachmentResourceID: "upload-1/chunks/7",
			federationruntime.ClaimSourceStationPeerID:  "station-home",
			federationruntime.ClaimTargetStationPeerID:  "station-authority",
		},
	}
	if err := validateFederatedAttachmentClaimValues(
		claims,
		"station-authority",
		"station-home",
		"station-authority",
		"conversation-1",
		productionAttachmentActionChunk,
		"upload-1/chunks/7",
	); err != nil {
		t.Fatalf("valid attachment claims: %v", err)
	}

	for _, testCase := range []struct {
		name       string
		action     string
		resourceID string
	}{
		{
			name:       "other action",
			action:     productionAttachmentActionComplete,
			resourceID: "upload-1/chunks/7",
		},
		{
			name:       "other chunk",
			action:     productionAttachmentActionChunk,
			resourceID: "upload-1/chunks/8",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if err := validateFederatedAttachmentClaimValues(
				claims,
				"station-authority",
				"station-home",
				"station-authority",
				"conversation-1",
				testCase.action,
				testCase.resourceID,
			); err == nil {
				t.Fatal("mismatched attachment operation was accepted")
			}
		})
	}
}
