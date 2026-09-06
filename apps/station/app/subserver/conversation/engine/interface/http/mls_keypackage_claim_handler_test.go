package httpinterface

import (
	"testing"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestMlsKeyPackageClaimClaimsBindDestructiveRequest(t *testing.T) {
	expiresAt := time.Unix(1_700_000_300, 123_456_000).UTC()
	request := &chat.ClaimFederatedMlsKeyPackageRequest{
		AuthorityPlanId:    "plan-1",
		AuthorityStationId: "station-authority",
		Target: &chat.CryptoEndpoint{
			Ptid:     "bob",
			DeviceId: "bob-1",
		},
		PlanExpiresAt: timestamppb.New(expiresAt),
	}
	claims := validMlsKeyPackageClaims(request, "station-home")
	if !validMlsKeyPackageClaimClaims(claims, request) {
		t.Fatal("valid destructive claim binding was rejected")
	}

	tests := []struct {
		name   string
		mutate func(*authfed.VerifiedClaims)
	}{
		{
			name: "scope",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Scope = messaging.AuthorityPrepareScope
			},
		},
		{
			name: "issuer",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Issuer = "station-other"
			},
		},
		{
			name: "subject",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Subject = "station-other"
			},
		},
		{
			name: "plan",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Custom[messaging.FederationClaimAuthorityPlanID] = "plan-other"
			},
		},
		{
			name: "ptid",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Custom[messaging.FederationClaimTargetPTID] = "mallory"
			},
		},
		{
			name: "device",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Custom[messaging.FederationClaimTargetDeviceID] = "bob-2"
			},
		},
		{
			name: "expiry",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Custom[messaging.FederationClaimPlanExpiresAt] =
					expiresAt.Add(time.Second).Format(time.RFC3339Nano)
			},
		},
		{
			name: "source",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Custom[messaging.FederationClaimSourceStationID] = "station-other"
			},
		},
		{
			name: "target",
			mutate: func(claims *authfed.VerifiedClaims) {
				claims.Custom[messaging.FederationClaimTargetStationID] = "station-other"
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			claims := validMlsKeyPackageClaims(request, "station-home")
			test.mutate(claims)
			if validMlsKeyPackageClaimClaims(claims, request) {
				t.Fatal("mismatched destructive claim binding was accepted")
			}
		})
	}
}

func validMlsKeyPackageClaims(
	request *chat.ClaimFederatedMlsKeyPackageRequest,
	targetStationID string,
) *authfed.VerifiedClaims {
	return &authfed.VerifiedClaims{
		Scope:    messaging.MlsKeyPackageClaimScope,
		Issuer:   request.AuthorityStationId,
		Subject:  request.AuthorityStationId,
		Audience: targetStationID,
		Custom: map[string]string{
			messaging.FederationClaimAuthorityPlanID: request.AuthorityPlanId,
			messaging.FederationClaimTargetPTID:      request.Target.Ptid,
			messaging.FederationClaimTargetDeviceID:  request.Target.DeviceId,
			messaging.FederationClaimPlanExpiresAt: request.PlanExpiresAt.
				AsTime().
				UTC().
				Format(time.RFC3339Nano),
			messaging.FederationClaimSourceStationID: request.AuthorityStationId,
			messaging.FederationClaimTargetStationID: targetStationID,
		},
	}
}
