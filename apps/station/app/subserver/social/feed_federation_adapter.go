package social

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	federation "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

func feedPeerPull(runtime *federation.Runtime) func(context.Context, string, string, *model.ReadFeedRequest) (*model.ReadFeedResponse, error) {
	return func(ctx context.Context, home, subscriber string, request *model.ReadFeedRequest) (*model.ReadFeedResponse, error) {
		wire, err := signedlog.Canonical(request)
		if err != nil {
			return nil, err
		}
		digest := sha256.Sum256(wire)
		response, err := runtime.OpenPeerStream(ctx, federation.PeerStreamCall{
			TargetStationPeerID: home, Route: federation.PeerRouteSocialPublicFeedRead, Subject: subscriber,
			Claims: map[string]string{federation.ClaimSourceStationPeerID: home,
				federation.ClaimTargetStationPeerID: runtime.LocalStationPeerID(),
				federation.ClaimActorPTID:           subscriber, federation.ClaimFeedAuthorPTID: request.ActorPtid,
				federation.ClaimFeedChainID: request.ChainId, federation.ClaimCanonicalRequestSHA256: hex.EncodeToString(digest[:])},
			Headers: map[string]string{"Content-Type": "application/protobuf", "Accept": "application/protobuf"},
			Body:    bytes.NewReader(wire),
		})
		if err != nil {
			return nil, err
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return nil, domain.ErrFeedGap
		}
		body, err := io.ReadAll(io.LimitReader(response.Body, signedlog.MaxMessageBytes+1))
		if err != nil {
			return nil, err
		}
		result := &model.ReadFeedResponse{}
		if err := signedlog.Decode(body, result); err != nil {
			return nil, err
		}
		return result, nil
	}
}

func (s *subServer) handleFederatedFeedRead(ctx context.Context, request server.Request, response server.Response) error {
	if socialObjectHeader(request, "Content-Type") != "application/protobuf" {
		response.WriteHeader(http.StatusBadRequest)
		return nil
	}
	var reader io.Reader = bytes.NewReader(request.Body())
	if streaming, ok := request.(server.StreamingRequest); ok {
		reader = streaming.BodyStream()
	}
	wire, err := io.ReadAll(io.LimitReader(reader, signedlog.MaxMessageBytes+1))
	decoded := &model.ReadFeedRequest{}
	if err != nil || signedlog.Decode(wire, decoded) != nil {
		response.WriteHeader(http.StatusBadRequest)
		return nil
	}
	result, err := s.feedLogSvc.ReadFederated(ctx, httpadapter.GetVerifiedClaims(ctx), decoded, wire)
	if err != nil {
		response.WriteHeader(http.StatusForbidden)
		return nil
	}
	body, err := signedlog.Canonical(result)
	if err != nil {
		return err
	}
	response.SetHeader("Content-Type", "application/protobuf")
	response.WriteHeader(http.StatusOK)
	_, err = response.Write(body)
	return err
}
