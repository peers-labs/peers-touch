package conversation

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
)

const keypackageFederationScopeName = "keypackage.fetch"

type FederatedKeyPackageFetcher struct {
	client   *http.Client
	keyCache *authfed.KeyCache
	peerMap  map[string]string
}

func NewFederatedKeyPackageFetcher(keyCache *authfed.KeyCache) *FederatedKeyPackageFetcher {
	peerMap := parseFedPeerMap(os.Getenv("PEERS_FEDERATION_PEER_MAP"))
	return &FederatedKeyPackageFetcher{
		client:   &http.Client{Timeout: 10 * time.Second},
		keyCache: keyCache,
		peerMap:  peerMap,
	}
}

func parseFedPeerMap(raw string) map[string]string {
	m := make(map[string]string)
	for _, entry := range strings.Split(raw, ",") {
		parts := strings.SplitN(strings.TrimSpace(entry), "=", 2)
		if len(parts) == 2 && parts[0] != "" && parts[1] != "" {
			m[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
		}
	}
	return m
}

func (f *FederatedKeyPackageFetcher) FetchRemote(ctx context.Context, targetStationPeerID, ptid string) (*KeyPackage, error) {
	targetURL, ok := f.peerMap[targetStationPeerID]
	if !ok {
		return nil, fmt.Errorf("federated kp: unknown station %s", targetStationPeerID)
	}

	identity := nativefed.LocalIdentitySnapshot()
	issuer := identity.StationPeerID.String()
	if issuer == "" {
		issuer = identity.StationDomain
	}

	token, err := authfed.Mint(ctx, f.keyCache, authfed.MintRequest{
		Scope:    keypackageFederationScopeName,
		Issuer:   issuer,
		Audience: targetStationPeerID,
		Subject:  ptid,
	})
	if err != nil {
		return nil, fmt.Errorf("federated kp: mint token: %w", err)
	}

	body, _ := json.Marshal(map[string]string{"ptid": ptid})
	endpoint := strings.TrimRight(targetURL, "/") + "/key-exchange/mls/key-package/fetch"

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("federated kp: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := f.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("federated kp: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("federated kp: remote returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Data              []byte `json:"data"`
		Available         bool   `json:"available"`
		DeviceID          string `json:"device_id"`
		HomeStationPeerID string `json:"home_station_peer_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("federated kp: decode response: %w", err)
	}

	if !result.Available || result.Data == nil {
		return nil, nil
	}
	return &KeyPackage{
		Ptid:      ptid,
		DeviceID:  result.DeviceID,
		StationID: result.HomeStationPeerID,
		Data:      result.Data,
	}, nil
}
