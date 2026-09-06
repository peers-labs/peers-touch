package httpinterface

import (
	"context"
	"errors"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

var ErrAttachmentTransferBinding = errors.New(
	"messaging: authenticated attachment transfer binding mismatch",
)

func AuthenticateAttachmentTransfer(
	ctx context.Context,
	devices messaging.DeviceDirectory,
	localStationID string,
	conversationID string,
	action string,
	resourceID string,
) (*chat.CryptoEndpoint, error) {
	claims := httpadapter.GetVerifiedClaims(ctx)
	if !validAttachmentTransferClaims(
		claims,
		localStationID,
		conversationID,
		action,
		resourceID,
	) {
		return nil, ErrAttachmentTransferBinding
	}
	endpoint := &chat.CryptoEndpoint{
		Ptid:     claims.Custom[messaging.FederationClaimActorPTID],
		DeviceId: claims.Custom[messaging.FederationClaimDeviceID],
	}
	homeStationID, err := devices.HomeStationID(ctx, endpoint)
	if err != nil {
		return nil, err
	}
	if homeStationID != claims.Issuer {
		return nil, ErrAttachmentTransferBinding
	}
	return endpoint, nil
}

func validAttachmentTransferClaims(
	claims *authfed.VerifiedClaims,
	localStationID string,
	conversationID string,
	action string,
	resourceID string,
) bool {
	return claims != nil &&
		localStationID != "" &&
		conversationID != "" &&
		action != "" &&
		resourceID != "" &&
		claims.Scope == messaging.AttachmentTransferScope &&
		claims.Subject == claims.Issuer &&
		claims.Audience == localStationID &&
		claims.Custom[messaging.FederationClaimConversationID] == conversationID &&
		claims.Custom[messaging.FederationClaimActorPTID] != "" &&
		claims.Custom[messaging.FederationClaimDeviceID] != "" &&
		claims.Custom[messaging.FederationClaimAttachmentAction] == action &&
		claims.Custom[messaging.FederationClaimAttachmentResourceID] == resourceID &&
		claims.Custom[messaging.FederationClaimSourceStationID] == claims.Issuer &&
		claims.Custom[messaging.FederationClaimTargetStationID] == claims.Audience
}
