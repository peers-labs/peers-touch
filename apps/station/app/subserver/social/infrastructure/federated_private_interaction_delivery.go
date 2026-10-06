package infrastructure

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
)

type FederatedPrivateInteractionReceiver interface {
	ReceiveFederatedPrivateInteractionCommand(
		context.Context,
		delivery.Transaction,
		*privatecontentpb.FederatedPrivateInteractionCommand,
		*delivery.Frame,
	) (delivery.Result, error)
	ReceiveFederatedPrivateInteractionResult(
		context.Context,
		delivery.Transaction,
		*privatecontentpb.FederatedPrivateInteractionResult,
		*delivery.Frame,
	) (delivery.Result, error)
}

func RegisterFederatedPrivateInteractionReceivers(
	registry *delivery.Registry,
	receiver FederatedPrivateInteractionReceiver,
) error {
	if err := delivery.RegisterProtoReceiver(
		registry,
		delivery.PayloadKindSocialPrivateInteraction,
		func() *privatecontentpb.FederatedPrivateInteractionCommand {
			return &privatecontentpb.FederatedPrivateInteractionCommand{}
		},
		receiver.ReceiveFederatedPrivateInteractionCommand,
	); err != nil {
		return err
	}
	return delivery.RegisterProtoReceiver(
		registry,
		delivery.PayloadKindSocialPrivateResult,
		func() *privatecontentpb.FederatedPrivateInteractionResult {
			return &privatecontentpb.FederatedPrivateInteractionResult{}
		},
		receiver.ReceiveFederatedPrivateInteractionResult,
	)
}
