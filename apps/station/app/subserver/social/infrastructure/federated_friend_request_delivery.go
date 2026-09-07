package infrastructure

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// FederatedFriendRequestReceiver owns typed Social behavior after Federation admission.
type FederatedFriendRequestReceiver interface {
	ReceiveFriendRequestCommand(
		ctx context.Context,
		transaction FederatedFriendRequestTransaction,
		command *model.FriendRequestCommand,
		frame *delivery.Frame,
	) (delivery.Result, error)
	ReceiveFriendRequestEvent(
		ctx context.Context,
		transaction FederatedFriendRequestTransaction,
		event *model.FriendRequestEvent,
		frame *delivery.Frame,
	) (delivery.Result, error)
	ReceiveFriendRequestResult(
		ctx context.Context,
		transaction FederatedFriendRequestTransaction,
		result *model.FriendRequestCommandResult,
		frame *delivery.Frame,
	) (delivery.Result, error)
}

// RegisterFederatedFriendRequestReceivers binds all canonical Social payload kinds.
func RegisterFederatedFriendRequestReceivers(
	registry *delivery.Registry,
	receiver FederatedFriendRequestReceiver,
) error {
	if err := delivery.RegisterProtoReceiver(
		registry,
		delivery.PayloadKindSocialFriendRequestCommand,
		func() *model.FriendRequestCommand {
			return &model.FriendRequestCommand{}
		},
		func(
			ctx context.Context,
			transaction delivery.Transaction,
			command *model.FriendRequestCommand,
			frame *delivery.Frame,
		) (delivery.Result, error) {
			socialTransaction, err := friendRequestTransactionFromDelivery(transaction)
			if err != nil {
				return delivery.Result{}, err
			}
			return receiver.ReceiveFriendRequestCommand(
				ctx,
				socialTransaction,
				command,
				frame,
			)
		},
	); err != nil {
		return err
	}
	if err := delivery.RegisterProtoReceiver(
		registry,
		delivery.PayloadKindSocialFriendRequestEvent,
		func() *model.FriendRequestEvent {
			return &model.FriendRequestEvent{}
		},
		func(
			ctx context.Context,
			transaction delivery.Transaction,
			event *model.FriendRequestEvent,
			frame *delivery.Frame,
		) (delivery.Result, error) {
			socialTransaction, err := friendRequestTransactionFromDelivery(transaction)
			if err != nil {
				return delivery.Result{}, err
			}
			return receiver.ReceiveFriendRequestEvent(
				ctx,
				socialTransaction,
				event,
				frame,
			)
		},
	); err != nil {
		return err
	}
	return delivery.RegisterProtoReceiver(
		registry,
		delivery.PayloadKindSocialFriendRequestResult,
		func() *model.FriendRequestCommandResult {
			return &model.FriendRequestCommandResult{}
		},
		func(
			ctx context.Context,
			transaction delivery.Transaction,
			result *model.FriendRequestCommandResult,
			frame *delivery.Frame,
		) (delivery.Result, error) {
			socialTransaction, err := friendRequestTransactionFromDelivery(transaction)
			if err != nil {
				return delivery.Result{}, err
			}
			return receiver.ReceiveFriendRequestResult(
				ctx,
				socialTransaction,
				result,
				frame,
			)
		},
	)
}

// NewSameStationFriendRequestTransport preserves the authenticated receiver path locally.
func NewSameStationFriendRequestTransport(
	receiver delivery.FrameReceiver,
) (delivery.Transport, error) {
	return delivery.NewLocalTransport(receiver)
}
