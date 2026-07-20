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
)

type HTTPFederationTransport struct {
	client   *http.Client
	keyCache *authfed.KeyCache
	peerMap  map[string]string
}

func NewHTTPFederationTransport(keyCache *authfed.KeyCache) *HTTPFederationTransport {
	peerMap := parsePeerMap(os.Getenv("PEERS_FEDERATION_PEER_MAP"))
	return &HTTPFederationTransport{
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
		keyCache: keyCache,
		peerMap:  peerMap,
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
	targetURL, ok := t.peerMap[targetStationPeerID]
	if !ok {
		return fmt.Errorf("federation: unknown target station %s", targetStationPeerID)
	}

	token, err := t.mintFederationToken(ctx, targetStationPeerID, env)
	if err != nil {
		return fmt.Errorf("federation: mint token: %w", err)
	}

	body, err := json.Marshal(map[string]any{
		"envelope": env,
	})
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

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	return fmt.Errorf("federation: target rejected (status %d): %s", resp.StatusCode, string(respBody))
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
		Subject:  env.SenderActorDid,
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
