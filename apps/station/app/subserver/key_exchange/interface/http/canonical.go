package httpinterface

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	kemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
)

type CanonicalAPI struct {
	service *application.CanonicalService
}

func NewCanonicalAPI(
	service *application.CanonicalService,
) (*CanonicalAPI, error) {
	if service == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			"key_exchange.new_canonical_api",
			"service",
			"is required",
		)
	}
	return &CanonicalAPI{service: service}, nil
}

func (a *CanonicalAPI) UploadDirectKeyBundle(
	ctx context.Context,
	authenticatedActorPTID string,
	authenticatedDeviceID string,
	request *kemodel.UploadDirectKeyBundleRequest,
) (*kemodel.UploadDirectKeyBundleResponse, error) {
	const operation = "key_exchange.api.upload_direct_bundle"
	if request == nil {
		return nil, missingRequest(operation)
	}
	device, err := endpointFromProto(operation, "device", request.GetDevice())
	if err != nil {
		return nil, err
	}
	identityKey, err := decodeBase64(
		operation,
		"identity_key_public",
		request.GetIdentityKeyPublic(),
		domain.DirectIdentityPublicKeyBytes,
	)
	if err != nil {
		return nil, err
	}
	signedPreKey, err := decodeBase64(
		operation,
		"signed_pre_key_public",
		request.GetSignedPreKeyPublic(),
		domain.DirectSignedPreKeyPublicBytes,
	)
	if err != nil {
		return nil, err
	}
	signedPreKeySignature, err := decodeBase64(
		operation,
		"signed_pre_key_signature",
		request.GetSignedPreKeySignature(),
		domain.DirectSignedPreKeySignatureLen,
	)
	if err != nil {
		return nil, err
	}
	oneTimePreKeys, err := directOneTimePreKeysFromProto(
		operation,
		request.GetOneTimePreKeys(),
	)
	if err != nil {
		return nil, err
	}
	if err := a.service.UploadDirectKeyBundle(
		ctx,
		authenticatedEndpoint(
			authenticatedActorPTID,
			authenticatedDeviceID,
		),
		domain.DirectKeyBundle{
			Device:                device,
			IdentityKeyPublic:     identityKey,
			SignedPreKeyID:        request.GetSignedPreKeyId(),
			SignedPreKeyPublic:    signedPreKey,
			SignedPreKeySignature: signedPreKeySignature,
			OneTimePreKeys:        oneTimePreKeys,
			SupportedWireVersions: append(
				[]uint32(nil),
				request.GetSupportedWireVersions()...,
			),
		},
	); err != nil {
		return nil, err
	}
	return &kemodel.UploadDirectKeyBundleResponse{}, nil
}

func (a *CanonicalAPI) FetchDirectKeyBundles(
	ctx context.Context,
	authenticatedActorPTID string,
	authenticatedDeviceID string,
	request *kemodel.FetchDirectKeyBundlesRequest,
) (*kemodel.FetchDirectKeyBundlesResponse, error) {
	const operation = "key_exchange.api.fetch_direct_bundles"
	if request == nil {
		return nil, missingRequest(operation)
	}
	authenticated := authenticatedEndpoint(
		authenticatedActorPTID,
		authenticatedDeviceID,
	)
	identity, err := destructiveReadIdentity(
		operation,
		authenticated,
		request.GetRequester(),
		request.GetRequestId(),
		request,
	)
	if err != nil {
		return nil, err
	}
	actorPTID, err := actorPTIDFromProto(
		operation,
		"actor",
		request.GetActor(),
	)
	if err != nil {
		return nil, err
	}
	bundles, err := a.service.FetchDirectKeyBundles(
		ctx,
		authenticated,
		identity,
		actorPTID,
		request.GetTargetDeviceId(),
		request.GetHomeStationPeerId(),
	)
	if err != nil {
		return nil, err
	}
	return directBundlesResponse(bundles), nil
}

// FetchDirectKeyBundlesForPeer serves the canonical fetch contract after the
// transport layer has authenticated and bound the Federation peer claims.
func (a *CanonicalAPI) FetchDirectKeyBundlesForPeer(
	ctx context.Context,
	request *kemodel.FetchDirectKeyBundlesRequest,
) (*kemodel.FetchDirectKeyBundlesResponse, error) {
	const operation = "key_exchange.api.fetch_direct_bundles_for_peer"
	if request == nil {
		return nil, missingRequest(operation)
	}
	identity, err := destructiveReadIdentity(
		operation,
		domain.Endpoint{},
		request.GetRequester(),
		request.GetRequestId(),
		request,
	)
	if err != nil {
		return nil, err
	}
	actorPTID, err := actorPTIDFromProto(
		operation,
		"actor",
		request.GetActor(),
	)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(request.GetHomeStationPeerId()) == "" {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"home_station_peer_id",
			"is required for a Federation request",
		)
	}
	bundles, err := a.service.FetchDirectKeyBundlesForPeer(
		ctx,
		identity,
		actorPTID,
		request.GetTargetDeviceId(),
	)
	if err != nil {
		return nil, err
	}
	return directBundlesResponse(bundles), nil
}

func (a *CanonicalAPI) ReplenishDirectOneTimePreKeys(
	ctx context.Context,
	authenticatedActorPTID string,
	authenticatedDeviceID string,
	request *kemodel.ReplenishDirectOneTimePreKeysRequest,
) (*kemodel.ReplenishDirectOneTimePreKeysResponse, error) {
	const operation = "key_exchange.api.replenish_direct_one_time_pre_keys"
	if request == nil {
		return nil, missingRequest(operation)
	}
	device, err := endpointFromProto(operation, "device", request.GetDevice())
	if err != nil {
		return nil, err
	}
	keys, err := directOneTimePreKeysFromProto(
		operation,
		request.GetOneTimePreKeys(),
	)
	if err != nil {
		return nil, err
	}
	if err := a.service.ReplenishDirectOneTimePreKeys(
		ctx,
		authenticatedEndpoint(
			authenticatedActorPTID,
			authenticatedDeviceID,
		),
		device,
		keys,
	); err != nil {
		return nil, err
	}
	return &kemodel.ReplenishDirectOneTimePreKeysResponse{}, nil
}

func (a *CanonicalAPI) CountDirectOneTimePreKeys(
	ctx context.Context,
	authenticatedActorPTID string,
	authenticatedDeviceID string,
	request *kemodel.CountDirectOneTimePreKeysRequest,
) (*kemodel.CountDirectOneTimePreKeysResponse, error) {
	const operation = "key_exchange.api.count_direct_one_time_pre_keys"
	if request == nil {
		return nil, missingRequest(operation)
	}
	device, err := endpointFromProto(operation, "device", request.GetDevice())
	if err != nil {
		return nil, err
	}
	count, err := a.service.CountDirectOneTimePreKeys(
		ctx,
		authenticatedEndpoint(
			authenticatedActorPTID,
			authenticatedDeviceID,
		),
		device,
	)
	if err != nil {
		return nil, err
	}
	return &kemodel.CountDirectOneTimePreKeysResponse{Count: count}, nil
}

func (a *CanonicalAPI) UploadMLSKeyPackage(
	ctx context.Context,
	authenticatedActorPTID string,
	authenticatedDeviceID string,
	request *kemodel.UploadMlsKeyPackageRequest,
) (*kemodel.UploadMlsKeyPackageResponse, error) {
	const operation = "key_exchange.api.upload_mls_key_package"
	if request == nil {
		return nil, missingRequest(operation)
	}
	device, err := endpointFromProto(operation, "device", request.GetDevice())
	if err != nil {
		return nil, err
	}
	if len(request.GetKeyPackage()) > domain.MaxMLSKeyPackageBytes {
		return nil, domain.NewError(
			domain.ErrorCodePayloadTooLarge,
			operation,
			"key_package",
			"exceeds the payload limit",
		)
	}
	keyPackage, err := a.service.UploadMLSKeyPackage(
		ctx,
		authenticatedEndpoint(
			authenticatedActorPTID,
			authenticatedDeviceID,
		),
		device,
		append([]byte(nil), request.GetKeyPackage()...),
	)
	if err != nil {
		return nil, err
	}
	return &kemodel.UploadMlsKeyPackageResponse{
		PackageId:        keyPackage.PackageID,
		KeyPackageSha256: append([]byte(nil), keyPackage.PackageHash[:]...),
	}, nil
}

func (a *CanonicalAPI) FetchMLSKeyPackage(
	ctx context.Context,
	authenticatedActorPTID string,
	authenticatedDeviceID string,
	request *kemodel.FetchMlsKeyPackageRequest,
) (*kemodel.FetchMlsKeyPackageResponse, error) {
	const operation = "key_exchange.api.fetch_mls_key_package"
	if request == nil {
		return nil, missingRequest(operation)
	}
	authenticated := authenticatedEndpoint(
		authenticatedActorPTID,
		authenticatedDeviceID,
	)
	identity, err := destructiveReadIdentity(
		operation,
		authenticated,
		request.GetRequester(),
		request.GetRequestId(),
		request,
	)
	if err != nil {
		return nil, err
	}
	actorPTID, err := actorPTIDFromProto(
		operation,
		"actor",
		request.GetActor(),
	)
	if err != nil {
		return nil, err
	}
	reservation, err := a.service.FetchMLSKeyPackage(
		ctx,
		authenticated,
		identity,
		actorPTID,
		request.GetHomeStationPeerId(),
	)
	if err != nil {
		return nil, err
	}
	if reservation == nil {
		return &kemodel.FetchMlsKeyPackageResponse{
			Available: false,
			HomeStationPeerId: strings.TrimSpace(
				request.GetHomeStationPeerId(),
			),
		}, nil
	}
	return &kemodel.FetchMlsKeyPackageResponse{
		Reservation:       reservationToProto(*reservation),
		Available:         true,
		HomeStationPeerId: reservation.HomeStation,
	}, nil
}

// FetchMLSKeyPackageForPeer serves the canonical fetch contract after the
// transport layer has authenticated and bound the Federation peer claims.
func (a *CanonicalAPI) FetchMLSKeyPackageForPeer(
	ctx context.Context,
	request *kemodel.FetchMlsKeyPackageRequest,
) (*kemodel.FetchMlsKeyPackageResponse, error) {
	const operation = "key_exchange.api.fetch_mls_key_package_for_peer"
	if request == nil {
		return nil, missingRequest(operation)
	}
	identity, err := destructiveReadIdentity(
		operation,
		domain.Endpoint{},
		request.GetRequester(),
		request.GetRequestId(),
		request,
	)
	if err != nil {
		return nil, err
	}
	actorPTID, err := actorPTIDFromProto(
		operation,
		"actor",
		request.GetActor(),
	)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(request.GetHomeStationPeerId()) == "" {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"home_station_peer_id",
			"is required for a Federation request",
		)
	}
	reservation, err := a.service.FetchMLSKeyPackageForPeer(
		ctx,
		identity,
		actorPTID,
	)
	if err != nil {
		return nil, err
	}
	if reservation == nil {
		return &kemodel.FetchMlsKeyPackageResponse{
			Available: false,
			HomeStationPeerId: strings.TrimSpace(
				request.GetHomeStationPeerId(),
			),
		}, nil
	}
	return &kemodel.FetchMlsKeyPackageResponse{
		Reservation:       reservationToProto(*reservation),
		Available:         true,
		HomeStationPeerId: reservation.HomeStation,
	}, nil
}

func (a *CanonicalAPI) CountMLSKeyPackages(
	ctx context.Context,
	authenticatedActorPTID string,
	authenticatedDeviceID string,
	request *kemodel.CountMlsKeyPackagesRequest,
) (*kemodel.CountMlsKeyPackagesResponse, error) {
	const operation = "key_exchange.api.count_mls_key_packages"
	if request == nil {
		return nil, missingRequest(operation)
	}
	device, err := endpointFromProto(operation, "device", request.GetDevice())
	if err != nil {
		return nil, err
	}
	count, err := a.service.CountMLSKeyPackages(
		ctx,
		authenticatedEndpoint(
			authenticatedActorPTID,
			authenticatedDeviceID,
		),
		device,
	)
	if err != nil {
		return nil, err
	}
	return &kemodel.CountMlsKeyPackagesResponse{Count: count}, nil
}

func (a *CanonicalAPI) ClaimMLSKeyPackage(
	ctx context.Context,
	authenticatedAuthorityStationID string,
	request *kemodel.ClaimMlsKeyPackageRequest,
) (*kemodel.ClaimMlsKeyPackageResponse, error) {
	const operation = "key_exchange.api.claim_mls_key_package"
	if request == nil {
		return nil, missingRequest(operation)
	}
	target, err := endpointFromProto(
		operation,
		"target",
		request.GetTarget(),
	)
	if err != nil {
		return nil, err
	}
	if request.GetPlanExpiresAt() == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"plan_expires_at",
			"is required",
		)
	}
	if err := request.GetPlanExpiresAt().CheckValid(); err != nil {
		return nil, domain.WrapError(
			domain.ErrorCodeInvalidArgument,
			operation,
			err,
		)
	}
	requestSHA256, err := exactRequestSHA256(operation, request)
	if err != nil {
		return nil, err
	}
	reservation, err := a.service.ClaimMLSKeyPackage(
		ctx,
		domain.MLSKeyPackageClaim{
			AuthenticatedAuthorityStation: strings.TrimSpace(
				authenticatedAuthorityStationID,
			),
			RequestID:     request.GetRequestId(),
			RequestSHA256: requestSHA256,
			AuthorityPlanID: strings.TrimSpace(
				request.GetAuthorityPlanId(),
			),
			AuthorityStationID: strings.TrimSpace(
				request.GetAuthorityStationPeerId(),
			),
			Target:        target,
			PlanExpiresAt: request.GetPlanExpiresAt().AsTime(),
		},
	)
	if err != nil {
		return nil, err
	}
	return &kemodel.ClaimMlsKeyPackageResponse{
		Reservation:          reservationToProto(reservation),
		HomeStationPeerId:    reservation.HomeStation,
		IrreversiblyConsumed: reservation.IrreversiblyConsumed,
	}, nil
}

func (a *CanonicalAPI) SendDirectKeyExchange(
	ctx context.Context,
	authenticatedActorPTID string,
	authenticatedDeviceID string,
	request *kemodel.SendDirectKeyExchangeRequest,
) (*kemodel.SendDirectKeyExchangeResponse, error) {
	const operation = "key_exchange.api.send_direct_key_exchange"
	if request == nil {
		return nil, missingRequest(operation)
	}
	recipient, err := endpointFromProto(
		operation,
		"recipient",
		request.GetRecipient(),
	)
	if err != nil {
		return nil, err
	}
	kind, err := directKeyExchangeKindFromProto(operation, request.GetKind())
	if err != nil {
		return nil, err
	}
	if len(request.GetOpaqueKeyMaterial()) >
		domain.MaxDirectKeyExchangePayload {
		return nil, domain.NewError(
			domain.ErrorCodePayloadTooLarge,
			operation,
			"opaque_key_material",
			"exceeds the payload limit",
		)
	}
	envelopeID, err := a.service.SendDirectKeyExchange(
		ctx,
		authenticatedEndpoint(
			authenticatedActorPTID,
			authenticatedDeviceID,
		),
		domain.DirectKeyExchangeCommand{
			Recipient: recipient,
			RequestedRecipientHomeStation: strings.TrimSpace(
				request.GetRecipientHomeStationPeerId(),
			),
			SessionID: strings.TrimSpace(request.GetSessionId()),
			Kind:      kind,
			OpaqueKeyMaterial: append(
				[]byte(nil),
				request.GetOpaqueKeyMaterial()...,
			),
			ConversationID: strings.TrimSpace(
				request.GetConversationId(),
			),
		},
	)
	if err != nil {
		return nil, err
	}
	return &kemodel.SendDirectKeyExchangeResponse{
		EnvelopeId: envelopeID,
	}, nil
}

func authenticatedEndpoint(actorPTID string, deviceID string) domain.Endpoint {
	return domain.Endpoint{
		ActorPTID: strings.TrimSpace(actorPTID),
		DeviceID:  strings.TrimSpace(deviceID),
	}
}

func endpointFromProto(
	operation string,
	field string,
	value *actormodel.ActorDeviceRef,
) (domain.Endpoint, error) {
	if value == nil {
		return domain.Endpoint{}, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			field,
			"is required",
		)
	}
	actorPTID, err := actorPTIDFromProto(
		operation,
		field+".actor",
		value.GetActor(),
	)
	if err != nil {
		return domain.Endpoint{}, err
	}
	endpoint := domain.Endpoint{
		ActorPTID: actorPTID,
		DeviceID:  strings.TrimSpace(value.GetDeviceId()),
	}
	if err := endpoint.Validate(operation); err != nil {
		return domain.Endpoint{}, err
	}
	return endpoint, nil
}

func actorPTIDFromProto(
	operation string,
	field string,
	value *actormodel.ActorRef,
) (string, error) {
	if value == nil || strings.TrimSpace(value.GetPtid()) == "" {
		return "", domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			field+".ptid",
			"is required",
		)
	}
	ptid := strings.TrimSpace(value.GetPtid())
	if len(ptid) > domain.MaxActorPTIDBytes {
		return "", domain.NewError(
			domain.ErrorCodePayloadTooLarge,
			operation,
			field+".ptid",
			"exceeds the length limit",
		)
	}
	return ptid, nil
}

func directOneTimePreKeysFromProto(
	operation string,
	values []*kemodel.DirectOneTimePreKey,
) ([]domain.DirectOneTimePreKey, error) {
	if len(values) > domain.MaxDirectOneTimePreKeys {
		return nil, domain.NewError(
			domain.ErrorCodePayloadTooLarge,
			operation,
			"one_time_pre_keys",
			"exceeds the per-request key limit",
		)
	}
	result := make([]domain.DirectOneTimePreKey, 0, len(values))
	for _, value := range values {
		if value == nil {
			return nil, domain.NewError(
				domain.ErrorCodeInvalidArgument,
				operation,
				"one_time_pre_keys",
				"contains a nil entry",
			)
		}
		publicKey, err := decodeBase64(
			operation,
			"one_time_pre_keys.public_key",
			value.GetPublicKey(),
			domain.DirectOneTimePreKeyPublicBytes,
		)
		if err != nil {
			return nil, err
		}
		result = append(result, domain.DirectOneTimePreKey{
			KeyID:     value.GetKeyId(),
			PublicKey: publicKey,
		})
	}
	return result, nil
}

func directBundleToProto(
	bundle domain.DirectKeyBundle,
) *kemodel.DirectKeyBundle {
	keys := make([]*kemodel.DirectOneTimePreKey, 0, len(bundle.OneTimePreKeys))
	for _, key := range bundle.OneTimePreKeys {
		keys = append(keys, &kemodel.DirectOneTimePreKey{
			KeyId:     key.KeyID,
			PublicKey: base64.StdEncoding.EncodeToString(key.PublicKey),
		})
	}
	return &kemodel.DirectKeyBundle{
		Device: &actormodel.ActorDeviceRef{
			Actor:    &actormodel.ActorRef{Ptid: bundle.Device.ActorPTID},
			DeviceId: bundle.Device.DeviceID,
		},
		IdentityKeyPublic: base64.StdEncoding.EncodeToString(
			bundle.IdentityKeyPublic,
		),
		SignedPreKeyId: bundle.SignedPreKeyID,
		SignedPreKeyPublic: base64.StdEncoding.EncodeToString(
			bundle.SignedPreKeyPublic,
		),
		SignedPreKeySignature: base64.StdEncoding.EncodeToString(
			bundle.SignedPreKeySignature,
		),
		OneTimePreKeys:    keys,
		PublishedAtUnixMs: bundle.PublishedAt.UnixMilli(),
		SupportedWireVersions: append(
			[]uint32(nil),
			bundle.SupportedWireVersions...,
		),
	}
}

func directBundlesResponse(
	bundles []domain.DirectKeyBundle,
) *kemodel.FetchDirectKeyBundlesResponse {
	response := &kemodel.FetchDirectKeyBundlesResponse{
		Bundles: make([]*kemodel.DirectKeyBundle, 0, len(bundles)),
	}
	for _, bundle := range bundles {
		response.Bundles = append(response.Bundles, directBundleToProto(bundle))
	}
	return response
}

func reservationToProto(
	reservation domain.MLSKeyPackageReservation,
) *kemodel.MlsKeyPackageReservation {
	return &kemodel.MlsKeyPackageReservation{
		Target: &actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: reservation.Target.ActorPTID,
			},
			DeviceId: reservation.Target.DeviceID,
		},
		PackageId:        reservation.PackageID,
		KeyPackage:       append([]byte(nil), reservation.KeyPackage...),
		KeyPackageSha256: append([]byte(nil), reservation.PackageHash[:]...),
	}
}

func destructiveReadIdentity(
	operation string,
	authenticated domain.Endpoint,
	requester *actormodel.ActorDeviceRef,
	requestID string,
	request proto.Message,
) (domain.DestructiveReadIdentity, error) {
	endpoint, err := endpointFromProto(operation, "requester", requester)
	if err != nil {
		return domain.DestructiveReadIdentity{}, err
	}
	if authenticated != (domain.Endpoint{}) && endpoint != authenticated {
		return domain.DestructiveReadIdentity{}, domain.NewError(
			domain.ErrorCodeUnauthorized,
			operation,
			"requester",
			"does not match the authenticated endpoint",
		)
	}
	requestSHA256, err := exactRequestSHA256(operation, request)
	if err != nil {
		return domain.DestructiveReadIdentity{}, err
	}
	identity := domain.DestructiveReadIdentity{
		RequestID:     requestID,
		Requester:     endpoint,
		RequestSHA256: requestSHA256,
	}
	if err := identity.Validate(operation); err != nil {
		return domain.DestructiveReadIdentity{}, err
	}

	return identity, nil
}

func exactRequestSHA256(
	operation string,
	request proto.Message,
) ([sha256.Size]byte, error) {
	requestBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(request)
	if err != nil {
		return [sha256.Size]byte{}, domain.WrapError(
			domain.ErrorCodeInternal,
			operation,
			err,
		)
	}

	return sha256.Sum256(requestBytes), nil
}

func directKeyExchangeKindFromProto(
	operation string,
	value kemodel.DirectKeyExchangePayloadKind,
) (domain.DirectKeyExchangeKind, error) {
	var kind domain.DirectKeyExchangeKind
	switch value {
	case kemodel.DirectKeyExchangePayloadKind_DIRECT_KEY_EXCHANGE_PAYLOAD_KIND_PREKEY_BUNDLE:
		kind = domain.DirectKeyExchangeKindPreKeyBundle
	case kemodel.DirectKeyExchangePayloadKind_DIRECT_KEY_EXCHANGE_PAYLOAD_KIND_INITIAL_MESSAGE:
		kind = domain.DirectKeyExchangeKindInitialMessage
	case kemodel.DirectKeyExchangePayloadKind_DIRECT_KEY_EXCHANGE_PAYLOAD_KIND_RATCHET_KEY_UPDATE:
		kind = domain.DirectKeyExchangeKindRatchetKeyUpdate
	default:
		return domain.DirectKeyExchangeKindUnspecified, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"kind",
			"is unsupported",
		)
	}
	return kind, nil
}

func decodeBase64(
	operation string,
	field string,
	value string,
	maxDecodedBytes int,
) ([]byte, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			field,
			"is required",
		)
	}
	if len(value) > base64.StdEncoding.EncodedLen(maxDecodedBytes) {
		return nil, domain.NewError(
			domain.ErrorCodePayloadTooLarge,
			operation,
			field,
			"exceeds the encoded payload limit",
		)
	}
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return nil, domain.WrapError(
			domain.ErrorCodeInvalidArgument,
			operation,
			err,
		)
	}
	return decoded, nil
}

func missingRequest(operation string) error {
	return domain.NewError(
		domain.ErrorCodeInvalidArgument,
		operation,
		"request",
		"is required",
	)
}
