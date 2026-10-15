package key_exchange

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	kemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	// FederationDirectKeyBundlesFetchScope authenticates the peer-only Direct fetch route.
	FederationDirectKeyBundlesFetchScope = "key-exchange-direct-bundle-fetch"
	// FederationMLSKeyPackageFetchScope authenticates the peer-only MLS fetch route.
	FederationMLSKeyPackageFetchScope = "key-exchange-mls-key-package-fetch"
	// FederationMLSKeyPackageClaimScope authenticates the peer-only irreversible MLS claim route.
	FederationMLSKeyPackageClaimScope = "key-exchange-mls-key-package-claim"

	// FederationDirectKeyBundlesFetchRoute is registered by the Federation owner.
	FederationDirectKeyBundlesFetchRoute = "/federation/key-exchange/keys/bundle/fetch"
	// FederationMLSKeyPackageFetchRoute is registered by the Federation owner.
	FederationMLSKeyPackageFetchRoute = "/federation/key-exchange/mls/key-package/fetch"
	// FederationMLSKeyPackageClaimRoute is registered by the Federation owner.
	FederationMLSKeyPackageClaimRoute = "/federation/key-exchange/mls-key-package/claim"

	keyExchangeClaimActorPTID       = "actor_ptid"
	keyExchangeClaimDeviceID        = "device_id"
	keyExchangeClaimRequestID       = "request_id"
	keyExchangeClaimRequesterPTID   = "requester_ptid"
	keyExchangeClaimRequesterDevice = "requester_device_id"
	keyExchangeClaimAuthorityPlan   = "authority_plan_id"
	keyExchangeClaimPlanExpiresAt   = "plan_expires_at"
	keyExchangeClaimSourceStationID = "source_station_peer_id"
	keyExchangeClaimTargetStationID = "target_station_peer_id"

	keyExchangeFederationRequestTimeout = 15 * time.Second
	keyExchangeFederationTokenTTL       = time.Minute
	keyExchangeFederationResponseLimit  = 4 << 20
)

var keyExchangeFederationScopes = []scope.Scope{
	{
		Name:        FederationDirectKeyBundlesFetchScope,
		Description: "fetch a claim-bound Direct key bundle from its Home Station",
		Policy: scope.Policy{
			TTLMax:           keyExchangeFederationTokenTTL,
			AudienceRequired: true,
			AllowedClaimKeys: []string{
				keyExchangeClaimActorPTID,
				keyExchangeClaimDeviceID,
				keyExchangeClaimRequestID,
				keyExchangeClaimRequesterPTID,
				keyExchangeClaimRequesterDevice,
				keyExchangeClaimSourceStationID,
				keyExchangeClaimTargetStationID,
			},
		},
	},
	{
		Name:        FederationMLSKeyPackageFetchScope,
		Description: "fetch a claim-bound MLS KeyPackage from its Home Station",
		Policy: scope.Policy{
			TTLMax:           keyExchangeFederationTokenTTL,
			AudienceRequired: true,
			AllowedClaimKeys: []string{
				keyExchangeClaimActorPTID,
				keyExchangeClaimRequestID,
				keyExchangeClaimRequesterPTID,
				keyExchangeClaimRequesterDevice,
				keyExchangeClaimSourceStationID,
				keyExchangeClaimTargetStationID,
			},
		},
	},
	{
		Name:        FederationMLSKeyPackageClaimScope,
		Description: "irreversibly claim one MLS KeyPackage from its Home Station",
		Policy: scope.Policy{
			TTLMax:           keyExchangeFederationTokenTTL,
			AudienceRequired: true,
			AllowedClaimKeys: []string{
				keyExchangeClaimAuthorityPlan,
				keyExchangeClaimActorPTID,
				keyExchangeClaimDeviceID,
				keyExchangeClaimRequestID,
				keyExchangeClaimPlanExpiresAt,
				keyExchangeClaimSourceStationID,
				keyExchangeClaimTargetStationID,
			},
		},
	},
}

func registerKeyExchangeFederationScopes() error {
	for _, expected := range keyExchangeFederationScopes {
		actual, err := scope.Get(expected.Name)
		if err == nil {
			if !reflect.DeepEqual(actual, expected) {
				return fmt.Errorf(
					"key exchange Federation scope %q has a conflicting policy",
					expected.Name,
				)
			}
			continue
		}
		if !errors.Is(err, scope.ErrUnknownScope) {
			return fmt.Errorf(
				"inspect key exchange Federation scope %q: %w",
				expected.Name,
				err,
			)
		}
		if err := scope.Register(expected); err != nil {
			return fmt.Errorf(
				"register key exchange Federation scope %q: %w",
				expected.Name,
				err,
			)
		}
	}

	return nil
}

func (p *canonicalFederationPort) FetchDirectKeyBundles(
	ctx context.Context,
	targetStationID string,
	identity domain.DestructiveReadIdentity,
	actorPTID string,
	targetDeviceID string,
) ([]domain.DirectKeyBundle, error) {
	const operation = "key_exchange.federation.fetch_direct_key_bundles"
	targetStationID, actorPTID, targetDeviceID, err := validateRemoteFetchTarget(
		operation,
		p.localStationID,
		targetStationID,
		actorPTID,
		targetDeviceID,
	)
	if err != nil {
		return nil, err
	}
	if err := identity.Validate(operation); err != nil {
		return nil, err
	}
	request := &kemodel.FetchFederatedDirectKeyBundlesRequest{
		SourceHomeStationPeerId: p.localStationID,
		Request: &kemodel.FetchDirectKeyBundlesRequest{
			Actor:             &actormodel.ActorRef{Ptid: actorPTID},
			TargetDeviceId:    targetDeviceID,
			HomeStationPeerId: targetStationID,
			RequestId:         identity.RequestID,
			Requester: &actormodel.ActorDeviceRef{
				Actor:    &actormodel.ActorRef{Ptid: identity.Requester.ActorPTID},
				DeviceId: identity.Requester.DeviceID,
			},
		},
	}
	response := &kemodel.FetchFederatedDirectKeyBundlesResponse{}
	if err := p.executeFederationQuery(
		ctx,
		operation,
		targetStationID,
		FederationDirectKeyBundlesFetchRoute,
		FederationDirectKeyBundlesFetchScope,
		map[string]string{
			keyExchangeClaimActorPTID:       actorPTID,
			keyExchangeClaimDeviceID:        targetDeviceID,
			keyExchangeClaimRequestID:       identity.RequestID,
			keyExchangeClaimRequesterPTID:   identity.Requester.ActorPTID,
			keyExchangeClaimRequesterDevice: identity.Requester.DeviceID,
			keyExchangeClaimSourceStationID: p.localStationID,
			keyExchangeClaimTargetStationID: targetStationID,
		},
		request,
		response,
	); err != nil {
		return nil, err
	}

	wireResponse := response.GetResponse()
	if wireResponse == nil {
		return nil, domain.NewError(
			domain.ErrorCodeConflict,
			operation,
			"response",
			"is missing the canonical Direct fetch result",
		)
	}
	bundles := make([]domain.DirectKeyBundle, 0, len(wireResponse.GetBundles()))
	for _, value := range wireResponse.GetBundles() {
		bundle, err := directBundleFromProto(operation, value)
		if err != nil {
			return nil, err
		}
		if bundle.Device.ActorPTID != actorPTID ||
			(targetDeviceID != "" && bundle.Device.DeviceID != targetDeviceID) {
			return nil, domain.NewError(
				domain.ErrorCodeConflict,
				operation,
				"bundle.device",
				"does not match the authenticated Federation request",
			)
		}
		bundles = append(bundles, bundle)
	}

	return bundles, nil
}

func (p *canonicalFederationPort) FetchMLSKeyPackage(
	ctx context.Context,
	targetStationID string,
	identity domain.DestructiveReadIdentity,
	actorPTID string,
) (*domain.MLSKeyPackageReservation, error) {
	const operation = "key_exchange.federation.fetch_mls_key_package"
	targetStationID, actorPTID, _, err := validateRemoteFetchTarget(
		operation,
		p.localStationID,
		targetStationID,
		actorPTID,
		"",
	)
	if err != nil {
		return nil, err
	}
	if err := identity.Validate(operation); err != nil {
		return nil, err
	}
	request := &kemodel.FetchFederatedMlsKeyPackageRequest{
		SourceHomeStationPeerId: p.localStationID,
		Request: &kemodel.FetchMlsKeyPackageRequest{
			Actor:             &actormodel.ActorRef{Ptid: actorPTID},
			HomeStationPeerId: targetStationID,
			RequestId:         identity.RequestID,
			Requester: &actormodel.ActorDeviceRef{
				Actor:    &actormodel.ActorRef{Ptid: identity.Requester.ActorPTID},
				DeviceId: identity.Requester.DeviceID,
			},
		},
	}
	response := &kemodel.FetchFederatedMlsKeyPackageResponse{}
	if err := p.executeFederationQuery(
		ctx,
		operation,
		targetStationID,
		FederationMLSKeyPackageFetchRoute,
		FederationMLSKeyPackageFetchScope,
		map[string]string{
			keyExchangeClaimActorPTID:       actorPTID,
			keyExchangeClaimRequestID:       identity.RequestID,
			keyExchangeClaimRequesterPTID:   identity.Requester.ActorPTID,
			keyExchangeClaimRequesterDevice: identity.Requester.DeviceID,
			keyExchangeClaimSourceStationID: p.localStationID,
			keyExchangeClaimTargetStationID: targetStationID,
		},
		request,
		response,
	); err != nil {
		return nil, err
	}
	wireResponse := response.GetResponse()
	if wireResponse == nil {
		return nil, domain.NewError(
			domain.ErrorCodeConflict,
			operation,
			"response",
			"is missing the canonical MLS fetch result",
		)
	}
	if !wireResponse.GetAvailable() {
		if wireResponse.GetReservation() != nil ||
			strings.TrimSpace(wireResponse.GetHomeStationPeerId()) != targetStationID {
			return nil, domain.NewError(
				domain.ErrorCodeConflict,
				operation,
				"response",
				"contains an invalid unavailable result",
			)
		}
		return nil, nil
	}

	reservation, err := reservationFromProto(
		operation,
		wireResponse.GetReservation(),
		"",
		targetStationID,
		time.Time{},
		true,
	)
	if err != nil {
		return nil, err
	}
	if wireResponse.GetHomeStationPeerId() != targetStationID ||
		reservation.Target.ActorPTID != actorPTID {
		return nil, domain.NewError(
			domain.ErrorCodeConflict,
			operation,
			"reservation",
			"does not match the authenticated Federation request",
		)
	}

	return &reservation, nil
}

func (p *canonicalFederationPort) ClaimMLSKeyPackage(
	ctx context.Context,
	targetStationID string,
	claim domain.MLSKeyPackageClaim,
) (domain.MLSKeyPackageReservation, error) {
	const operation = "key_exchange.federation.claim_mls_key_package"
	targetStationID = strings.TrimSpace(targetStationID)
	if err := validateRemoteStation(
		operation,
		p.localStationID,
		targetStationID,
	); err != nil {
		return domain.MLSKeyPackageReservation{}, err
	}
	if strings.TrimSpace(claim.AuthenticatedAuthorityStation) != p.localStationID ||
		strings.TrimSpace(claim.AuthorityStationID) != p.localStationID {
		return domain.MLSKeyPackageReservation{}, domain.NewError(
			domain.ErrorCodeUnauthorized,
			operation,
			"authority_station_peer_id",
			"does not match the local authenticated authority Station",
		)
	}
	if err := claim.Target.Validate(operation); err != nil {
		return domain.MLSKeyPackageReservation{}, err
	}
	if strings.TrimSpace(claim.AuthorityPlanID) == "" ||
		claim.PlanExpiresAt.IsZero() {
		return domain.MLSKeyPackageReservation{}, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"claim",
			"requires an authority plan and expiration",
		)
	}
	if err := domain.ValidateRequestID(operation, claim.RequestID); err != nil {
		return domain.MLSKeyPackageReservation{}, err
	}
	request := &kemodel.ClaimMlsKeyPackageRequest{
		AuthorityPlanId:        strings.TrimSpace(claim.AuthorityPlanID),
		AuthorityStationPeerId: p.localStationID,
		Target: &actormodel.ActorDeviceRef{
			Actor:    &actormodel.ActorRef{Ptid: claim.Target.ActorPTID},
			DeviceId: claim.Target.DeviceID,
		},
		PlanExpiresAt: timestamppb.New(claim.PlanExpiresAt.UTC()),
		RequestId:     claim.RequestID,
	}
	if err := request.GetPlanExpiresAt().CheckValid(); err != nil {
		return domain.MLSKeyPackageReservation{}, domain.WrapError(
			domain.ErrorCodeInvalidArgument,
			operation,
			err,
		)
	}
	response := &kemodel.ClaimMlsKeyPackageResponse{}
	if err := p.executeFederationQuery(
		ctx,
		operation,
		targetStationID,
		FederationMLSKeyPackageClaimRoute,
		FederationMLSKeyPackageClaimScope,
		map[string]string{
			keyExchangeClaimAuthorityPlan:   request.GetAuthorityPlanId(),
			keyExchangeClaimActorPTID:       claim.Target.ActorPTID,
			keyExchangeClaimDeviceID:        claim.Target.DeviceID,
			keyExchangeClaimRequestID:       request.GetRequestId(),
			keyExchangeClaimPlanExpiresAt:   claim.PlanExpiresAt.UTC().Format(time.RFC3339Nano),
			keyExchangeClaimSourceStationID: p.localStationID,
			keyExchangeClaimTargetStationID: targetStationID,
		},
		request,
		response,
	); err != nil {
		return domain.MLSKeyPackageReservation{}, err
	}

	reservation, err := reservationFromProto(
		operation,
		response.GetReservation(),
		request.GetAuthorityPlanId(),
		targetStationID,
		claim.PlanExpiresAt.UTC(),
		response.GetIrreversiblyConsumed(),
	)
	if err != nil {
		return domain.MLSKeyPackageReservation{}, err
	}
	if response.GetHomeStationPeerId() != targetStationID ||
		reservation.Target != claim.Target ||
		!reservation.IrreversiblyConsumed {
		return domain.MLSKeyPackageReservation{}, domain.NewError(
			domain.ErrorCodeConflict,
			operation,
			"reservation",
			"does not match the authenticated authority claim",
		)
	}

	return reservation, nil
}

func (p *canonicalFederationPort) executeFederationQuery(
	ctx context.Context,
	operation string,
	targetStationID string,
	route string,
	scopeName string,
	customClaims map[string]string,
	request proto.Message,
	response proto.Message,
) error {
	if p == nil ||
		p.client == nil ||
		p.keys == nil ||
		strings.TrimSpace(p.localStationID) == "" {
		return domain.NewError(
			domain.ErrorCodeDependency,
			operation,
			"transport",
			"is not initialized",
		)
	}
	if err := registerKeyExchangeFederationScopes(); err != nil {
		return domain.WrapError(domain.ErrorCodeDependency, operation, err)
	}
	token, err := authfed.Mint(ctx, p.keys, authfed.MintRequest{
		Scope:    scopeName,
		Issuer:   p.localStationID,
		Audience: targetStationID,
		Subject:  p.localStationID,
		TTL:      keyExchangeFederationTokenTTL,
		Custom:   customClaims,
	})
	if err != nil {
		return domain.WrapError(domain.ErrorCodeDependency, operation, err)
	}
	body, err := proto.MarshalOptions{Deterministic: true}.Marshal(request)
	if err != nil {
		return domain.WrapError(domain.ErrorCodeInternal, operation, err)
	}
	endpoint, viaRelay, err := p.resolveFederationQueryEndpoint(
		ctx,
		targetStationID,
		route,
	)
	if err != nil {
		return domain.WrapError(domain.ErrorCodeDependency, operation, err)
	}
	httpRequest, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		endpoint,
		bytes.NewReader(body),
	)
	if err != nil {
		return domain.WrapError(domain.ErrorCodeInternal, operation, err)
	}
	httpRequest.Header.Set("Content-Type", "application/protobuf")
	httpRequest.Header.Set("Accept", "application/protobuf")
	httpRequest.Header.Set("Authorization", "Bearer "+token)
	var httpResponse *http.Response
	if viaRelay {
		httpResponse, err = p.relay.RoundTrip(
			ctx,
			targetStationID,
			httpRequest,
		)
	} else {
		httpResponse, err = p.client.Do(httpRequest)
	}
	if err != nil {
		return domain.WrapError(domain.ErrorCodeDependency, operation, err)
	}
	defer httpResponse.Body.Close()

	responseBody, err := readBoundedFederationResponse(httpResponse.Body)
	if err != nil {
		return domain.WrapError(domain.ErrorCodeDependency, operation, err)
	}
	if httpResponse.StatusCode < http.StatusOK ||
		httpResponse.StatusCode >= http.StatusMultipleChoices {
		return federationHTTPStatusError(operation, httpResponse.StatusCode)
	}
	if err := proto.Unmarshal(responseBody, response); err != nil {
		return domain.WrapError(domain.ErrorCodeDependency, operation, err)
	}
	if len(response.ProtoReflect().GetUnknown()) != 0 {
		return domain.NewError(
			domain.ErrorCodeConflict,
			operation,
			"response",
			"contains unknown protobuf fields",
		)
	}

	return nil
}

func (p *canonicalFederationPort) resolveFederationQueryEndpoint(
	ctx context.Context,
	targetStationID string,
	route string,
) (endpoint string, viaRelay bool, err error) {
	if p.relay != nil && p.relay.Available() {
		return "https://station.invalid" + route, true, nil
	}
	if p.resolver == nil {
		return "", false, errors.New(
			"no direct or Relay Federation route is available",
		)
	}
	baseURL, err := p.resolver.ResolveActiveStationURL(ctx, targetStationID)
	if err != nil {
		return "", false, err
	}
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return "", false, errors.New("resolved Station URL is empty")
	}

	return baseURL + route, false, nil
}

func validateRemoteFetchTarget(
	operation string,
	localStationID string,
	targetStationID string,
	actorPTID string,
	targetDeviceID string,
) (string, string, string, error) {
	targetStationID = strings.TrimSpace(targetStationID)
	actorPTID = strings.TrimSpace(actorPTID)
	targetDeviceID = strings.TrimSpace(targetDeviceID)
	if err := validateRemoteStation(
		operation,
		localStationID,
		targetStationID,
	); err != nil {
		return "", "", "", err
	}
	if actorPTID == "" || len(actorPTID) > domain.MaxActorPTIDBytes {
		return "", "", "", domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"actor_ptid",
			"is required and must be bounded",
		)
	}
	if len(targetDeviceID) > domain.MaxDeviceIDBytes {
		return "", "", "", domain.NewError(
			domain.ErrorCodePayloadTooLarge,
			operation,
			"device_id",
			"exceeds the length limit",
		)
	}

	return targetStationID, actorPTID, targetDeviceID, nil
}

func validateRemoteStation(
	operation string,
	localStationID string,
	targetStationID string,
) error {
	localStationID = strings.TrimSpace(localStationID)
	targetStationID = strings.TrimSpace(targetStationID)
	if localStationID == "" ||
		targetStationID == "" ||
		len(targetStationID) > domain.MaxStationIDBytes {
		return domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"target_station_peer_id",
			"is required and must be bounded",
		)
	}
	if targetStationID == localStationID {
		return domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"target_station_peer_id",
			"must identify a remote Station",
		)
	}

	return nil
}

func readBoundedFederationResponse(reader io.Reader) ([]byte, error) {
	limited := io.LimitReader(reader, keyExchangeFederationResponseLimit+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if len(body) > keyExchangeFederationResponseLimit {
		return nil, errors.New("Federation response exceeds the payload limit")
	}

	return body, nil
}

func federationHTTPStatusError(operation string, status int) error {
	code := domain.ErrorCodeDependency
	switch status {
	case http.StatusBadRequest:
		code = domain.ErrorCodeInvalidArgument
	case http.StatusUnauthorized, http.StatusForbidden:
		code = domain.ErrorCodeUnauthorized
	case http.StatusNotFound:
		code = domain.ErrorCodeNotFound
	case http.StatusConflict:
		code = domain.ErrorCodeConflict
	case http.StatusRequestEntityTooLarge:
		code = domain.ErrorCodePayloadTooLarge
	}

	return domain.NewError(
		code,
		operation,
		"remote_status",
		fmt.Sprintf("remote Station returned HTTP %d", status),
	)
}

func directBundleFromProto(
	operation string,
	value *kemodel.DirectKeyBundle,
) (domain.DirectKeyBundle, error) {
	if value == nil {
		return domain.DirectKeyBundle{}, domain.NewError(
			domain.ErrorCodeConflict,
			operation,
			"bundle",
			"is missing",
		)
	}
	device, err := endpointFromCanonicalProto(operation, "bundle.device", value.GetDevice())
	if err != nil {
		return domain.DirectKeyBundle{}, err
	}
	identityKey, err := decodeCanonicalBase64(
		operation,
		"bundle.identity_key_public",
		value.GetIdentityKeyPublic(),
		domain.DirectIdentityPublicKeyBytes,
	)
	if err != nil {
		return domain.DirectKeyBundle{}, err
	}
	signedPreKey, err := decodeCanonicalBase64(
		operation,
		"bundle.signed_pre_key_public",
		value.GetSignedPreKeyPublic(),
		domain.DirectSignedPreKeyPublicBytes,
	)
	if err != nil {
		return domain.DirectKeyBundle{}, err
	}
	signature, err := decodeCanonicalBase64(
		operation,
		"bundle.signed_pre_key_signature",
		value.GetSignedPreKeySignature(),
		domain.DirectSignedPreKeySignatureLen,
	)
	if err != nil {
		return domain.DirectKeyBundle{}, err
	}
	if len(value.GetOneTimePreKeys()) > domain.MaxDirectOneTimePreKeys {
		return domain.DirectKeyBundle{}, domain.NewError(
			domain.ErrorCodePayloadTooLarge,
			operation,
			"bundle.one_time_pre_keys",
			"exceeds the per-request key limit",
		)
	}
	oneTimePreKeys := make(
		[]domain.DirectOneTimePreKey,
		0,
		len(value.GetOneTimePreKeys()),
	)
	for _, key := range value.GetOneTimePreKeys() {
		if key == nil {
			return domain.DirectKeyBundle{}, domain.NewError(
				domain.ErrorCodeConflict,
				operation,
				"bundle.one_time_pre_keys",
				"contains a nil entry",
			)
		}
		publicKey, err := decodeCanonicalBase64(
			operation,
			"bundle.one_time_pre_keys.public_key",
			key.GetPublicKey(),
			domain.DirectOneTimePreKeyPublicBytes,
		)
		if err != nil {
			return domain.DirectKeyBundle{}, err
		}
		oneTimePreKeys = append(oneTimePreKeys, domain.DirectOneTimePreKey{
			KeyID:     key.GetKeyId(),
			PublicKey: publicKey,
		})
	}
	bundle := domain.DirectKeyBundle{
		Device:                device,
		IdentityKeyPublic:     identityKey,
		SignedPreKeyID:        value.GetSignedPreKeyId(),
		SignedPreKeyPublic:    signedPreKey,
		SignedPreKeySignature: signature,
		OneTimePreKeys:        oneTimePreKeys,
		PublishedAt:           time.UnixMilli(value.GetPublishedAtUnixMs()).UTC(),
		SupportedWireVersions: append(
			[]uint32(nil),
			value.GetSupportedWireVersions()...,
		),
	}
	if err := bundle.Validate(operation); err != nil {
		return domain.DirectKeyBundle{}, err
	}

	return bundle, nil
}

func reservationFromProto(
	operation string,
	value *kemodel.MlsKeyPackageReservation,
	planID string,
	homeStationID string,
	planExpiresAt time.Time,
	irreversiblyConsumed bool,
) (domain.MLSKeyPackageReservation, error) {
	if value == nil {
		return domain.MLSKeyPackageReservation{}, domain.NewError(
			domain.ErrorCodeConflict,
			operation,
			"reservation",
			"is missing",
		)
	}
	target, err := endpointFromCanonicalProto(
		operation,
		"reservation.target",
		value.GetTarget(),
	)
	if err != nil {
		return domain.MLSKeyPackageReservation{}, err
	}
	if len(value.GetKeyPackageSha256()) != 32 {
		return domain.MLSKeyPackageReservation{}, domain.NewError(
			domain.ErrorCodeConflict,
			operation,
			"reservation.key_package_sha256",
			"must contain exactly 32 bytes",
		)
	}
	var packageHash [32]byte
	copy(packageHash[:], value.GetKeyPackageSha256())
	reservation := domain.MLSKeyPackageReservation{
		PlanID:               strings.TrimSpace(planID),
		Target:               target,
		PackageID:            strings.TrimSpace(value.GetPackageId()),
		KeyPackage:           append([]byte(nil), value.GetKeyPackage()...),
		PackageHash:          packageHash,
		HomeStation:          strings.TrimSpace(homeStationID),
		PlanExpiresAt:        planExpiresAt.UTC(),
		IrreversiblyConsumed: irreversiblyConsumed,
	}
	if err := reservation.Validate(operation); err != nil {
		return domain.MLSKeyPackageReservation{}, err
	}

	return reservation, nil
}

func endpointFromCanonicalProto(
	operation string,
	field string,
	value *actormodel.ActorDeviceRef,
) (domain.Endpoint, error) {
	if value == nil ||
		value.GetActor() == nil ||
		strings.TrimSpace(value.GetActor().GetPtid()) == "" ||
		strings.TrimSpace(value.GetDeviceId()) == "" {
		return domain.Endpoint{}, domain.NewError(
			domain.ErrorCodeConflict,
			operation,
			field,
			"is incomplete",
		)
	}
	endpoint := domain.Endpoint{
		ActorPTID: strings.TrimSpace(value.GetActor().GetPtid()),
		DeviceID:  strings.TrimSpace(value.GetDeviceId()),
	}
	if err := endpoint.Validate(operation); err != nil {
		return domain.Endpoint{}, err
	}

	return endpoint, nil
}

func decodeCanonicalBase64(
	operation string,
	field string,
	value string,
	expectedBytes int,
) ([]byte, error) {
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(value))
	if err != nil || len(decoded) != expectedBytes {
		return nil, domain.NewError(
			domain.ErrorCodeConflict,
			operation,
			field,
			fmt.Sprintf("must encode exactly %d bytes", expectedBytes),
		)
	}

	return decoded, nil
}

func reservationsEqualBytes(
	left domain.MLSKeyPackageReservation,
	right domain.MLSKeyPackageReservation,
) bool {
	return left.PlanID == right.PlanID &&
		left.Target == right.Target &&
		left.PackageID == right.PackageID &&
		bytes.Equal(left.KeyPackage, right.KeyPackage) &&
		left.PackageHash == right.PackageHash &&
		left.HomeStation == right.HomeStation &&
		left.PlanExpiresAt.Equal(right.PlanExpiresAt) &&
		left.IrreversiblyConsumed == right.IrreversiblyConsumed
}
