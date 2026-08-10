package infrastructure

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/encoding/protojson"
)

type AuthorityPrepareTokenMinter interface {
	MintAuthorityPrepare(
		ctx context.Context,
		targetStationID string,
		conversationID string,
	) (string, error)
}

type HTTPAuthorityPrepareFetcher struct {
	client       *http.Client
	tokenMinter  AuthorityPrepareTokenMinter
	resolver     FederationStationURLResolver
	relay        FederationRelayAccess
	localStation string
}

func NewHTTPAuthorityPrepareFetcher(
	client *http.Client,
	tokenMinter AuthorityPrepareTokenMinter,
	resolver FederationStationURLResolver,
	relay FederationRelayAccess,
	localStation string,
) (*HTTPAuthorityPrepareFetcher, error) {
	if client == nil ||
		tokenMinter == nil ||
		(resolver == nil && relay == nil) ||
		localStation == "" {
		return nil, fmt.Errorf("messaging: authority prepare fetcher dependencies are invalid")
	}
	return &HTTPAuthorityPrepareFetcher{
		client:       client,
		tokenMinter:  tokenMinter,
		resolver:     resolver,
		relay:        relay,
		localStation: localStation,
	}, nil
}

func (f *HTTPAuthorityPrepareFetcher) PrepareSend(
	ctx context.Context,
	request *chat.PrepareMessagingSendRequest,
) (*chat.PrepareMessagingSendResponse, error) {
	if request == nil ||
		request.ConversationId == "" ||
		request.AuthorityStationId == "" ||
		request.AuthorityStationId == f.localStation {
		return nil, fmt.Errorf("messaging: remote authority prepare request is invalid")
	}
	token, err := f.tokenMinter.MintAuthorityPrepare(
		ctx,
		request.AuthorityStationId,
		request.ConversationId,
	)
	if err != nil {
		return nil, err
	}
	body, err := protojson.Marshal(&chat.FederatedPrepareMessagingSendRequest{
		Request:             request,
		SourceHomeStationId: f.localStation,
	})
	if err != nil {
		return nil, err
	}
	endpoint, relayToken, viaRelay, err := f.resolveEndpoint(
		ctx,
		request.AuthorityStationId,
	)
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
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Accept", "application/json")
	if viaRelay {
		httpRequest.Header.Set("Authorization", "Bearer "+relayToken)
		httpRequest.Header.Set(nativefed.ForwardAuthorizationHeader, "Bearer "+token)
	} else {
		httpRequest.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := f.client.Do(httpRequest)
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
			"messaging: authority prepare status %d: %s",
			response.StatusCode,
			strings.TrimSpace(string(responseBody)),
		)
	}
	result := &chat.PrepareMessagingSendResponse{}
	if err := protojson.Unmarshal(responseBody, result); err != nil {
		return nil, err
	}
	if result.ConversationId != request.ConversationId ||
		result.AuthorityStationId != request.AuthorityStationId {
		return nil, fmt.Errorf("messaging: authority prepare response binding mismatch")
	}
	return result, nil
}

func (f *HTTPAuthorityPrepareFetcher) resolveEndpoint(
	ctx context.Context,
	targetStationID string,
) (endpoint string, relayToken string, viaRelay bool, err error) {
	if f.relay != nil {
		base := strings.TrimRight(strings.TrimSpace(f.relay.BaseURL()), "/")
		token := strings.TrimSpace(f.relay.Token())
		if base != "" && token != "" {
			return fmt.Sprintf(
				"%s/relay/forward/%s/messaging/federation/command/prepare",
				base,
				url.PathEscape(targetStationID),
			), token, true, nil
		}
	}
	if f.resolver == nil {
		return "", "", false, fmt.Errorf("messaging: authority prepare route unavailable")
	}
	base, err := f.resolver.ResolveActiveStationURL(ctx, targetStationID)
	if err != nil || strings.TrimSpace(base) == "" {
		return "", "", false, fmt.Errorf("messaging: authority prepare route unavailable")
	}
	return strings.TrimRight(base, "/") +
		"/messaging/federation/command/prepare", "", false, nil
}
