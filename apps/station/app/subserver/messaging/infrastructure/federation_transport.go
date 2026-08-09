package infrastructure

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/worker"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/encoding/protojson"
)

type FederationTokenMinter interface {
	Mint(
		ctx context.Context,
		targetStationID string,
		frame *chat.MessagingFederationFrame,
	) (string, error)
}

type FederationStationURLResolver interface {
	ResolveActiveStationURL(context.Context, string) (string, error)
}

type FederationRelayAccess interface {
	BaseURL() string
	Token() string
}

type HTTPFederationTransport struct {
	client      *http.Client
	tokenMinter FederationTokenMinter
	resolver    FederationStationURLResolver
	relay       FederationRelayAccess
}

func NewHTTPFederationTransport(
	client *http.Client,
	tokenMinter FederationTokenMinter,
	resolver FederationStationURLResolver,
	relay FederationRelayAccess,
) (*HTTPFederationTransport, error) {
	if client == nil || tokenMinter == nil || (resolver == nil && relay == nil) {
		return nil, fmt.Errorf("messaging: federation transport dependencies are invalid")
	}
	return &HTTPFederationTransport{
		client:      client,
		tokenMinter: tokenMinter,
		resolver:    resolver,
		relay:       relay,
	}, nil
}

func (t *HTTPFederationTransport) Deliver(
	ctx context.Context,
	frame *chat.MessagingFederationFrame,
) worker.FederationDeliveryResult {
	if frame == nil || frame.TargetStationId == "" {
		return terminal("invalid_frame")
	}
	targetToken, err := t.tokenMinter.Mint(ctx, frame.TargetStationId, frame)
	if err != nil {
		return retryable("token_mint_failed")
	}
	body, err := protojson.Marshal(&chat.DeliverMessagingFederationFrameRequest{
		Frame: frame,
	})
	if err != nil {
		return terminal("frame_encode_failed")
	}
	endpoint, relayToken, viaRelay, err := t.resolveEndpoint(ctx, frame.TargetStationId)
	if err != nil {
		return retryable("route_unavailable")
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		endpoint,
		bytes.NewReader(body),
	)
	if err != nil {
		return terminal("request_build_failed")
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	if viaRelay {
		request.Header.Set("Authorization", "Bearer "+relayToken)
		request.Header.Set(nativefed.ForwardAuthorizationHeader, "Bearer "+targetToken)
	} else {
		request.Header.Set("Authorization", "Bearer "+targetToken)
	}
	response, err := t.client.Do(request)
	if err != nil {
		return retryable("network")
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 4096))
	if err != nil {
		return retryable("response_read")
	}
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		var decoded chat.DeliverMessagingFederationFrameResponse
		if err := protojson.Unmarshal(responseBody, &decoded); err != nil || !decoded.Accepted {
			return terminal("invalid_success_response")
		}
		return worker.FederationDeliveryResult{Delivered: true}
	}
	if response.StatusCode == http.StatusRequestTimeout ||
		response.StatusCode == http.StatusTooManyRequests ||
		response.StatusCode >= http.StatusInternalServerError {
		return retryable(fmt.Sprintf("http_%d", response.StatusCode))
	}
	var bodyError struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(responseBody, &bodyError)
	return terminal(fmt.Sprintf("http_%d", response.StatusCode))
}

func (t *HTTPFederationTransport) resolveEndpoint(
	ctx context.Context,
	targetStationID string,
) (endpoint string, relayToken string, viaRelay bool, err error) {
	if t.relay != nil {
		base := strings.TrimRight(strings.TrimSpace(t.relay.BaseURL()), "/")
		token := strings.TrimSpace(t.relay.Token())
		if base != "" && token != "" {
			return fmt.Sprintf(
				"%s/relay/forward/%s/messaging/federation/deliver",
				base,
				url.PathEscape(targetStationID),
			), token, true, nil
		}
	}
	if t.resolver == nil {
		return "", "", false, fmt.Errorf("messaging: no federation route")
	}
	base, err := t.resolver.ResolveActiveStationURL(ctx, targetStationID)
	if err != nil || strings.TrimSpace(base) == "" {
		return "", "", false, fmt.Errorf("messaging: no federation route")
	}
	return strings.TrimRight(base, "/") + "/messaging/federation/deliver", "", false, nil
}

func retryable(code string) worker.FederationDeliveryResult {
	return worker.FederationDeliveryResult{Retryable: true, ErrorCode: code}
}

func terminal(code string) worker.FederationDeliveryResult {
	return worker.FederationDeliveryResult{Retryable: false, ErrorCode: code}
}

var _ worker.FederationTransport = (*HTTPFederationTransport)(nil)
