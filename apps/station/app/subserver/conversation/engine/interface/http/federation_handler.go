package httpinterface

import (
	"context"
	"crypto/ed25519"
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/application"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

var ErrFederationBinding = errors.New("messaging: authenticated federation frame binding mismatch")

type AuthenticatedFederationPeer struct {
	SourceStationID string
	TargetStationID string
	FrameID         string
	IdempotencyKey  string
	SigningKeyID    string
	PublicKey       ed25519.PublicKey
}

type FederationFrameService interface {
	Deliver(
		ctx context.Context,
		frame *chat.MessagingFederationFrame,
		expectedTargetStationID string,
		sourceStationPublicKey ed25519.PublicKey,
		now time.Time,
	) (*chat.DeliverMessagingFederationFrameResponse, error)
}

type FederationHandler struct {
	service FederationFrameService
	clock   func() time.Time
}

func NewFederationHandler(
	service FederationFrameService,
	clock func() time.Time,
) (*FederationHandler, error) {
	if service == nil || clock == nil {
		return nil, errors.New("messaging: federation handler dependencies are invalid")
	}
	return &FederationHandler{service: service, clock: clock}, nil
}

func (h *FederationHandler) Deliver(
	ctx context.Context,
	peer AuthenticatedFederationPeer,
	request *chat.DeliverMessagingFederationFrameRequest,
) (*chat.DeliverMessagingFederationFrameResponse, error) {
	if request == nil ||
		request.Frame == nil ||
		peer.SourceStationID == "" ||
		peer.TargetStationID == "" ||
		peer.FrameID == "" ||
		peer.IdempotencyKey == "" ||
		peer.SigningKeyID == "" ||
		len(peer.PublicKey) != ed25519.PublicKeySize ||
		request.Frame.SourceStationId != peer.SourceStationID ||
		request.Frame.TargetStationId != peer.TargetStationID ||
		request.Frame.FrameId != peer.FrameID ||
		request.Frame.IdempotencyKey != peer.IdempotencyKey ||
		request.Frame.SigningKeyId != peer.SigningKeyID {
		return nil, ErrFederationBinding
	}
	return h.service.Deliver(
		ctx,
		request.Frame,
		peer.TargetStationID,
		peer.PublicKey,
		h.clock().UTC(),
	)
}

func (h *FederationHandler) DeliverAuthenticated(
	ctx context.Context,
	request *chat.DeliverMessagingFederationFrameRequest,
) (*chat.DeliverMessagingFederationFrameResponse, error) {
	peer, err := AuthenticatedFederationPeerFromClaims(httpadapter.GetVerifiedClaims(ctx))
	if err != nil {
		return nil, err
	}
	return h.Deliver(ctx, peer, request)
}

var _ FederationFrameService = (*application.FederationService)(nil)
