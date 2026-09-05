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
	"google.golang.org/protobuf/proto"
)

type FollowerReplayTokenMinter interface {
	MintFollowerReplayRead(
		ctx context.Context,
		targetStationID string,
		request *chat.GetMessagingFollowerEventsRequest,
	) (string, error)
}

type HTTPFollowerReplayClient struct {
	client       *http.Client
	tokenMinter  FollowerReplayTokenMinter
	resolver     FederationStationURLResolver
	relay        FederationRelayAccess
	peerKeys     authfed.PeerKeyStore
	localStation string
	clock        func() time.Time
}

func NewHTTPFollowerReplayClient(
	client *http.Client,
	tokenMinter FollowerReplayTokenMinter,
	resolver FederationStationURLResolver,
	relay FederationRelayAccess,
	peerKeys authfed.PeerKeyStore,
	localStation string,
	clock func() time.Time,
) (*HTTPFollowerReplayClient, error) {
	if client == nil ||
		tokenMinter == nil ||
		(resolver == nil && relay == nil) ||
		peerKeys == nil ||
		localStation == "" ||
		clock == nil {
		return nil, fmt.Errorf("messaging: follower replay client dependencies are invalid")
	}
	return &HTTPFollowerReplayClient{
		client:       client,
		tokenMinter:  tokenMinter,
		resolver:     resolver,
		relay:        relay,
		peerKeys:     peerKeys,
		localStation: localStation,
		clock:        clock,
	}, nil
}

func (c *HTTPFollowerReplayClient) FetchFollowerEvents(
	ctx context.Context,
	authorityStationID string,
	expectedSigningKeyID string,
	request *chat.GetMessagingFollowerEventsRequest,
) (*chat.MessagingFollowerEventsPage, error) {
	if request == nil ||
		authorityStationID == "" ||
		expectedSigningKeyID == "" ||
		request.AuthorityStationId != authorityStationID ||
		request.TargetHomeStationId != c.localStation {
		return nil, messaging.ErrFollowerReplayInvalid
	}
	token, err := c.tokenMinter.MintFollowerReplayRead(
		ctx,
		authorityStationID,
		request,
	)
	if err != nil {
		return nil, err
	}
	body, err := proto.MarshalOptions{Deterministic: true}.Marshal(request)
	if err != nil {
		return nil, err
	}
	endpoint, relayToken, viaRelay, err := c.resolveEndpoint(ctx, authorityStationID)
	if err != nil {
		return nil, err
	}
	httpRequest, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		endpoint,
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	httpRequest.Header.Set("Content-Type", "application/protobuf")
	httpRequest.Header.Set("Accept", "application/protobuf")
	if viaRelay {
		httpRequest.Header.Set("Authorization", "Bearer "+relayToken)
		httpRequest.Header.Set(nativefed.ForwardAuthorizationHeader, "Bearer "+token)
	} else {
		httpRequest.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := c.client.Do(httpRequest)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	switch response.StatusCode {
	case http.StatusOK:
	case http.StatusForbidden:
		return nil, messaging.ErrFollowerReplayNotGranted
	case http.StatusGone:
		return nil, messaging.ErrFollowerReplayUnavailable
	case http.StatusBadRequest, http.StatusConflict:
		return nil, messaging.ErrFollowerReplayInvalid
	default:
		return nil, fmt.Errorf(
			"messaging: follower replay status %d",
			response.StatusCode,
		)
	}
	page := &chat.MessagingFollowerEventsPage{}
	if err := proto.Unmarshal(responseBody, page); err != nil {
		return nil, messaging.ErrFollowerReplayInvalid
	}
	peerKey, err := c.peerKeys.Get(ctx, authorityStationID)
	if err != nil {
		return nil, err
	}
	if peerKey == nil || peerKey.Kid != expectedSigningKeyID {
		return nil, messaging.ErrFollowerReplayInvalid
	}
	publicKey, keyID, err := authfed.ParsePeerJWKPEM(peerKey.PubPEM)
	if err != nil || keyID != expectedSigningKeyID {
		return nil, messaging.ErrFollowerReplayInvalid
	}
	if err := application.VerifyFollowerEventsPage(
		request,
		page,
		authorityStationID,
		c.localStation,
		expectedSigningKeyID,
		publicKey,
		c.clock().UTC(),
	); err != nil {
		return nil, err
	}
	return page, nil
}

func (c *HTTPFollowerReplayClient) resolveEndpoint(
	ctx context.Context,
	targetStationID string,
) (endpoint string, relayToken string, viaRelay bool, err error) {
	if c.relay != nil {
		base := strings.TrimRight(strings.TrimSpace(c.relay.BaseURL()), "/")
		token := strings.TrimSpace(c.relay.Token())
		if base != "" && token != "" {
			return fmt.Sprintf(
				"%s/relay/forward/%s/messaging/federation/follower/events",
				base,
				url.PathEscape(targetStationID),
			), token, true, nil
		}
	}
	if c.resolver == nil {
		return "", "", false, fmt.Errorf("messaging: follower replay route unavailable")
	}
	base, err := c.resolver.ResolveActiveStationURL(ctx, targetStationID)
	if err != nil || strings.TrimSpace(base) == "" {
		return "", "", false, fmt.Errorf("messaging: follower replay route unavailable")
	}
	return strings.TrimRight(base, "/") +
		"/messaging/federation/follower/events", "", false, nil
}

var _ messaging.FollowerReplayClient = (*HTTPFollowerReplayClient)(nil)
