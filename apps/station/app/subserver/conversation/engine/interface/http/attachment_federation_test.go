package httpinterface

import (
	"testing"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
)

func validAttachmentClaims() *authfed.VerifiedClaims {
	return &authfed.VerifiedClaims{
		Scope:    messaging.AttachmentTransferScope,
		Issuer:   "station:home",
		Subject:  "station:home",
		Audience: "station:authority",
		Custom: map[string]string{
			messaging.FederationClaimConversationID:       "conversation-1",
			messaging.FederationClaimActorPTID:            "alice",
			messaging.FederationClaimDeviceID:             "alice-device",
			messaging.FederationClaimAttachmentAction:     "part",
			messaging.FederationClaimAttachmentResourceID: "upload-1/0",
			messaging.FederationClaimSourceStationID:      "station:home",
			messaging.FederationClaimTargetStationID:      "station:authority",
		},
	}
}

func TestAttachmentTransferClaimsBindEveryRoutingDimension(t *testing.T) {
	if !validAttachmentTransferClaims(
		validAttachmentClaims(),
		"station:authority",
		"conversation-1",
		"part",
		"upload-1/0",
	) {
		t.Fatal("valid claims rejected")
	}
	tests := []struct {
		name   string
		mutate func(*authfed.VerifiedClaims)
	}{
		{
			name: "scope",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Scope = "other"
			},
		},
		{
			name: "issuer source mismatch",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Custom[messaging.FederationClaimSourceStationID] = "station:other"
			},
		},
		{
			name: "target mismatch",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Custom[messaging.FederationClaimTargetStationID] = "station:other"
			},
		},
		{
			name: "actor missing",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Custom[messaging.FederationClaimActorPTID] = ""
			},
		},
		{
			name: "device missing",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Custom[messaging.FederationClaimDeviceID] = ""
			},
		},
		{
			name: "action mismatch",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Custom[messaging.FederationClaimAttachmentAction] = "complete"
			},
		},
		{
			name: "resource mismatch",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Custom[messaging.FederationClaimAttachmentResourceID] = "upload-2/0"
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			claims := validAttachmentClaims()
			test.mutate(claims)
			if validAttachmentTransferClaims(
				claims,
				"station:authority",
				"conversation-1",
				"part",
				"upload-1/0",
			) {
				t.Fatal("mismatched claims accepted")
			}
		})
	}
}
