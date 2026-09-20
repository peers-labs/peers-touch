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
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"google.golang.org/protobuf/proto"
)

const peerResponseLimit = 4 << 20

// PeerCall binds one protobuf peer query to its authenticated route contract.
type PeerCall struct {
	TargetStationPeerID string
	Route               PeerRoute
	Subject             string
	Claims              map[string]string
	PathParameters      map[string]string
	Request             proto.Message
	Response            proto.Message
}

// PeerStreamCall binds a raw or streaming body to one authenticated peer
// route. Domain metadata remains owned by the caller.
type PeerStreamCall struct {
	TargetStationPeerID string
	Route               PeerRoute
	Subject             string
	Claims              map[string]string
	PathParameters      map[string]string
	Headers             map[string]string
	Body                io.Reader
}

// PeerStreamResponse exposes a successful peer response without buffering its
// body. The caller owns Body and must close it.
type PeerStreamResponse struct {
	StatusCode int
	Headers    http.Header
	Body       io.ReadCloser
}

type peerClient struct {
	client             *http.Client
	keys               *authfed.KeyCache
	localStationPeerID string
	stationURLResolver StationURLResolver
	relay              RelayAccess
}

func newPeerClient(
	client *http.Client,
	keys *authfed.KeyCache,
	localStationPeerID string,
	resolver StationURLResolver,
	relay RelayAccess,
) (*peerClient, error) {
	if client == nil ||
		keys == nil ||
		strings.TrimSpace(localStationPeerID) == "" ||
		(resolver == nil && relay == nil) {
		return nil, delivery.NewError(
			delivery.FailureInvalidArgument,
			"create Federation peer client",
			errors.New("client, keys, local Station, and route source are required"),
		)
	}

	return &peerClient{
		client:             client,
		keys:               keys,
		localStationPeerID: localStationPeerID,
		stationURLResolver: resolver,
		relay:              relay,
	}, nil
}

func (c *peerClient) Call(ctx context.Context, call PeerCall) error {
	if ctx == nil ||
		strings.TrimSpace(call.TargetStationPeerID) == "" ||
		strings.TrimSpace(call.Subject) == "" ||
		call.Request == nil ||
		call.Response == nil {
		return delivery.NewError(
			delivery.FailureInvalidArgument,
			"call Federation peer",
			errors.New("peer call identity and protobuf messages are required"),
		)
	}
	body, err := proto.MarshalOptions{Deterministic: true}.Marshal(call.Request)
	if err != nil {
		return delivery.NewError(
			delivery.FailureInvalidFrame,
			"encode Federation peer request",
			err,
		)
	}
	response, err := c.Open(ctx, PeerStreamCall{
		TargetStationPeerID: call.TargetStationPeerID,
		Route:               call.Route,
		Subject:             call.Subject,
		Claims:              call.Claims,
		PathParameters:      call.PathParameters,
		Headers: map[string]string{
			"Accept":       "application/protobuf",
			"Content-Type": "application/protobuf",
		},
		Body: bytes.NewReader(body),
	})
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if contentType := response.Headers.Get("Content-Type"); !strings.HasPrefix(
		strings.ToLower(contentType),
		"application/protobuf",
	) {
		return delivery.NewError(
			delivery.FailureInvalidResult,
			"decode Federation peer response",
			fmt.Errorf("unexpected content type %q", contentType),
		)
	}
	responseBody, err := io.ReadAll(
		io.LimitReader(response.Body, peerResponseLimit+1),
	)
	if err != nil {
		return delivery.NewError(
			delivery.FailureTransportUnavailable,
			"read Federation peer response",
			err,
		)
	}
	if len(responseBody) > peerResponseLimit {
		return delivery.NewError(
			delivery.FailureInvalidResult,
			"decode Federation peer response",
			errors.New("protobuf response exceeds the configured limit"),
		)
	}
	if err := proto.Unmarshal(responseBody, call.Response); err != nil {
		return delivery.NewError(
			delivery.FailureInvalidResult,
			"decode Federation peer response",
			err,
		)
	}
	if len(call.Response.ProtoReflect().GetUnknown()) != 0 {
		return delivery.NewError(
			delivery.FailureInvalidResult,
			"decode Federation peer response",
			errors.New("response contains unknown fields"),
		)
	}

	return nil
}

// Open sends one authenticated peer request and returns a successful response
// stream. Authentication headers cannot be overridden by domain callers.
func (c *peerClient) Open(
	ctx context.Context,
	call PeerStreamCall,
) (*PeerStreamResponse, error) {
	if ctx == nil ||
		strings.TrimSpace(call.TargetStationPeerID) == "" ||
		strings.TrimSpace(call.Subject) == "" {
		return nil, delivery.NewError(
			delivery.FailureInvalidArgument,
			"open Federation peer stream",
			errors.New("peer call identity is required"),
		)
	}
	spec, ok := peerRouteSpecFor(call.Route)
	if !ok {
		return nil, delivery.NewError(
			delivery.FailureInvalidArgument,
			"open Federation peer stream",
			fmt.Errorf("unknown peer route %q", call.Route),
		)
	}
	routePath, err := bindPeerRoutePath(spec.path, call.PathParameters)
	if err != nil {
		return nil, err
	}
	claims := clonePeerClaims(call.Claims)
	token, err := authfed.Mint(ctx, c.keys, authfed.MintRequest{
		Scope:    spec.scope,
		Issuer:   c.localStationPeerID,
		Audience: call.TargetStationPeerID,
		Subject:  call.Subject,
		TTL:      time.Minute,
		Custom:   claims,
	})
	if err != nil {
		return nil, delivery.NewError(
			delivery.FailureUnauthenticated,
			"mint Federation peer token",
			err,
		)
	}
	endpoint, relayToken, viaRelay, err := c.resolveEndpoint(
		ctx,
		call.TargetStationPeerID,
		routePath,
	)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(
		ctx,
		string(spec.method),
		endpoint,
		call.Body,
	)
	if err != nil {
		return nil, delivery.NewError(
			delivery.FailureInvalidArgument,
			"build Federation peer request",
			err,
		)
	}
	for name, value := range call.Headers {
		if strings.EqualFold(name, "Authorization") ||
			strings.EqualFold(name, nativefed.ForwardAuthorizationHeader) {
			return nil, delivery.NewError(
				delivery.FailureInvalidArgument,
				"build Federation peer request",
				fmt.Errorf("reserved authentication header %q", name),
			)
		}
		request.Header.Set(name, value)
	}
	if viaRelay {
		request.Header.Set("Authorization", "Bearer "+relayToken)
		request.Header.Set(nativefed.ForwardAuthorizationHeader, "Bearer "+token)
	} else {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := c.client.Do(request)
	if err != nil {
		return nil, delivery.NewError(
			delivery.FailureTransportUnavailable,
			"send Federation peer request",
			err,
		)
	}
	if response.StatusCode < http.StatusOK ||
		response.StatusCode >= http.StatusMultipleChoices {
		// #region debug-point K:federated-attachment-error-body
		var diagnosticBody []byte
		if call.Route == PeerRouteConversationAttachmentObject {
			diagnosticBody, _ = io.ReadAll(io.LimitReader(response.Body, 1024))
		}
		// #endregion
		_, _ = io.Copy(
			io.Discard,
			io.LimitReader(
				response.Body,
				int64(peerResponseLimit)-int64(len(diagnosticBody)),
			),
		)
		_ = response.Body.Close()

		detail := fmt.Errorf("peer returned HTTP %d", response.StatusCode)
		// #region debug-point K:federated-attachment-error-body
		if call.Route == PeerRouteConversationAttachmentObject {
			detail = fmt.Errorf(
				"peer returned HTTP %d code=%q details=%q body=%s",
				response.StatusCode,
				response.Header.Get("X-Peers-Error-Code"),
				response.Header.Get("X-Peers-Error-Details"),
				strings.TrimSpace(string(diagnosticBody)),
			)
		}
		// #endregion
		return nil, delivery.NewError(
			delivery.FailureTransportUnavailable,
			"call Federation peer",
			detail,
		)
	}

	return &PeerStreamResponse{
		StatusCode: response.StatusCode,
		Headers:    response.Header.Clone(),
		Body:       response.Body,
	}, nil
}

func bindPeerRoutePath(
	template string,
	parameters map[string]string,
) (string, error) {
	segments := strings.Split(template, "/")
	used := make(map[string]struct{}, len(parameters))
	for index, segment := range segments {
		if !strings.HasPrefix(segment, ":") {
			continue
		}
		name := strings.TrimPrefix(segment, ":")
		value, ok := parameters[name]
		if !ok || strings.TrimSpace(value) == "" ||
			value != strings.TrimSpace(value) ||
			strings.Contains(value, "/") {
			return "", delivery.NewError(
				delivery.FailureInvalidArgument,
				"bind Federation peer route",
				fmt.Errorf("path parameter %q is missing or invalid", name),
			)
		}
		segments[index] = url.PathEscape(value)
		used[name] = struct{}{}
	}
	if len(used) != len(parameters) {
		return "", delivery.NewError(
			delivery.FailureInvalidArgument,
			"bind Federation peer route",
			errors.New("unexpected path parameter"),
		)
	}

	return strings.Join(segments, "/"), nil
}

func (c *peerClient) resolveEndpoint(
	ctx context.Context,
	targetStationPeerID string,
	routePath string,
) (endpoint string, relayToken string, viaRelay bool, err error) {
	if c.relay != nil {
		baseURL := strings.TrimRight(strings.TrimSpace(c.relay.BaseURL()), "/")
		token := strings.TrimSpace(c.relay.Token())
		if baseURL != "" && token != "" {
			return fmt.Sprintf(
				"%s/relay/forward/%s%s",
				baseURL,
				url.PathEscape(targetStationPeerID),
				routePath,
			), token, true, nil
		}
	}
	if c.stationURLResolver == nil {
		return "", "", false, delivery.NewError(
			delivery.FailureTransportUnavailable,
			"resolve Federation peer route",
			errors.New("no direct or relay route is available"),
		)
	}
	baseURL, err := c.stationURLResolver.ResolveActiveStationURL(
		ctx,
		targetStationPeerID,
	)
	if err != nil {
		return "", "", false, delivery.NewError(
			delivery.FailureTransportUnavailable,
			"resolve Federation peer route",
			err,
		)
	}
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return "", "", false, delivery.NewError(
			delivery.FailureTransportUnavailable,
			"resolve Federation peer route",
			errors.New("resolved Station URL is empty"),
		)
	}

	return baseURL + routePath, "", false, nil
}

func peerRouteSpecFor(route PeerRoute) (peerRouteSpec, bool) {
	for _, spec := range peerRouteSpecs {
		if spec.id == route {
			return spec, true
		}
	}

	return peerRouteSpec{}, false
}

func clonePeerClaims(claims map[string]string) map[string]string {
	if len(claims) == 0 {
		return nil
	}
	cloned := make(map[string]string, len(claims))
	for key, value := range claims {
		cloned[key] = value
	}

	return cloned
}
