package social

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
)

type federatedPrivateObjectPeer struct {
	runtime *federationruntime.Runtime
}

func (p federatedPrivateObjectPeer) OpenFederatedPrivateObjectRange(
	ctx context.Context,
	sourceStationPeerID string,
	requestID string,
	request *privatecontentpb.ReadFederatedPrivateObjectRequest,
) (*application.FederatedPrivateObjectPeerResponse, error) {
	canonical, err :=
		socialdomain.CanonicalFederatedPrivateObjectReadRequestBytes(request)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(canonical)
	response, err := p.runtime.OpenPeerStream(
		ctx,
		federationruntime.PeerStreamCall{
			TargetStationPeerID: sourceStationPeerID,
			Route:               federationruntime.PeerRouteSocialPrivateObjectRead,
			Subject: request.GetViewer().
				GetActor().
				GetPtid(),
			Claims: map[string]string{
				federationruntime.ClaimFederationID: request.GetFederationId(),
				federationruntime.ClaimSourceStationPeerID: sourceStationPeerID,
				federationruntime.ClaimTargetStationPeerID: p.runtime.LocalStationPeerID(),
				federationruntime.ClaimActorPTID: request.GetViewer().
					GetActor().
					GetPtid(),
				federationruntime.ClaimDeviceID: request.GetViewer().GetDeviceId(),
				federationruntime.ClaimObjectID: request.GetObjectId(),
				federationruntime.ClaimCanonicalRequestSHA256: hex.EncodeToString(
					digest[:],
				),
			},
			PathParameters: map[string]string{
				"object_id": request.GetObjectId(),
			},
			Headers: map[string]string{
				"Accept":       "application/octet-stream",
				"Content-Type": "application/protobuf",
				"X-Request-ID": requestID,
			},
			Body: bytes.NewReader(canonical),
		},
	)
	if err != nil {
		var peerError *federationruntime.PeerResponseError
		if errors.As(err, &peerError) {
			return nil, &application.FederatedPrivateObjectPeerError{
				StatusCode: peerError.StatusCode,
				Cause:      err,
			}
		}

		return nil, err
	}

	return &application.FederatedPrivateObjectPeerResponse{
		StatusCode: response.StatusCode,
		Headers:    response.Headers,
		Body:       response.Body,
	}, nil
}

var _ application.FederatedPrivateObjectPeer = federatedPrivateObjectPeer{}
