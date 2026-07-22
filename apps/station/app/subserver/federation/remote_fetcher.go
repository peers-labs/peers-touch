package federation

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"time"

	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"google.golang.org/protobuf/encoding/protojson"
)

const FederationGovernanceSyncScope = "federation-governance-sync"

type httpLedgerFetcher struct {
	client         *http.Client
	fedCache       *federation.KeyCache
	localStationFn func() string
}

func NewHTTPLedgerFetcher(fedCache *federation.KeyCache, localStationFn func() string) RemoteLedgerFetcher {
	return &httpLedgerFetcher{
		client:         &http.Client{Timeout: 10 * time.Second},
		fedCache:       fedCache,
		localStationFn: localStationFn,
	}
}

func (f *httpLedgerFetcher) mintToken(ctx context.Context, targetStationID string) (string, error) {
	localID := f.localStationFn()
	if localID == "" {
		return "", fmt.Errorf("local station ID not available")
	}
	return federation.Mint(ctx, f.fedCache, federation.MintRequest{
		Scope:    FederationGovernanceSyncScope,
		Issuer:   localID,
		Audience: targetStationID,
		Subject:  localID,
	})
}

func (f *httpLedgerFetcher) FetchHead(ctx context.Context, endpoint string, federationID string) ([]byte, uint64, error) {
	req := &pb.FetchHeadRequest{FederationId: federationID}
	body, err := protojson.Marshal(req)
	if err != nil {
		return nil, 0, err
	}

	url := endpoint + "/fed/v1/ledger/head"

	targetStationID := extractStationID(endpoint)
	token, err := f.mintToken(ctx, targetStationID)
	if err != nil {
		return nil, 0, fmt.Errorf("mint federation token for %s: %w", url, err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+token)

	resp, err := f.client.Do(httpReq)
	if err != nil {
		return nil, 0, fmt.Errorf("http request to %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, 0, fmt.Errorf("fetch head %s returned %d: %s", url, resp.StatusCode, string(respBody))
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, 0, fmt.Errorf("read fetch head response: %w", err)
	}

	var result pb.FetchHeadResponse
	if err := protojson.Unmarshal(respBody, &result); err != nil {
		return nil, 0, fmt.Errorf("decode fetch head response: %w", err)
	}
	return result.HeadHash, result.HeadSeq, nil
}

func (f *httpLedgerFetcher) FetchEvents(ctx context.Context, endpoint string, federationID string, fromSeq uint64, limit uint32) ([]*pb.LedgerEvent, error) {
	req := &pb.FetchEventsRequest{FederationId: federationID, FromSeq: fromSeq, Limit: limit}
	body, err := protojson.Marshal(req)
	if err != nil {
		return nil, err
	}

	url := endpoint + "/fed/v1/ledger/events"

	targetStationID := extractStationID(endpoint)
	token, err := f.mintToken(ctx, targetStationID)
	if err != nil {
		return nil, fmt.Errorf("mint federation token for %s: %w", url, err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+token)

	resp, err := f.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("http request to %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("fetch events %s returned %d: %s", url, resp.StatusCode, string(respBody))
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read fetch events response: %w", err)
	}

	var result pb.FetchEventsResponse
	if err := protojson.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("decode fetch events response: %w", err)
	}
	return result.Events, nil
}

func extractStationID(endpoint string) string {
	return endpoint
}
