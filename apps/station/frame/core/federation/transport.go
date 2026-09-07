package federation

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	federationmodel "github.com/peers-labs/peers-touch/station/frame/core/federation/model"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"google.golang.org/protobuf/proto"
)

const (
	deliveryTokenTTL       = time.Minute
	maxDeliveryResponseLen = 64 << 10
)

// StationURLResolver resolves a direct HTTP origin for a target Station.
type StationURLResolver interface {
	ResolveActiveStationURL(
		ctx context.Context,
		targetStationPeerID string,
	) (string, error)
}

// RelayAccess exposes the current relay endpoint and bearer without caching them.
type RelayAccess interface {
	BaseURL() string
	Token() string
}

// LiveRelayAccess reads the current native Federation relay client per delivery.
type LiveRelayAccess struct{}

// BaseURL returns the current relay origin.
func (LiveRelayAccess) BaseURL() string {
	client := nativefed.RelayClient()
	if client == nil {
		return ""
	}

	return client.BaseURL()
}

// Token returns the current relay bearer.
func (LiveRelayAccess) Token() string {
	client := nativefed.RelayClient()
	if client == nil {
		return ""
	}

	return client.Token()
}

type deliveryTokenMinter struct {
	keys                *authfed.KeyCache
	sourceStationPeerID string
}

func newDeliveryTokenMinter(
	keys *authfed.KeyCache,
	sourceStationPeerID string,
) (*deliveryTokenMinter, error) {
	if keys == nil || strings.TrimSpace(sourceStationPeerID) == "" {
		return nil, delivery.NewError(
			delivery.FailureInvalidArgument,
			"create Federation delivery token minter",
			errors.New("key cache and source Station are required"),
		)
	}

	return &deliveryTokenMinter{
		keys:                keys,
		sourceStationPeerID: sourceStationPeerID,
	}, nil
}

func (m *deliveryTokenMinter) Mint(
	ctx context.Context,
	frame *delivery.Frame,
) (string, error) {
	if frame == nil ||
		frame.GetSourceStationPeerId() != m.sourceStationPeerID ||
		strings.TrimSpace(frame.GetTargetStationPeerId()) == "" ||
		strings.TrimSpace(frame.GetFrameId()) == "" ||
		strings.TrimSpace(frame.GetIdempotencyKey()) == "" {
		return "", delivery.NewError(
			delivery.FailureInvalidFrame,
			"mint Federation delivery token",
			errors.New("frame identity is incomplete"),
		)
	}

	token, err := authfed.Mint(ctx, m.keys, authfed.MintRequest{
		Scope:    DeliveryScope,
		Issuer:   m.sourceStationPeerID,
		Audience: frame.GetTargetStationPeerId(),
		Subject:  m.sourceStationPeerID,
		TTL:      deliveryTokenTTL,
		Custom: map[string]string{
			ClaimFrameID:             frame.GetFrameId(),
			ClaimIdempotencyKey:      frame.GetIdempotencyKey(),
			ClaimSourceStationPeerID: frame.GetSourceStationPeerId(),
			ClaimTargetStationPeerID: frame.GetTargetStationPeerId(),
		},
	})
	if err != nil {
		return "", delivery.NewError(
			delivery.FailureUnauthenticated,
			"mint Federation delivery token",
			err,
		)
	}

	return token, nil
}

// HTTPTransport sends canonical Federation frames directly or through Relay.
type HTTPTransport struct {
	client   *http.Client
	minter   *deliveryTokenMinter
	resolver StationURLResolver
	relay    RelayAccess
}

// NewHTTPTransport creates the production remote delivery adapter.
func NewHTTPTransport(
	client *http.Client,
	keys *authfed.KeyCache,
	sourceStationPeerID string,
	resolver StationURLResolver,
	relay RelayAccess,
) (*HTTPTransport, error) {
	if client == nil || (resolver == nil && relay == nil) {
		return nil, delivery.NewError(
			delivery.FailureInvalidArgument,
			"create Federation HTTP transport",
			errors.New("HTTP client and at least one route source are required"),
		)
	}
	minter, err := newDeliveryTokenMinter(keys, sourceStationPeerID)
	if err != nil {
		return nil, err
	}

	return &HTTPTransport{
		client:   client,
		minter:   minter,
		resolver: resolver,
		relay:    relay,
	}, nil
}

// Deliver sends one immutable frame and decodes its typed receiver disposition.
func (t *HTTPTransport) Deliver(
	ctx context.Context,
	frame *delivery.Frame,
) (delivery.Result, error) {
	if frame == nil {
		return delivery.Result{}, delivery.NewError(
			delivery.FailureInvalidFrame,
			"deliver Federation frame",
			errors.New("frame is nil"),
		)
	}
	token, err := t.minter.Mint(ctx, frame)
	if err != nil {
		return delivery.Result{}, err
	}
	body, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&federationmodel.DeliverFederatedDomainFrameRequest{Frame: frame},
	)
	if err != nil {
		return delivery.Result{}, delivery.NewError(
			delivery.FailureInvalidFrame,
			"encode Federation delivery request",
			err,
		)
	}
	endpoint, relayToken, viaRelay, err := t.resolveEndpoint(
		ctx,
		frame.GetTargetStationPeerId(),
	)
	if err != nil {
		return delivery.Result{}, err
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		endpoint,
		bytes.NewReader(body),
	)
	if err != nil {
		return delivery.Result{}, delivery.NewError(
			delivery.FailureInvalidArgument,
			"build Federation delivery request",
			err,
		)
	}
	request.Header.Set("Content-Type", "application/protobuf")
	request.Header.Set("Accept", "application/protobuf")
	if viaRelay {
		request.Header.Set("Authorization", "Bearer "+relayToken)
		request.Header.Set(nativefed.ForwardAuthorizationHeader, "Bearer "+token)
	} else {
		request.Header.Set("Authorization", "Bearer "+token)
	}

	response, err := t.client.Do(request)
	if err != nil {
		return delivery.Result{}, delivery.NewError(
			delivery.FailureTransportUnavailable,
			"send Federation delivery request",
			err,
		)
	}
	defer response.Body.Close()

	responseBody, err := io.ReadAll(io.LimitReader(response.Body, maxDeliveryResponseLen))
	if err != nil {
		return delivery.Result{}, delivery.NewError(
			delivery.FailureTransportUnavailable,
			"read Federation delivery response",
			err,
		)
	}
	if response.StatusCode < http.StatusOK ||
		response.StatusCode >= http.StatusMultipleChoices {
		switch response.StatusCode {
		case http.StatusBadRequest:
			return delivery.TerminalResult(delivery.FrameErrorInvalidFrame), nil
		case http.StatusUnauthorized, http.StatusForbidden:
			return delivery.TerminalResult(delivery.FrameErrorUnauthenticated), nil
		case http.StatusConflict:
			return delivery.PayloadHashConflictResult(), nil
		case http.StatusRequestTimeout,
			http.StatusTooManyRequests,
			http.StatusBadGateway,
			http.StatusServiceUnavailable,
			http.StatusGatewayTimeout:
			return delivery.Result{}, delivery.NewError(
				delivery.FailureTransportUnavailable,
				"deliver Federation frame",
				fmt.Errorf("peer returned retryable HTTP %d", response.StatusCode),
			)
		default:
			if response.StatusCode >= http.StatusInternalServerError {
				return delivery.Result{}, delivery.NewError(
					delivery.FailureTransportUnavailable,
					"deliver Federation frame",
					fmt.Errorf("peer returned retryable HTTP %d", response.StatusCode),
				)
			}
			return delivery.TerminalResult(delivery.FrameErrorDomainRejected), nil
		}
	}

	var decoded federationmodel.DeliverFederatedDomainFrameResponse
	if err := proto.Unmarshal(responseBody, &decoded); err != nil {
		return delivery.Result{}, delivery.NewError(
			delivery.FailureInvalidResult,
			"decode Federation delivery response",
			err,
		)
	}
	if len(decoded.ProtoReflect().GetUnknown()) != 0 {
		return delivery.Result{}, delivery.NewError(
			delivery.FailureInvalidResult,
			"decode Federation delivery response",
			errors.New("response contains unknown fields"),
		)
	}

	return delivery.Result{
		Disposition: decoded.GetDisposition(),
		ErrorCode:   decoded.GetErrorCode(),
	}, nil
}

func (t *HTTPTransport) resolveEndpoint(
	ctx context.Context,
	targetStationPeerID string,
) (endpoint string, relayToken string, viaRelay bool, err error) {
	if t.relay != nil {
		baseURL := strings.TrimRight(strings.TrimSpace(t.relay.BaseURL()), "/")
		token := strings.TrimSpace(t.relay.Token())
		if baseURL != "" && token != "" {
			return fmt.Sprintf(
				"%s/relay/forward/%s%s",
				baseURL,
				url.PathEscape(targetStationPeerID),
				DeliveryRoute,
			), token, true, nil
		}
	}
	if t.resolver == nil {
		return "", "", false, delivery.NewError(
			delivery.FailureTransportUnavailable,
			"resolve Federation delivery route",
			errors.New("no direct or relay route is available"),
		)
	}
	baseURL, err := t.resolver.ResolveActiveStationURL(ctx, targetStationPeerID)
	if err != nil {
		return "", "", false, delivery.NewError(
			delivery.FailureTransportUnavailable,
			"resolve Federation delivery route",
			err,
		)
	}
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return "", "", false, delivery.NewError(
			delivery.FailureTransportUnavailable,
			"resolve Federation delivery route",
			errors.New("resolved Station URL is empty"),
		)
	}

	return baseURL + DeliveryRoute, "", false, nil
}

type routedTransport struct {
	localStationPeerID string
	local              delivery.Transport
	remote             delivery.Transport
}

func (t *routedTransport) Deliver(
	ctx context.Context,
	frame *delivery.Frame,
) (delivery.Result, error) {
	if frame == nil {
		return delivery.Result{}, delivery.NewError(
			delivery.FailureInvalidFrame,
			"route Federation frame",
			errors.New("frame is nil"),
		)
	}
	if frame.GetTargetStationPeerId() == t.localStationPeerID {
		return t.local.Deliver(ctx, frame)
	}

	return t.remote.Deliver(ctx, frame)
}

var (
	_ RelayAccess        = LiveRelayAccess{}
	_ delivery.Transport = (*HTTPTransport)(nil)
	_ delivery.Transport = (*routedTransport)(nil)
)
