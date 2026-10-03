package key_exchange

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	kemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	sharedfederation "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
)

const federatedContentPreKeyFormatVersion = 1

type activeFederationStationPair interface {
	ValidateActiveStationPair(
		context.Context,
		string,
		string,
		string,
	) error
}

// ClaimRemoteContentPreKeys sends one target-Station partition through the
// shared authenticated Federation peer client.
func (s *subServer) ClaimRemoteContentPreKeys(
	ctx context.Context,
	federationID string,
	targetStationPeerID string,
	request *securecontentpb.ClaimContentPreKeysRequest,
) (*securecontentpb.ClaimContentPreKeysResponse, error) {
	const operation = "key_exchange.claim_remote_content_prekeys"
	if s == nil {
		return nil, domain.NewError(
			domain.ErrorCodeDependency,
			operation,
			"subserver",
			"is unavailable",
		)
	}
	normalized, _, err := domain.NormalizeContentPreKeyClaimRequest(
		operation,
		request,
	)
	if err != nil {
		return nil, err
	}
	sourceStationPeerID := strings.TrimSpace(s.localStationID)
	targetStationPeerID = strings.TrimSpace(targetStationPeerID)
	federationID = strings.TrimSpace(federationID)
	if sourceStationPeerID == "" ||
		targetStationPeerID == "" ||
		targetStationPeerID == sourceStationPeerID ||
		federationID == "" {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"federation_route",
			"requires distinct canonical Stations and a Federation",
		)
	}
	membership, runtime, err := resolveFederatedContentPreKeyDependencies()
	if err != nil {
		return nil, domain.WrapError(domain.ErrorCodeDependency, operation, err)
	}
	if err := membership.ValidateActiveStationPair(
		ctx,
		federationID,
		sourceStationPeerID,
		targetStationPeerID,
	); err != nil {
		return nil, domain.WrapError(domain.ErrorCodeUnauthorized, operation, err)
	}
	canonicalRequest, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		normalized,
	)
	if err != nil {
		return nil, domain.WrapError(domain.ErrorCodeInternal, operation, err)
	}
	requestSHA256 := sha256.Sum256(canonicalRequest)
	wireRequest := &kemodel.ClaimFederatedContentPreKeysRequest{
		FormatVersion:           federatedContentPreKeyFormatVersion,
		SourceHomeStationPeerId: sourceStationPeerID,
		TargetHomeStationPeerId: targetStationPeerID,
		FederationId:            federationID,
		Request:                 normalized,
		CanonicalRequestSha256:  requestSHA256[:],
	}
	wireResponse := &kemodel.ClaimFederatedContentPreKeysResponse{}
	if err := runtime.CallPeer(ctx, sharedfederation.PeerCall{
		TargetStationPeerID: targetStationPeerID,
		Route: sharedfederation.
			PeerRouteKeyExchangeContentPreKeyClaim,
		Subject: sourceStationPeerID,
		Claims: map[string]string{
			sharedfederation.ClaimFederationID: federationID,
			sharedfederation.ClaimAuthorityPlanID: normalized.
				GetPlanId(),
			sharedfederation.ClaimPlanRequestSHA256: hex.EncodeToString(
				normalized.GetPlanRequestSha256(),
			),
			sharedfederation.ClaimCanonicalRequestSHA256: hex.EncodeToString(
				requestSHA256[:],
			),
			sharedfederation.ClaimSourceStationPeerID: sourceStationPeerID,
			sharedfederation.ClaimTargetStationPeerID: targetStationPeerID,
		},
		Request:  wireRequest,
		Response: wireResponse,
	}); err != nil {
		return nil, mapFederatedContentPreKeyPeerError(operation, err)
	}
	response := wireResponse.GetResponse()
	if err := validateFederatedContentPreKeyResponse(
		operation,
		normalized,
		response,
	); err != nil {
		return nil, err
	}
	return proto.Clone(response).(*securecontentpb.ClaimContentPreKeysResponse), nil
}

func mapFederatedContentPreKeyPeerError(operation string, err error) error {
	var responseError *sharedfederation.PeerResponseError
	if !errors.As(err, &responseError) {
		return domain.WrapError(domain.ErrorCodeDependency, operation, err)
	}
	var response actormodel.ErrorResponse
	if proto.Unmarshal(responseError.Body, &response) != nil {
		return domain.WrapError(domain.ErrorCodeDependency, operation, err)
	}
	code := domain.ErrorCodeDependency
	switch response.GetCode() {
	case actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_FORBIDDEN:
		code = domain.ErrorCodeUnauthorized
	case actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_INVALID_MATERIAL:
		code = domain.ErrorCodeInvalidMaterial
	case actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_POOL_NOT_FOUND:
		code = domain.ErrorCodeNotFound
	case actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_STALE_EPOCH:
		code = domain.ErrorCodeStaleMaterial
	case actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_REPLAY_CONFLICT:
		code = domain.ErrorCodeConflict
	case actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_POOL_DEPLETED:
		code = domain.ErrorCodePoolDepleted
	case actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_PAYLOAD_TOO_LARGE:
		code = domain.ErrorCodePayloadTooLarge
	case actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_QUOTA_EXCEEDED:
		code = domain.ErrorCodeQuotaExceeded
	}
	return domain.WrapError(code, operation, err)
}

// ClaimFederatedContentPreKeys is the recipient Key Exchange authority behind
// the Federation-owned peer route.
func (s *subServer) ClaimFederatedContentPreKeys(
	ctx context.Context,
	authenticatedSourceStationPeerID string,
	request *kemodel.ClaimFederatedContentPreKeysRequest,
) (*kemodel.ClaimFederatedContentPreKeysResponse, error) {
	const operation = "key_exchange.claim_federated_content_prekeys"
	membership, _, err := resolveFederatedContentPreKeyDependencies()
	if err != nil {
		return nil, domain.WrapError(domain.ErrorCodeDependency, operation, err)
	}
	service, err := s.requireContentPreKeyService()
	if err != nil {
		return nil, err
	}
	return claimFederatedContentPreKeys(
		ctx,
		service,
		membership,
		authenticatedSourceStationPeerID,
		s.localStationID,
		request,
	)
}

func claimFederatedContentPreKeys(
	ctx context.Context,
	service *application.ContentPreKeyService,
	membership activeFederationStationPair,
	authenticatedSourceStationPeerID string,
	localStationPeerID string,
	request *kemodel.ClaimFederatedContentPreKeysRequest,
) (*kemodel.ClaimFederatedContentPreKeysResponse, error) {
	const operation = "key_exchange.claim_federated_content_prekeys"
	if service == nil || membership == nil {
		return nil, domain.NewError(
			domain.ErrorCodeDependency,
			operation,
			"dependencies",
			"service and Federation membership are required",
		)
	}
	normalized, err := normalizeFederatedContentPreKeyRequest(
		operation,
		authenticatedSourceStationPeerID,
		localStationPeerID,
		request,
	)
	if err != nil {
		return nil, err
	}
	if err := membership.ValidateActiveStationPair(
		ctx,
		normalized.GetFederationId(),
		normalized.GetSourceHomeStationPeerId(),
		normalized.GetTargetHomeStationPeerId(),
	); err != nil {
		return nil, domain.WrapError(domain.ErrorCodeUnauthorized, operation, err)
	}

	localRequest := proto.Clone(
		normalized.GetRequest(),
	).(*securecontentpb.ClaimContentPreKeysRequest)
	localRequest.PlanId = federatedContentPreKeyPlanID(
		normalized.GetSourceHomeStationPeerId(),
		normalized.GetTargetHomeStationPeerId(),
		localRequest.GetPlanId(),
	)
	response, err := service.ClaimContentPreKeys(ctx, localRequest)
	if err != nil {
		return nil, err
	}
	if err := validateFederatedContentPreKeyResponse(
		operation,
		normalized.GetRequest(),
		response,
	); err != nil {
		return nil, err
	}
	return &kemodel.ClaimFederatedContentPreKeysResponse{
		Response: proto.Clone(
			response,
		).(*securecontentpb.ClaimContentPreKeysResponse),
	}, nil
}

func normalizeFederatedContentPreKeyRequest(
	operation string,
	authenticatedSourceStationPeerID string,
	localStationPeerID string,
	request *kemodel.ClaimFederatedContentPreKeysRequest,
) (*kemodel.ClaimFederatedContentPreKeysRequest, error) {
	if request == nil || len(request.ProtoReflect().GetUnknown()) != 0 {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"request",
			"must be present and contain no unknown fields",
		)
	}
	sourceStationPeerID := strings.TrimSpace(
		request.GetSourceHomeStationPeerId(),
	)
	targetStationPeerID := strings.TrimSpace(
		request.GetTargetHomeStationPeerId(),
	)
	federationID := strings.TrimSpace(request.GetFederationId())
	if request.GetFormatVersion() != federatedContentPreKeyFormatVersion ||
		sourceStationPeerID == "" ||
		sourceStationPeerID != request.GetSourceHomeStationPeerId() ||
		targetStationPeerID == "" ||
		targetStationPeerID != request.GetTargetHomeStationPeerId() ||
		sourceStationPeerID == targetStationPeerID ||
		federationID == "" ||
		federationID != request.GetFederationId() ||
		sourceStationPeerID != strings.TrimSpace(
			authenticatedSourceStationPeerID,
		) ||
		targetStationPeerID != strings.TrimSpace(localStationPeerID) {
		return nil, domain.NewError(
			domain.ErrorCodeUnauthorized,
			operation,
			"federation_route",
			"does not match the authenticated Station pair",
		)
	}
	normalized, _, err := domain.NormalizeContentPreKeyClaimRequest(
		operation,
		request.GetRequest(),
	)
	if err != nil {
		return nil, err
	}
	if !proto.Equal(normalized, request.GetRequest()) {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"request.request",
			"must use canonical target order",
		)
	}
	canonical, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		normalized,
	)
	if err != nil {
		return nil, domain.WrapError(domain.ErrorCodeInternal, operation, err)
	}
	digest := sha256.Sum256(canonical)
	if !bytes.Equal(digest[:], request.GetCanonicalRequestSha256()) {
		return nil, domain.NewError(
			domain.ErrorCodeConflict,
			operation,
			"canonical_request_sha256",
			"does not match the nested claim request",
		)
	}
	return proto.Clone(
		request,
	).(*kemodel.ClaimFederatedContentPreKeysRequest), nil
}

// ValidateFederatedContentPreKeyPeerClaims binds the canonical wrapper to the
// authenticated Federation route before Key Exchange performs any mutation.
func ValidateFederatedContentPreKeyPeerClaims(
	claims *authfed.VerifiedClaims,
	request *kemodel.ClaimFederatedContentPreKeysRequest,
) error {
	if claims == nil || request == nil {
		return server.Forbidden(
			"Federation claims do not match the Content PreKey claim",
		)
	}
	normalized, err := normalizeFederatedContentPreKeyRequest(
		"key_exchange.validate_federated_content_prekey_claims",
		claims.Issuer,
		claims.Audience,
		request,
	)
	if err != nil ||
		claims.Scope != sharedfederation.KeyExchangeContentPreKeyClaimScope ||
		claims.Subject != claims.Issuer ||
		claims.Custom[sharedfederation.ClaimFederationID] !=
			normalized.GetFederationId() ||
		claims.Custom[sharedfederation.ClaimAuthorityPlanID] !=
			normalized.GetRequest().GetPlanId() ||
		claims.Custom[sharedfederation.ClaimPlanRequestSHA256] !=
			hex.EncodeToString(
				normalized.GetRequest().GetPlanRequestSha256(),
			) ||
		claims.Custom[sharedfederation.ClaimCanonicalRequestSHA256] !=
			hex.EncodeToString(normalized.GetCanonicalRequestSha256()) ||
		claims.Custom[sharedfederation.ClaimSourceStationPeerID] !=
			claims.Issuer ||
		claims.Custom[sharedfederation.ClaimTargetStationPeerID] !=
			claims.Audience {
		return server.Forbidden(
			"Federation claims do not match the Content PreKey claim",
		)
	}
	return nil
}

func validateFederatedContentPreKeyResponse(
	operation string,
	request *securecontentpb.ClaimContentPreKeysRequest,
	response *securecontentpb.ClaimContentPreKeysResponse,
) error {
	if response == nil ||
		len(response.ProtoReflect().GetUnknown()) != 0 ||
		len(response.GetClaims()) != len(request.GetTargets()) {
		return domain.NewError(
			domain.ErrorCodeConflict,
			operation,
			"response",
			"must contain one claim per target",
		)
	}
	for index, claim := range response.GetClaims() {
		if err := domain.ValidateClaimedContentPreKey(operation, claim); err != nil {
			return err
		}
		if !proto.Equal(claim.GetTarget(), request.GetTargets()[index]) {
			return domain.NewError(
				domain.ErrorCodeConflict,
				operation,
				"response.claims",
				"do not preserve canonical target order",
			)
		}
	}
	return nil
}

func federatedContentPreKeyPlanID(
	sourceStationPeerID string,
	targetStationPeerID string,
	planID string,
) string {
	digest := sha256.Sum256([]byte(
		sourceStationPeerID + "\x00" +
			targetStationPeerID + "\x00" +
			planID,
	))
	return "fcpk-" + hex.EncodeToString(digest[:])
}

func resolveFederatedContentPreKeyDependencies() (
	activeFederationStationPair,
	*sharedfederation.Runtime,
	error,
) {
	instance := server.GetOptions().SubserverInstances["federation"]
	membership, ok := instance.(activeFederationStationPair)
	if !ok || membership == nil {
		return nil, nil, domain.NewError(
			domain.ErrorCodeDependency,
			"key_exchange.resolve_federation",
			"membership",
			"is unavailable",
		)
	}
	provider, ok := instance.(sharedfederation.RuntimeProvider)
	if !ok || provider == nil || provider.FederationDeliveryRuntime() == nil {
		return nil, nil, domain.NewError(
			domain.ErrorCodeDependency,
			"key_exchange.resolve_federation",
			"runtime",
			"is unavailable",
		)
	}
	return membership, provider.FederationDeliveryRuntime(), nil
}
