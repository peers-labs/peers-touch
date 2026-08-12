package infrastructure

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/encoding/protojson"
)

type EndpointManifestTokenMinter interface {
	MintEndpointManifestRead(
		ctx context.Context,
		targetStationID string,
		actorPTID string,
	) (string, error)
}

type HTTPFederatedEndpointManifestFetcher struct {
	client      *http.Client
	tokenMinter EndpointManifestTokenMinter
	resolver    FederationStationURLResolver
	relay       FederationRelayAccess
	peerKeys    authfed.PeerKeyStore
	repository  messaging.EndpointManifestRepository
	clock       func() time.Time
}

func NewHTTPFederatedEndpointManifestFetcher(
	client *http.Client,
	tokenMinter EndpointManifestTokenMinter,
	resolver FederationStationURLResolver,
	relay FederationRelayAccess,
	peerKeys authfed.PeerKeyStore,
	repository messaging.EndpointManifestRepository,
	clock func() time.Time,
) (*HTTPFederatedEndpointManifestFetcher, error) {
	if client == nil ||
		tokenMinter == nil ||
		(resolver == nil && relay == nil) ||
		peerKeys == nil ||
		repository == nil ||
		clock == nil {
		return nil, fmt.Errorf("messaging: endpoint manifest fetcher dependencies are invalid")
	}
	return &HTTPFederatedEndpointManifestFetcher{
		client:      client,
		tokenMinter: tokenMinter,
		resolver:    resolver,
		relay:       relay,
		peerKeys:    peerKeys,
		repository:  repository,
		clock:       clock,
	}, nil
}

func (f *HTTPFederatedEndpointManifestFetcher) FetchEndpointManifest(
	ctx context.Context,
	homeStationID string,
	actorPTID string,
) (*chat.FederatedEndpointManifest, error) {
	if homeStationID == "" || actorPTID == "" {
		return nil, messaging.ErrEndpointManifestInvalid
	}
	token, err := f.tokenMinter.MintEndpointManifestRead(
		ctx,
		homeStationID,
		actorPTID,
	)
	if err != nil {
		return nil, err
	}
	body, err := protojson.Marshal(&chat.GetFederatedEndpointManifestRequest{
		ActorPtid: actorPTID,
	})
	if err != nil {
		return nil, err
	}
	endpoint, relayToken, viaRelay, err := f.resolveEndpoint(ctx, homeStationID)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		endpoint,
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	if viaRelay {
		request.Header.Set("Authorization", "Bearer "+relayToken)
		request.Header.Set(nativefed.ForwardAuthorizationHeader, "Bearer "+token)
	} else {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := f.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf(
			"messaging: endpoint manifest fetch status %d: %s",
			response.StatusCode,
			strings.TrimSpace(string(responseBody)),
		)
	}
	result := &chat.GetFederatedEndpointManifestResponse{}
	if err := protojson.Unmarshal(responseBody, result); err != nil {
		return nil, err
	}
	manifest := result.Manifest
	peerKey, err := f.peerKeys.Get(ctx, homeStationID)
	if err != nil {
		return nil, err
	}
	if peerKey == nil {
		return nil, messaging.ErrEndpointManifestSignature
	}
	publicKey, keyID, err := authfed.ParsePeerJWKPEM(peerKey.PubPEM)
	if err != nil || keyID != peerKey.Kid {
		return nil, messaging.ErrEndpointManifestSignature
	}
	if err := application.VerifyEndpointManifest(
		manifest,
		actorPTID,
		homeStationID,
		peerKey.Kid,
		publicKey,
		f.clock().UTC(),
	); err != nil {
		return nil, err
	}
	manifestBytes, manifestHash, err := application.EndpointManifestSHA256(manifest)
	if err != nil {
		return nil, err
	}
	if err := f.repository.SaveVerifiedManifest(
		ctx,
		manifest,
		manifestBytes,
		manifestHash,
	); err != nil {
		return nil, err
	}
	return manifest, nil
}

func (f *HTTPFederatedEndpointManifestFetcher) resolveEndpoint(
	ctx context.Context,
	targetStationID string,
) (endpoint string, relayToken string, viaRelay bool, err error) {
	if f.relay != nil {
		base := strings.TrimRight(strings.TrimSpace(f.relay.BaseURL()), "/")
		token := strings.TrimSpace(f.relay.Token())
		if base != "" && token != "" {
			return fmt.Sprintf(
				"%s/relay/forward/%s/messaging/federation/endpoint-manifest",
				base,
				url.PathEscape(targetStationID),
			), token, true, nil
		}
	}
	if f.resolver == nil {
		return "", "", false, fmt.Errorf("messaging: endpoint manifest route unavailable")
	}
	base, err := f.resolver.ResolveActiveStationURL(ctx, targetStationID)
	if err != nil || strings.TrimSpace(base) == "" {
		return "", "", false, fmt.Errorf("messaging: endpoint manifest route unavailable")
	}
	return strings.TrimRight(base, "/") +
		"/messaging/federation/endpoint-manifest", "", false, nil
}

var _ messaging.RemoteEndpointManifestFetcher = (*HTTPFederatedEndpointManifestFetcher)(nil)
