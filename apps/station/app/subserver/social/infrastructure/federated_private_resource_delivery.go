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
}

func RegisterFederatedPrivateResourceReceiver(
	registry *delivery.Registry,
	receiver FederatedPrivateResourceReceiver,
) error {
	return delivery.RegisterProtoReceiver(
		registry,
		delivery.PayloadKindSocialPrivateResource,
		func() *privatecontentpb.FederatedPrivateResourceDelivery {
			return &privatecontentpb.FederatedPrivateResourceDelivery{}
		},
		receiver.ReceiveFederatedPrivateResource,
	)
}
