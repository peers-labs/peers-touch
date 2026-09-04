package infrastructure

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

type MlsKeyPackageClaimTokenMinter interface {
	MintMlsKeyPackageClaim(
		ctx context.Context,
		targetStationID string,
		request *chat.ClaimFederatedMlsKeyPackageRequest,
	) (string, error)
}

type HTTPMlsKeyPackageClaimer struct {
	client      *http.Client
	tokenMinter MlsKeyPackageClaimTokenMinter
	resolver    FederationStationURLResolver
	relay       FederationRelayAccess
}

func NewHTTPMlsKeyPackageClaimer(
	client *http.Client,
	tokenMinter MlsKeyPackageClaimTokenMinter,
	resolver FederationStationURLResolver,
	relay FederationRelayAccess,
) (*HTTPMlsKeyPackageClaimer, error) {
	if client == nil || tokenMinter == nil || (resolver == nil && relay == nil) {
		return nil, fmt.Errorf("messaging: MLS KeyPackage claimer dependencies are invalid")
	}
	return &HTTPMlsKeyPackageClaimer{
		client:      client,
		tokenMinter: tokenMinter,
		resolver:    resolver,
		relay:       relay,
	}, nil
}

func (c *HTTPMlsKeyPackageClaimer) ClaimMlsKeyPackage(
	ctx context.Context,
	homeStationID string,
	request *chat.ClaimFederatedMlsKeyPackageRequest,
) (*chat.ClaimFederatedMlsKeyPackageResponse, error) {
	if homeStationID == "" || request == nil {
		return nil, fmt.Errorf("messaging: remote MLS KeyPackage claim is incomplete")
	}
	token, err := c.tokenMinter.MintMlsKeyPackageClaim(ctx, homeStationID, request)
	if err != nil {
		return nil, err
	}
	body, err := proto.Marshal(request)
	if err != nil {
		return nil, err
	}
	endpoint, relayToken, viaRelay, err := c.resolveEndpoint(ctx, homeStationID)
	if err != nil {
		return nil, err
	}
	httpRequest, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		endpoint,
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	httpRequest.Header.Set("Content-Type", "application/protobuf")
	httpRequest.Header.Set("Accept", "application/protobuf")
	if viaRelay {
		httpRequest.Header.Set("Authorization", "Bearer "+relayToken)
		httpRequest.Header.Set(nativefed.ForwardAuthorizationHeader, "Bearer "+token)
	} else {
		httpRequest.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := c.client.Do(httpRequest)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf(
			"messaging: MLS KeyPackage claim status %d: %s",
			response.StatusCode,
			strings.TrimSpace(string(responseBody)),
		)
	}
	result := &chat.ClaimFederatedMlsKeyPackageResponse{}
	if err := proto.Unmarshal(responseBody, result); err != nil {
		return nil, err
	}
	if !validClaimedMlsKeyPackage(result, request, homeStationID) {
		return nil, messaging.ErrMlsKeyPackageClaimConflict
	}
	return result, nil
}

func (c *HTTPMlsKeyPackageClaimer) resolveEndpoint(
	ctx context.Context,
	targetStationID string,
) (endpoint string, relayToken string, viaRelay bool, err error) {
	const route = "/messaging/federation/mls-key-package/claim"
	if c.relay != nil {
		base := strings.TrimRight(strings.TrimSpace(c.relay.BaseURL()), "/")
		token := strings.TrimSpace(c.relay.Token())
		if base != "" && token != "" {
			return fmt.Sprintf(
				"%s/relay/forward/%s%s",
				base,
				url.PathEscape(targetStationID),
				route,
			), token, true, nil
		}
	}
	if c.resolver == nil {
		return "", "", false, fmt.Errorf("messaging: MLS KeyPackage claim route unavailable")
	}
	base, err := c.resolver.ResolveActiveStationURL(ctx, targetStationID)
	if err != nil || strings.TrimSpace(base) == "" {
		return "", "", false, fmt.Errorf("messaging: MLS KeyPackage claim route unavailable")
	}
	return strings.TrimRight(base, "/") + route, "", false, nil
}

func validClaimedMlsKeyPackage(
	response *chat.ClaimFederatedMlsKeyPackageResponse,
	request *chat.ClaimFederatedMlsKeyPackageRequest,
	homeStationID string,
) bool {
	if response == nil ||
		response.Target == nil ||
		request == nil ||
		request.Target == nil ||
		response.Target.Ptid != request.Target.Ptid ||
		response.Target.DeviceId != request.Target.DeviceId ||
		response.HomeStationId != homeStationID ||
		response.PackageId == "" ||
		len(response.KeyPackage) == 0 ||
		len(response.KeyPackageSha256) != sha256.Size ||
		!response.IrreversiblyConsumed {
		return false
	}
	hash := sha256.Sum256(response.KeyPackage)
	return bytes.Equal(hash[:], response.KeyPackageSha256)
}

var _ messaging.RemoteMlsKeyPackageClaimer = (*HTTPMlsKeyPackageClaimer)(nil)
