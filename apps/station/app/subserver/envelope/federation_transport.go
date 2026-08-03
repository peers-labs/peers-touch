package envelope

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/encoding/protojson"
	"gorm.io/gorm"
)

type StationURLResolver interface {
	ResolveActiveStationURL(context.Context, string) (string, error)
}

type HTTPFederationTransport struct {
	client      *http.Client
	keyCache    *authfed.KeyCache
	peerMap     map[string]string
	urlResolver StationURLResolver
}

func NewHTTPFederationTransport(
	keyCache *authfed.KeyCache,
	resolvers ...StationURLResolver,
) *HTTPFederationTransport {
	peerMap := parsePeerMap(os.Getenv("PEERS_FEDERATION_PEER_MAP"))
	var urlResolver StationURLResolver
	if len(resolvers) > 0 {
		urlResolver = resolvers[0]
	}
	return &HTTPFederationTransport{
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
		keyCache:    keyCache,
		peerMap:     peerMap,
		urlResolver: urlResolver,
	}
}

func parsePeerMap(raw string) map[string]string {
	m := make(map[string]string)
	for _, entry := range strings.Split(raw, ",") {
		parts := strings.SplitN(strings.TrimSpace(entry), "=", 2)
		if len(parts) == 2 && parts[0] != "" && parts[1] != "" {
			m[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
		}
	}
	return m
}

func (t *HTTPFederationTransport) Forward(ctx context.Context, targetStationPeerID string, env *chat.StationEnvelope) error {
	targetURL := ""
	if t.urlResolver != nil {
		resolvedURL, err := t.urlResolver.ResolveActiveStationURL(ctx, targetStationPeerID)
		if err != nil {
			return fmt.Errorf("federation: resolve target station %s: %w", targetStationPeerID, err)
		}
		targetURL = resolvedURL
	}
	if targetURL == "" {
		targetURL = t.peerMap[targetStationPeerID]
	}
	if targetURL == "" {
		return fmt.Errorf("federation: unknown target station %s", targetStationPeerID)
	}

	token, err := t.mintFederationToken(ctx, targetStationPeerID, env)
	if err != nil {
		return fmt.Errorf("federation: mint token: %w", err)
	}

	body, err := marshalFederationDelivery(env)
	if err != nil {
		return fmt.Errorf("federation: marshal envelope: %w", err)
	}

	endpoint := strings.TrimRight(targetURL, "/") + "/envelope/federation/deliver"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("federation: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := t.client.Do(req)
	if err != nil {
		return fmt.Errorf("federation: send request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		return fmt.Errorf("federation: read target response: %w", err)
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 &&
		!federationResponseFailed(respBody) {
		return nil
	}

	return fmt.Errorf("federation: target rejected (status %d): %s", resp.StatusCode, string(respBody))
}

func marshalFederationDelivery(env *chat.StationEnvelope) ([]byte, error) {
	return protojson.Marshal(&chat.FederationDeliverEnvelopeRequest{
		Envelope: env,
	})
}

func federationResponseFailed(body []byte) bool {
	if len(bytes.TrimSpace(body)) == 0 {
		return false
	}
	var response struct {
		Error string `json:"error"`
	}
	return json.Unmarshal(body, &response) == nil && response.Error != ""
}

type GORMStationURLResolver struct {
	db *gorm.DB
}

func NewGORMStationURLResolver(db *gorm.DB) *GORMStationURLResolver {
	return &GORMStationURLResolver{db: db}
}

type stationMembershipRoute struct {
	StationURL string `gorm:"column:station_url"`
}

func (stationMembershipRoute) TableName() string {
	return "federation_station_membership"
}

func (r *GORMStationURLResolver) ResolveActiveStationURL(
	ctx context.Context,
	stationPeerID string,
) (string, error) {
	var memberships []stationMembershipRoute
	if err := r.db.WithContext(ctx).
		Where(
			"station_peer_id = ? AND status = ? AND station_url <> ''",
			stationPeerID,
			"active",
		).
		Find(&memberships).Error; err != nil {
		return "", err
	}
	urls := make(map[string]bool, len(memberships))
	for _, membership := range memberships {
		urls[strings.TrimRight(strings.TrimSpace(membership.StationURL), "/")] = true
	}
	delete(urls, "")
	if len(urls) == 0 {
		return "", nil
	}
	if len(urls) > 1 {
		return "", fmt.Errorf("conflicting durable Station URLs")
	}
	for stationURL := range urls {
		return stationURL, nil
	}
	return "", nil
}

func (t *HTTPFederationTransport) mintFederationToken(ctx context.Context, targetPeerID string, env *chat.StationEnvelope) (string, error) {
	identity := nativefed.LocalIdentitySnapshot()
	issuer := identity.StationPeerID.String()
	if issuer == "" {
		issuer = identity.StationDomain
	}

	mintReq := authfed.MintRequest{
		Scope:    envelopeFederationScopeName,
		Audience: targetPeerID,
		Issuer:   issuer,
		Subject:  env.SenderPtid,
		Custom: map[string]string{
			"conversation_id": env.ConversationId,
			"idempotency_key": env.IdempotencyKey,
		},
	}

	token, err := authfed.Mint(ctx, t.keyCache, mintReq)
	if err != nil {
		return "", err
	}
	return token, nil
}
