package federation

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/encoding/protojson"
)

const (
	FederationGovernanceSyncScope     = "federation-governance-sync"
	FederationGovernanceProposalScope = "federation-governance-proposal"
)

var (
	ErrRemoteFederationNotFound    = errors.New("remote Federation not found")
	ErrRemoteGovernanceUnavailable = errors.New(
		"remote Federation governance unavailable",
	)
	ErrRemoteGovernanceRejected  = errors.New("remote governance rejected")
	ErrRemoteGovernanceForbidden = errors.New("remote governance forbidden")
	ErrRemoteGovernanceConflict  = errors.New("remote governance conflict")
)

type RemoteStationIdentity struct {
	StationPeerID              string
	FederationSigningPublicKey ed25519.PublicKey
}

type httpLedgerFetcher struct {
	client         *http.Client
	fedCache       *federation.KeyCache
	localStationFn func() string
}

func NewHTTPLedgerFetcher(fedCache *federation.KeyCache, localStationFn func() string) *httpLedgerFetcher {
	return &httpLedgerFetcher{
		client:         &http.Client{Timeout: 10 * time.Second},
		fedCache:       fedCache,
		localStationFn: localStationFn,
	}
}

func (f *httpLedgerFetcher) mintToken(ctx context.Context, targetStationID string) (string, error) {
	return f.mintTokenForScope(
		ctx,
		targetStationID,
		FederationGovernanceSyncScope,
	)
}

func (f *httpLedgerFetcher) mintTokenForScope(
	ctx context.Context,
	targetStationID string,
	scopeName string,
) (string, error) {
	localID := f.localStationFn()
	if localID == "" {
		return "", fmt.Errorf("local station ID not available")
	}
	return federation.Mint(ctx, f.fedCache, federation.MintRequest{
		Scope:    scopeName,
		Issuer:   localID,
		Audience: targetStationID,
		Subject:  localID,
	})
}

func (f *httpLedgerFetcher) FetchHead(ctx context.Context, endpoint, targetPeerID, federationID string) ([]byte, uint64, error) {
	req := &pb.FetchHeadRequest{FederationId: federationID}
	body, err := protojson.Marshal(req)
	if err != nil {
		return nil, 0, err
	}

	url := endpoint + "/fed/v1/ledger/head"

	token, err := f.mintToken(ctx, targetPeerID)
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

func (f *httpLedgerFetcher) FetchEvents(ctx context.Context, endpoint, targetPeerID, federationID string, fromSeq uint64, limit uint32) ([]*pb.LedgerEvent, error) {
	req := &pb.FetchEventsRequest{FederationId: federationID, FromSeq: fromSeq, Limit: limit}
	body, err := protojson.Marshal(req)
	if err != nil {
		return nil, err
	}

	url := endpoint + "/fed/v1/ledger/events"

	token, err := f.mintToken(ctx, targetPeerID)
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
		return nil, fmt.Errorf(
			"%w: request to %s: %v",
			ErrRemoteGovernanceUnavailable,
			url,
			err,
		)
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

func (f *httpLedgerFetcher) ResolveStationIdentity(
	ctx context.Context,
	endpoint string,
) (*RemoteStationIdentity, error) {
	challenge := make([]byte, peerpb.StationIdentityChallengeSize)
	if _, err := rand.Read(challenge); err != nil {
		return nil, fmt.Errorf("generate Station identity challenge: %w", err)
	}
	body, err := protojson.Marshal(
		&peerpb.StationIdentityRequest{Challenge: challenge},
	)
	if err != nil {
		return nil, err
	}
	canonicalEndpoint := strings.TrimRight(endpoint, "/")
	url := canonicalEndpoint + "/sub-bootstrap/station-identity"
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		url,
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := f.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf(
			"%w: read Station identity from %s: %v",
			ErrRemoteGovernanceUnavailable,
			url,
			err,
		)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		responseBody, _ := io.ReadAll(response.Body)
		return nil, fmt.Errorf(
			"%w: Station identity %s returned %d: %s",
			ErrRemoteGovernanceUnavailable,
			url,
			response.StatusCode,
			string(responseBody),
		)
	}
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, fmt.Errorf("read Station identity response: %w", err)
	}
	identity := &peerpb.StationIdentityResponse{}
	if err := protojson.Unmarshal(responseBody, identity); err != nil {
		return nil, fmt.Errorf("decode Station identity response: %w", err)
	}
	verified, err := peerpb.VerifyStationIdentityResponse(
		identity,
		challenge,
		canonicalEndpoint,
		[]string{"station-identity"},
		time.Now().UTC(),
	)
	if err != nil {
		return nil, fmt.Errorf("verify Station identity response: %w", err)
	}
	stationPeerID := strings.TrimSpace(
		verified.Statement.GetStationPeerId(),
	)
	if stationPeerID == "" {
		return nil, errors.New("verified Station identity is empty")
	}
	federationSigningPublicKey := verified.Statement.
		GetFederationSigningPublicKey()
	if len(federationSigningPublicKey) != ed25519.PublicKeySize {
		return nil, errors.New(
			"verified Station Federation signing key is invalid",
		)
	}
	return &RemoteStationIdentity{
		StationPeerID: stationPeerID,
		FederationSigningPublicKey: append(
			ed25519.PublicKey(nil),
			federationSigningPublicKey...,
		),
	}, nil
}

func (f *httpLedgerFetcher) SubmitProposal(ctx context.Context, endpoint, targetPeerID string, req *pb.SubmitProposalRequest) (*pb.SubmitProposalResponse, error) {
	body, err := protojson.Marshal(req)
	if err != nil {
		return nil, err
	}

	if strings.TrimSpace(targetPeerID) == "" {
		return nil, errors.New(
			"target Station identity is required for governance proposal",
		)
	}
	url := endpoint + "/fed/v1/governance/submit-proposal"

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	token, mintErr := f.mintTokenForScope(
		ctx,
		targetPeerID,
		FederationGovernanceProposalScope,
	)
	if mintErr != nil {
		return nil, fmt.Errorf(
			"mint federation token for %s: %w",
			url,
			mintErr,
		)
	}
	httpReq.Header.Set("Authorization", "Bearer "+token)

	resp, err := f.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf(
			"%w: request to %s: %v",
			ErrRemoteGovernanceUnavailable,
			url,
			err,
		)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		switch resp.StatusCode {
		case http.StatusNotFound:
			return nil, fmt.Errorf(
				"%w: %s",
				ErrRemoteFederationNotFound,
				string(respBody),
			)
		case http.StatusBadGateway,
			http.StatusServiceUnavailable,
			http.StatusGatewayTimeout:
			return nil, fmt.Errorf(
				"%w: %s",
				ErrRemoteGovernanceUnavailable,
				string(respBody),
			)
		case http.StatusBadRequest:
			return nil, fmt.Errorf(
				"%w: %s",
				ErrRemoteGovernanceRejected,
				string(respBody),
			)
		case http.StatusUnauthorized, http.StatusForbidden:
			return nil, fmt.Errorf(
				"%w: %s",
				ErrRemoteGovernanceForbidden,
				string(respBody),
			)
		case http.StatusConflict:
			return nil, fmt.Errorf(
				"%w: %s",
				ErrRemoteGovernanceConflict,
				string(respBody),
			)
		}
		return nil, fmt.Errorf("submit proposal %s returned %d: %s", url, resp.StatusCode, string(respBody))
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read submit proposal response: %w", err)
	}

	var result pb.SubmitProposalResponse
	if err := protojson.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("decode submit proposal response: %w", err)
	}
	return &result, nil
}
