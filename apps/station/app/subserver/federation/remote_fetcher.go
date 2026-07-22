package federation

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
)

type httpLedgerFetcher struct {
	client *http.Client
}

func NewHTTPLedgerFetcher() RemoteLedgerFetcher {
	return &httpLedgerFetcher{
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

type fetchHeadReq struct {
	FederationID string `json:"federation_id"`
}

type fetchHeadResp struct {
	FederationID string `json:"federation_id"`
	HeadHash     []byte `json:"head_hash"`
	HeadSeq      uint64 `json:"head_seq"`
}

func (f *httpLedgerFetcher) FetchHead(ctx context.Context, endpoint string, federationID string) ([]byte, uint64, error) {
	body, err := json.Marshal(&fetchHeadReq{FederationID: federationID})
	if err != nil {
		return nil, 0, err
	}

	url := endpoint + "/fed/v1/ledger/head"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := f.client.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("http request to %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, 0, fmt.Errorf("fetch head %s returned %d: %s", url, resp.StatusCode, string(respBody))
	}

	var result fetchHeadResp
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, 0, fmt.Errorf("decode fetch head response: %w", err)
	}
	return result.HeadHash, result.HeadSeq, nil
}

type fetchEventsReq struct {
	FederationID string `json:"federation_id"`
	FromSeq      uint64 `json:"from_seq"`
	Limit        uint32 `json:"limit"`
}

type fetchEventsResp struct {
	Events []*pb.LedgerEvent `json:"events"`
}

func (f *httpLedgerFetcher) FetchEvents(ctx context.Context, endpoint string, federationID string, fromSeq uint64, limit uint32) ([]*pb.LedgerEvent, error) {
	body, err := json.Marshal(&fetchEventsReq{FederationID: federationID, FromSeq: fromSeq, Limit: limit})
	if err != nil {
		return nil, err
	}

	url := endpoint + "/fed/v1/ledger/events"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := f.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request to %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("fetch events %s returned %d: %s", url, resp.StatusCode, string(respBody))
	}

	var result fetchEventsResp
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode fetch events response: %w", err)
	}
	return result.Events, nil
}
