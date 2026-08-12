package infrastructure

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

type AttachmentTransferTokenMinter interface {
	MintAttachmentTransfer(
		ctx context.Context,
		targetStationID string,
		conversationID string,
		endpoint *chat.CryptoEndpoint,
		action string,
		resourceID string,
	) (string, error)
}

type AttachmentProxyRequest struct {
	TargetStationID string
	ConversationID  string
	Endpoint        *chat.CryptoEndpoint
	Action          string
	ResourceID      string
	Method          string
	Route           string
	Header          http.Header
	Body            io.Reader
}

type HTTPAttachmentProxy struct {
	client      *http.Client
	tokenMinter AttachmentTransferTokenMinter
	resolver    FederationStationURLResolver
	relay       FederationRelayAccess
}

func NewHTTPAttachmentProxy(
	client *http.Client,
	tokenMinter AttachmentTransferTokenMinter,
	resolver FederationStationURLResolver,
	relay FederationRelayAccess,
) (*HTTPAttachmentProxy, error) {
	if client == nil || tokenMinter == nil || (resolver == nil && relay == nil) {
		return nil, fmt.Errorf("messaging: attachment proxy dependencies are invalid")
	}
	return &HTTPAttachmentProxy{
		client:      client,
		tokenMinter: tokenMinter,
		resolver:    resolver,
		relay:       relay,
	}, nil
}

func (p *HTTPAttachmentProxy) Forward(
	ctx context.Context,
	input AttachmentProxyRequest,
) (*http.Response, error) {
	if input.TargetStationID == "" ||
		input.ConversationID == "" ||
		input.Endpoint == nil ||
		input.Action == "" ||
		input.ResourceID == "" ||
		input.Method == "" ||
		!strings.HasPrefix(input.Route, "/messaging/federation/attachments/") {
		return nil, fmt.Errorf("messaging: attachment proxy request is invalid")
	}
	token, err := p.tokenMinter.MintAttachmentTransfer(
		ctx,
		input.TargetStationID,
		input.ConversationID,
		input.Endpoint,
		input.Action,
		input.ResourceID,
	)
	if err != nil {
		return nil, err
	}
	endpoint, relayToken, viaRelay, err := p.resolveEndpoint(
		ctx,
		input.TargetStationID,
		input.Route,
	)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(
		ctx,
		input.Method,
		endpoint,
		input.Body,
	)
	if err != nil {
		return nil, err
	}
	for _, name := range []string{
		"Accept",
		"Content-Type",
		"Content-Length",
		"Range",
		"If-Match",
		"X-Peers-Attachment-Generation",
		"X-Peers-Attachment-Metadata-Bin",
		"X-Peers-Conversation-ID",
	} {
		if value := input.Header.Get(name); value != "" {
			request.Header.Set(name, value)
		}
	}
	if viaRelay {
		request.Header.Set("Authorization", "Bearer "+relayToken)
		request.Header.Set(nativefed.ForwardAuthorizationHeader, "Bearer "+token)
	} else {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	return p.client.Do(request)
}

func (p *HTTPAttachmentProxy) resolveEndpoint(
	ctx context.Context,
	targetStationID string,
	route string,
) (endpoint string, relayToken string, viaRelay bool, err error) {
	if p.relay != nil {
		base := strings.TrimRight(strings.TrimSpace(p.relay.BaseURL()), "/")
		token := strings.TrimSpace(p.relay.Token())
		if base != "" && token != "" {
			return fmt.Sprintf(
				"%s/relay/forward/%s%s",
				base,
				url.PathEscape(targetStationID),
				route,
			), token, true, nil
		}
	}
	if p.resolver == nil {
		return "", "", false, fmt.Errorf("messaging: attachment authority route unavailable")
	}
	base, err := p.resolver.ResolveActiveStationURL(ctx, targetStationID)
	if err != nil || strings.TrimSpace(base) == "" {
		return "", "", false, fmt.Errorf("messaging: attachment authority route unavailable")
	}
	return strings.TrimRight(base, "/") + route, "", false, nil
}
