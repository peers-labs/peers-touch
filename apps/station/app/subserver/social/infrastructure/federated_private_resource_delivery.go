package infrastructure

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
)

type FederatedPrivateResourceReceiver interface {
	ReceiveFederatedPrivateResource(
		context.Context,
		delivery.Transaction,
		*privatecontentpb.FederatedPrivateResourceDelivery,
		*delivery.Frame,
	) (delivery.Result, error)
	ReceiveFederatedPrivateInvalidation(
		context.Context,
		delivery.Transaction,
		*privatecontentpb.FederatedPrivateResourceInvalidation,
		*delivery.Frame,
	) (delivery.Result, error)
}

func RegisterFederatedPrivateResourceReceivers(
	registry *delivery.Registry,
	receiver FederatedPrivateResourceReceiver,
) error {
	if err := delivery.RegisterProtoReceiver(
		registry,
		delivery.PayloadKindSocialPrivateResource,
		func() *privatecontentpb.FederatedPrivateResourceDelivery {
			return &privatecontentpb.FederatedPrivateResourceDelivery{}
		},
		receiver.ReceiveFederatedPrivateResource,
	); err != nil {
		return err
	}
	return delivery.RegisterProtoReceiver(
		registry,
		delivery.PayloadKindSocialPrivateInvalidation,
		func() *privatecontentpb.FederatedPrivateResourceInvalidation {
			return &privatecontentpb.FederatedPrivateResourceInvalidation{}
		},
		receiver.ReceiveFederatedPrivateInvalidation,
	)
}
