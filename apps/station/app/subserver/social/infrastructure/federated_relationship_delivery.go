package infrastructure

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
)

type FederatedRelationshipReceiver interface {
	ReceiveRelationshipEvent(
		ctx context.Context,
		transaction FederatedRelationshipTransaction,
		event *model.SocialRelationshipEvent,
		frame *delivery.Frame,
	) (delivery.Result, error)
}

func RegisterFederatedRelationshipReceiver(
	registry *delivery.Registry,
	receiver FederatedRelationshipReceiver,
) error {
	return delivery.RegisterProtoReceiver(
		registry,
		delivery.PayloadKindSocialRelationshipEvent,
		func() *model.SocialRelationshipEvent {
			return &model.SocialRelationshipEvent{}
		},
		func(
			ctx context.Context,
			transaction delivery.Transaction,
			event *model.SocialRelationshipEvent,
			frame *delivery.Frame,
		) (delivery.Result, error) {
			socialTransaction, err :=
				socialRelationshipTransactionFromDelivery(transaction)
			if err != nil {
				return delivery.Result{}, err
			}
			return receiver.ReceiveRelationshipEvent(
				ctx,
				socialTransaction,
				event,
				frame,
			)
		},
	)
}
