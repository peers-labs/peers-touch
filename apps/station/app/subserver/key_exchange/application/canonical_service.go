package application

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"sort"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
)

const (
	uploadDirectOperation    = "key_exchange.upload_direct_bundle"
	fetchDirectOperation     = "key_exchange.fetch_direct_bundles"
	replenishDirectOperation = "key_exchange.replenish_direct_one_time_pre_keys"
	countDirectOperation     = "key_exchange.count_direct_one_time_pre_keys"
	uploadMLSOperation       = "key_exchange.upload_mls_key_package"
	fetchMLSOperation        = "key_exchange.fetch_mls_key_package"
	countMLSOperation        = "key_exchange.count_mls_key_packages"
	reserveMLSOperation      = "key_exchange.reserve_mls_key_package"
	consumeMLSOperation      = "key_exchange.consume_mls_key_packages"
	releaseMLSOperation      = "key_exchange.release_mls_key_packages"
	claimMLSOperation        = "key_exchange.claim_mls_key_package"
	sendDKXOperation         = "key_exchange.send_direct_key_exchange"
)

type DirectMaterialStore interface {
	UploadDirectBundle(
		ctx context.Context,
		bundle domain.DirectKeyBundle,
		publishedAt time.Time,
	) error
	FetchDirectBundles(
		ctx context.Context,
		identity domain.DestructiveReadIdentity,
		actorPTID string,
		activeDeviceIDs []string,
		fetchedAt time.Time,
	) ([]domain.DirectKeyBundle, error)
	ReplayDirectBundles(
		ctx context.Context,
		identity domain.DestructiveReadIdentity,
	) ([]domain.DirectKeyBundle, bool, error)
	ReplenishDirectOneTimePreKeys(
		ctx context.Context,
		device domain.Endpoint,
		keys []domain.DirectOneTimePreKey,
	) error
	CountDirectOneTimePreKeys(
		ctx context.Context,
		device domain.Endpoint,
	) (int64, error)
}

type MLSMaterialStore interface {
	UploadMLSKeyPackage(
		ctx context.Context,
		device domain.Endpoint,
		homeStationID string,
		keyPackage []byte,
		uploadedAt time.Time,
	) (domain.MLSKeyPackage, error)
	FetchAndConsumeMLSKeyPackage(
		ctx context.Context,
		identity domain.DestructiveReadIdentity,
		actorPTID string,
		activeDeviceIDs []string,
		homeStationID string,
		consumedAt time.Time,
	) (*domain.MLSKeyPackage, error)
	ReplayMLSKeyPackage(
		ctx context.Context,
		identity domain.DestructiveReadIdentity,
	) (*domain.MLSKeyPackage, bool, error)
	CountMLSKeyPackages(
		ctx context.Context,
		device domain.Endpoint,
	) (int64, error)
	ReserveMLSKeyPackage(
		ctx context.Context,
		planID string,
		target domain.Endpoint,
		homeStationID string,
		reservedAt time.Time,
		expiresAt time.Time,
	) (domain.MLSKeyPackageReservation, error)
	ConsumeMLSKeyPackages(
		ctx context.Context,
		reservations []domain.MLSKeyPackageReservation,
		consumedAt time.Time,
	) error
	ReleaseMLSKeyPackages(
		ctx context.Context,
		reservations []domain.MLSKeyPackageReservation,
		releasedAt time.Time,
	) error
	ClaimMLSKeyPackageIrreversibly(
		ctx context.Context,
		claim domain.MLSKeyPackageClaim,
		homeStationID string,
		claimedAt time.Time,
	) (domain.MLSKeyPackageReservation, error)
}

type DeviceDirectory interface {
	ResolveActiveDevice(
		ctx context.Context,
		endpoint domain.Endpoint,
	) (domain.DeviceRoute, error)
	ListActiveDevices(
		ctx context.Context,
		actorPTID string,
	) ([]domain.DeviceRoute, error)
}

type ActorHomeStationDirectory interface {
	ResolveActorHomeStationPeerID(
		ctx context.Context,
		actorPTID string,
	) (string, error)
}

type DeviceInboxPort interface {
	EnqueueDirectKeyExchange(
		ctx context.Context,
		envelope domain.DirectKeyExchangeEnvelope,
	) (string, error)
}

type FederationPort interface {
	FetchDirectKeyBundles(
		ctx context.Context,
		targetStationID string,
		identity domain.DestructiveReadIdentity,
		actorPTID string,
		targetDeviceID string,
	) ([]domain.DirectKeyBundle, error)
	FetchMLSKeyPackage(
		ctx context.Context,
		targetStationID string,
		identity domain.DestructiveReadIdentity,
		actorPTID string,
	) (*domain.MLSKeyPackageReservation, error)
	ClaimMLSKeyPackage(
		ctx context.Context,
		targetStationID string,
		claim domain.MLSKeyPackageClaim,
	) (domain.MLSKeyPackageReservation, error)
	EnqueueDirectKeyExchange(
		ctx context.Context,
		targetStationID string,
		envelope domain.DirectKeyExchangeEnvelope,
	) (string, error)
}

type Clock interface {
	Now() time.Time
}

type IDGenerator interface {
	NewID() string
}

type CanonicalService struct {
	directStore  DirectMaterialStore
	mlsStore     MLSMaterialStore
	devices      DeviceDirectory
	actorHomes   ActorHomeStationDirectory
	deviceInbox  DeviceInboxPort
	federation   FederationPort
	clock        Clock
	ids          IDGenerator
	localStation string
}

func NewCanonicalService(
	directStore DirectMaterialStore,
	mlsStore MLSMaterialStore,
	devices DeviceDirectory,
	actorHomes ActorHomeStationDirectory,
	deviceInbox DeviceInboxPort,
	federation FederationPort,
	clock Clock,
	ids IDGenerator,
	localStationID string,
) (*CanonicalService, error) {
	if directStore == nil ||
		mlsStore == nil ||
		devices == nil ||
		actorHomes == nil ||
		deviceInbox == nil ||
		federation == nil ||
		clock == nil ||
		ids == nil ||
		strings.TrimSpace(localStationID) == "" {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			"key_exchange.new_canonical_service",
			"dependencies",
			"all canonical dependencies and the local Station ID are required",
		)
	}
	return &CanonicalService{
		directStore:  directStore,
		mlsStore:     mlsStore,
		devices:      devices,
		actorHomes:   actorHomes,
		deviceInbox:  deviceInbox,
		federation:   federation,
		clock:        clock,
		ids:          ids,
		localStation: strings.TrimSpace(localStationID),
	}, nil
}

func (s *CanonicalService) UploadDirectKeyBundle(
	ctx context.Context,
	authenticated domain.Endpoint,
	bundle domain.DirectKeyBundle,
) error {
	route, err := s.requireLocalActiveEndpoint(
		ctx,
		uploadDirectOperation,
		authenticated,
	)
	if err != nil {
		return err
	}
	if bundle.Device != authenticated {
		return domain.NewError(
			domain.ErrorCodeUnauthorized,
			uploadDirectOperation,
			"device",
			"does not match the authenticated actor and device",
		)
	}
	bundle.Device = route.Endpoint
	versions, err := domain.NormalizeSupportedWireVersions(
		uploadDirectOperation,
		bundle.SupportedWireVersions,
	)
	if err != nil {
		return err
	}
	bundle.SupportedWireVersions = versions
	if err := bundle.Validate(uploadDirectOperation); err != nil {
		return err
	}
	if err := s.directStore.UploadDirectBundle(
		ctx,
		bundle.Clone(),
		s.now(),
	); err != nil {
		return wrapStoreError(uploadDirectOperation, err)
	}
	return nil
}

func (s *CanonicalService) FetchDirectKeyBundles(
	ctx context.Context,
	authenticated domain.Endpoint,
	identity domain.DestructiveReadIdentity,
	actorPTID string,
	targetDeviceID string,
	requestedHomeStationID string,
) ([]domain.DirectKeyBundle, error) {
	if err := identity.Validate(fetchDirectOperation); err != nil {
		return nil, err
	}
	if identity.Requester != authenticated {
		return nil, domain.NewError(
			domain.ErrorCodeUnauthorized,
			fetchDirectOperation,
			"requester",
			"does not match the authenticated endpoint",
		)
	}
	if _, err := s.requireLocalActiveEndpoint(
		ctx,
		fetchDirectOperation,
		authenticated,
	); err != nil {
		return nil, err
	}
	if replay, found, err := s.directStore.ReplayDirectBundles(
		ctx,
		identity,
	); err != nil {
		return nil, wrapStoreError(fetchDirectOperation, err)
	} else if found {
		return replay, nil
	}
	routes, homeStationID, err := s.resolveActorRoutes(
		ctx,
		fetchDirectOperation,
		actorPTID,
		targetDeviceID,
		requestedHomeStationID,
	)
	if err != nil {
		return nil, err
	}

	bundles, err := s.fetchDirectKeyBundlesForRoutes(
		ctx,
		actorPTID,
		targetDeviceID,
		identity,
		routes,
		homeStationID,
	)
	if err != nil {
		return nil, wrapDependencyError(fetchDirectOperation, err)
	}
	return validatedDirectKeyBundles(bundles, routes, actorPTID)
}

// FetchDirectKeyBundlesForPeer serves an authenticated Station peer without
// inventing a local actor/device identity for that peer.
func (s *CanonicalService) FetchDirectKeyBundlesForPeer(
	ctx context.Context,
	identity domain.DestructiveReadIdentity,
	actorPTID string,
	targetDeviceID string,
) ([]domain.DirectKeyBundle, error) {
	if err := identity.Validate(fetchDirectOperation); err != nil {
		return nil, err
	}
	if replay, found, err := s.directStore.ReplayDirectBundles(
		ctx,
		identity,
	); err != nil {
		return nil, wrapStoreError(fetchDirectOperation, err)
	} else if found {
		return replay, nil
	}
	routes, homeStationID, err := s.resolveActorRoutes(
		ctx,
		fetchDirectOperation,
		actorPTID,
		targetDeviceID,
		s.localStation,
	)
	if err != nil {
		return nil, err
	}
	if homeStationID != s.localStation {
		return nil, domain.NewError(
			domain.ErrorCodeUnauthorized,
			fetchDirectOperation,
			"home_station_peer_id",
			"does not identify this Home Station",
		)
	}
	bundles, err := s.fetchLocalDirectKeyBundles(
		ctx,
		identity,
		actorPTID,
		routes,
	)
	if err != nil {
		return nil, wrapDependencyError(fetchDirectOperation, err)
	}
	return validatedDirectKeyBundles(bundles, routes, actorPTID)
}

func (s *CanonicalService) fetchDirectKeyBundlesForRoutes(
	ctx context.Context,
	actorPTID string,
	targetDeviceID string,
	identity domain.DestructiveReadIdentity,
	routes []domain.DeviceRoute,
	homeStationID string,
) ([]domain.DirectKeyBundle, error) {
	if homeStationID != s.localStation {
		return s.federation.FetchDirectKeyBundles(
			ctx,
			homeStationID,
			identity,
			strings.TrimSpace(actorPTID),
			strings.TrimSpace(targetDeviceID),
		)
	}
	return s.fetchLocalDirectKeyBundles(ctx, identity, actorPTID, routes)
}

func (s *CanonicalService) fetchLocalDirectKeyBundles(
	ctx context.Context,
	identity domain.DestructiveReadIdentity,
	actorPTID string,
	routes []domain.DeviceRoute,
) ([]domain.DirectKeyBundle, error) {
	activeDeviceIDs := make([]string, 0, len(routes))
	for _, route := range routes {
		activeDeviceIDs = append(activeDeviceIDs, route.Endpoint.DeviceID)
	}
	return s.directStore.FetchDirectBundles(
		ctx,
		identity,
		strings.TrimSpace(actorPTID),
		activeDeviceIDs,
		s.now(),
	)
}

func validatedDirectKeyBundles(
	bundles []domain.DirectKeyBundle,
	routes []domain.DeviceRoute,
	actorPTID string,
) ([]domain.DirectKeyBundle, error) {
	if len(bundles) == 0 {
		return nil, domain.NewError(
			domain.ErrorCodeNotFound,
			fetchDirectOperation,
			"actor",
			"has no available Direct key bundle",
		)
	}
	if err := validateFetchedDirectBundles(
		bundles,
		routes,
		actorPTID,
	); err != nil {
		return nil, err
	}
	result := make([]domain.DirectKeyBundle, 0, len(bundles))
	for _, bundle := range bundles {
		result = append(result, bundle.Clone())
	}
	return result, nil
}

func (s *CanonicalService) ReplenishDirectOneTimePreKeys(
	ctx context.Context,
	authenticated domain.Endpoint,
	device domain.Endpoint,
	keys []domain.DirectOneTimePreKey,
) error {
	if _, err := s.requireLocalActiveEndpoint(
		ctx,
		replenishDirectOperation,
		authenticated,
	); err != nil {
		return err
	}
	if device != authenticated {
		return domain.NewError(
			domain.ErrorCodeUnauthorized,
			replenishDirectOperation,
			"device",
			"does not match the authenticated actor and device",
		)
	}
	bundle := domain.DirectKeyBundle{
		Device:                device,
		IdentityKeyPublic:     make([]byte, domain.DirectIdentityPublicKeyBytes),
		SignedPreKeyID:        1,
		SignedPreKeyPublic:    make([]byte, domain.DirectSignedPreKeyPublicBytes),
		SignedPreKeySignature: make([]byte, domain.DirectSignedPreKeySignatureLen),
		OneTimePreKeys:        keys,
		SupportedWireVersions: []uint32{0},
	}
	if err := bundle.Validate(replenishDirectOperation); err != nil {
		return err
	}
	if err := s.directStore.ReplenishDirectOneTimePreKeys(
		ctx,
		device,
		cloneDirectKeys(keys),
	); err != nil {
		return wrapStoreError(replenishDirectOperation, err)
	}
	return nil
}

func (s *CanonicalService) CountDirectOneTimePreKeys(
	ctx context.Context,
	authenticated domain.Endpoint,
	device domain.Endpoint,
) (int64, error) {
	if _, err := s.requireLocalActiveEndpoint(
		ctx,
		countDirectOperation,
		authenticated,
	); err != nil {
		return 0, err
	}
	if device != authenticated {
		return 0, domain.NewError(
			domain.ErrorCodeUnauthorized,
			countDirectOperation,
			"device",
			"does not match the authenticated actor and device",
		)
	}
	count, err := s.directStore.CountDirectOneTimePreKeys(ctx, device)
	if err != nil {
		return 0, wrapStoreError(countDirectOperation, err)
	}
	return count, nil
}

func (s *CanonicalService) UploadMLSKeyPackage(
	ctx context.Context,
	authenticated domain.Endpoint,
	device domain.Endpoint,
	keyPackage []byte,
) (domain.MLSKeyPackage, error) {
	route, err := s.requireLocalActiveEndpoint(
		ctx,
		uploadMLSOperation,
		authenticated,
	)
	if err != nil {
		return domain.MLSKeyPackage{}, err
	}
	if device != authenticated {
		return domain.MLSKeyPackage{}, domain.NewError(
			domain.ErrorCodeUnauthorized,
			uploadMLSOperation,
			"device",
			"does not match the authenticated actor and device",
		)
	}
	if err := validateMLSKeyPackagePayload(
		uploadMLSOperation,
		keyPackage,
	); err != nil {
		return domain.MLSKeyPackage{}, err
	}
	keyPackageRecord, err := s.mlsStore.UploadMLSKeyPackage(
		ctx,
		route.Endpoint,
		route.HomeStationID,
		append([]byte(nil), keyPackage...),
		s.now(),
	)
	if err != nil {
		return domain.MLSKeyPackage{}, wrapStoreError(uploadMLSOperation, err)
	}
	if err := keyPackageRecord.Validate(uploadMLSOperation); err != nil {
		return domain.MLSKeyPackage{}, err
	}
	return keyPackageRecord.Clone(), nil
}

func (s *CanonicalService) FetchMLSKeyPackage(
	ctx context.Context,
	authenticated domain.Endpoint,
	identity domain.DestructiveReadIdentity,
	actorPTID string,
	requestedHomeStationID string,
) (*domain.MLSKeyPackageReservation, error) {
	if err := identity.Validate(fetchMLSOperation); err != nil {
		return nil, err
	}
	if identity.Requester != authenticated {
		return nil, domain.NewError(
			domain.ErrorCodeUnauthorized,
			fetchMLSOperation,
			"requester",
			"does not match the authenticated endpoint",
		)
	}
	if _, err := s.requireLocalActiveEndpoint(
		ctx,
		fetchMLSOperation,
		authenticated,
	); err != nil {
		return nil, err
	}
	if replay, found, err := s.mlsStore.ReplayMLSKeyPackage(
		ctx,
		identity,
	); err != nil {
		return nil, wrapStoreError(fetchMLSOperation, err)
	} else if found {
		return replayedMLSReservation(replay), nil
	}
	routes, homeStationID, err := s.resolveActorRoutes(
		ctx,
		fetchMLSOperation,
		actorPTID,
		"",
		requestedHomeStationID,
	)
	if err != nil {
		return nil, err
	}
	if homeStationID != s.localStation {
		reservation, err := s.federation.FetchMLSKeyPackage(
			ctx,
			homeStationID,
			identity,
			strings.TrimSpace(actorPTID),
		)
		if err != nil {
			return nil, wrapDependencyError(fetchMLSOperation, err)
		}
		if reservation == nil {
			return nil, nil
		}
		if err := validateFederatedReservation(
			fetchMLSOperation,
			*reservation,
			routes,
			homeStationID,
		); err != nil {
			return nil, err
		}
		result := reservation.Clone()
		return &result, nil
	}

	return s.fetchLocalMLSKeyPackage(ctx, identity, actorPTID, routes)
}

// FetchMLSKeyPackageForPeer consumes one package for an authenticated Station
// peer while requiring the target actor to be owned by this Home Station.
func (s *CanonicalService) FetchMLSKeyPackageForPeer(
	ctx context.Context,
	identity domain.DestructiveReadIdentity,
	actorPTID string,
) (*domain.MLSKeyPackageReservation, error) {
	if err := identity.Validate(fetchMLSOperation); err != nil {
		return nil, err
	}
	if replay, found, err := s.mlsStore.ReplayMLSKeyPackage(
		ctx,
		identity,
	); err != nil {
		return nil, wrapStoreError(fetchMLSOperation, err)
	} else if found {
		return replayedMLSReservation(replay), nil
	}
	routes, homeStationID, err := s.resolveActorRoutes(
		ctx,
		fetchMLSOperation,
		actorPTID,
		"",
		s.localStation,
	)
	if err != nil {
		return nil, err
	}
	if homeStationID != s.localStation {
		return nil, domain.NewError(
			domain.ErrorCodeUnauthorized,
			fetchMLSOperation,
			"home_station_peer_id",
			"does not identify this Home Station",
		)
	}
	return s.fetchLocalMLSKeyPackage(ctx, identity, actorPTID, routes)
}

func (s *CanonicalService) fetchLocalMLSKeyPackage(
	ctx context.Context,
	identity domain.DestructiveReadIdentity,
	actorPTID string,
	routes []domain.DeviceRoute,
) (*domain.MLSKeyPackageReservation, error) {
	activeDeviceIDs := make([]string, 0, len(routes))
	for _, route := range routes {
		activeDeviceIDs = append(activeDeviceIDs, route.Endpoint.DeviceID)
	}
	keyPackage, err := s.mlsStore.FetchAndConsumeMLSKeyPackage(
		ctx,
		identity,
		strings.TrimSpace(actorPTID),
		activeDeviceIDs,
		s.localStation,
		s.now(),
	)
	if err != nil {
		return nil, wrapStoreError(fetchMLSOperation, err)
	}
	if keyPackage == nil {
		return nil, nil
	}
	if err := keyPackage.Validate(fetchMLSOperation); err != nil {
		return nil, err
	}
	reservation := reservationFromPackage(
		"",
		*keyPackage,
		time.Time{},
		true,
	)
	return &reservation, nil
}

func (s *CanonicalService) CountMLSKeyPackages(
	ctx context.Context,
	authenticated domain.Endpoint,
	device domain.Endpoint,
) (int64, error) {
	if _, err := s.requireLocalActiveEndpoint(
		ctx,
		countMLSOperation,
		authenticated,
	); err != nil {
		return 0, err
	}
	if device != authenticated {
		return 0, domain.NewError(
			domain.ErrorCodeUnauthorized,
			countMLSOperation,
			"device",
			"does not match the authenticated actor and device",
		)
	}
	count, err := s.mlsStore.CountMLSKeyPackages(ctx, device)
	if err != nil {
		return 0, wrapStoreError(countMLSOperation, err)
	}
	return count, nil
}

func (s *CanonicalService) ReserveMLSKeyPackage(
	ctx context.Context,
	requestID string,
	authorityPlanID string,
	target domain.Endpoint,
	expiresAt time.Time,
) (domain.MLSKeyPackageReservation, error) {
	route, err := s.resolveActiveDevice(ctx, reserveMLSOperation, target)
	if err != nil {
		return domain.MLSKeyPackageReservation{}, err
	}
	return s.reserveMLSKeyPackageForRoute(
		ctx,
		requestID,
		authorityPlanID,
		target,
		route.HomeStationID,
		expiresAt,
		false,
	)
}

// ReserveMLSKeyPackageForVerifiedRoute accepts only a server-verified Actor
// route. Conversation resolves that route from a signed endpoint manifest;
// Key Exchange remains the sole owner of local reservation and remote claim.
func (s *CanonicalService) ReserveMLSKeyPackageForVerifiedRoute(
	ctx context.Context,
	requestID string,
	authorityPlanID string,
	target domain.Endpoint,
	homeStationID string,
	expiresAt time.Time,
) (domain.MLSKeyPackageReservation, error) {
	return s.reserveMLSKeyPackageForRoute(
		ctx,
		requestID,
		authorityPlanID,
		target,
		homeStationID,
		expiresAt,
		true,
	)
}

func (s *CanonicalService) reserveMLSKeyPackageForRoute(
	ctx context.Context,
	requestID string,
	authorityPlanID string,
	target domain.Endpoint,
	homeStationID string,
	expiresAt time.Time,
	verifyLocal bool,
) (domain.MLSKeyPackageReservation, error) {
	if err := domain.ValidateRequestID(reserveMLSOperation, requestID); err != nil {
		return domain.MLSKeyPackageReservation{}, err
	}
	if err := validateAuthorityPlan(
		reserveMLSOperation,
		authorityPlanID,
		expiresAt,
		s.now(),
	); err != nil {
		return domain.MLSKeyPackageReservation{}, err
	}
	homeStationID = strings.TrimSpace(homeStationID)
	if homeStationID == "" {
		return domain.MLSKeyPackageReservation{}, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			reserveMLSOperation,
			"home_station_id",
			"is required",
		)
	}
	if verifyLocal && homeStationID == s.localStation {
		route, err := s.resolveActiveDevice(ctx, reserveMLSOperation, target)
		if err != nil {
			return domain.MLSKeyPackageReservation{}, err
		}
		if route.HomeStationID != homeStationID {
			return domain.MLSKeyPackageReservation{}, domain.NewError(
				domain.ErrorCodeConflict,
				reserveMLSOperation,
				"home_station_id",
				"does not match the active local device route",
			)
		}
	}
	if homeStationID != s.localStation {
		claim := domain.MLSKeyPackageClaim{
			AuthenticatedAuthorityStation: s.localStation,
			RequestID:                     requestID,
			AuthorityPlanID:               strings.TrimSpace(authorityPlanID),
			AuthorityStationID:            s.localStation,
			Target:                        target,
			PlanExpiresAt:                 expiresAt.UTC(),
		}
		reservation, err := s.federation.ClaimMLSKeyPackage(
			ctx,
			homeStationID,
			claim,
		)
		if err != nil {
			return domain.MLSKeyPackageReservation{},
				wrapDependencyError(reserveMLSOperation, err)
		}
		if err := validateClaimedReservation(
			reserveMLSOperation,
			reservation,
			claim,
			homeStationID,
		); err != nil {
			return domain.MLSKeyPackageReservation{}, err
		}
		return reservation.Clone(), nil
	}
	reservation, err := s.mlsStore.ReserveMLSKeyPackage(
		ctx,
		strings.TrimSpace(authorityPlanID),
		target,
		s.localStation,
		s.now(),
		expiresAt.UTC(),
	)
	if err != nil {
		return domain.MLSKeyPackageReservation{},
			wrapStoreError(reserveMLSOperation, err)
	}
	if err := reservation.Validate(reserveMLSOperation); err != nil {
		return domain.MLSKeyPackageReservation{}, err
	}
	return reservation.Clone(), nil
}

func (s *CanonicalService) ConsumeMLSKeyPackages(
	ctx context.Context,
	reservations []domain.MLSKeyPackageReservation,
) error {
	local, err := validateReservationSet(
		consumeMLSOperation,
		reservations,
		s.localStation,
	)
	if err != nil {
		return err
	}
	if len(local) == 0 {
		return nil
	}
	if err := s.mlsStore.ConsumeMLSKeyPackages(
		ctx,
		local,
		s.now(),
	); err != nil {
		return wrapStoreError(consumeMLSOperation, err)
	}
	return nil
}

func (s *CanonicalService) ReleaseMLSKeyPackages(
	ctx context.Context,
	reservations []domain.MLSKeyPackageReservation,
) error {
	local, err := validateReservationSet(
		releaseMLSOperation,
		reservations,
		s.localStation,
	)
	if err != nil {
		return err
	}
	if len(local) == 0 {
		return nil
	}
	if err := s.mlsStore.ReleaseMLSKeyPackages(
		ctx,
		local,
		s.now(),
	); err != nil {
		return wrapStoreError(releaseMLSOperation, err)
	}
	return nil
}

func (s *CanonicalService) ClaimMLSKeyPackage(
	ctx context.Context,
	claim domain.MLSKeyPackageClaim,
) (domain.MLSKeyPackageReservation, error) {
	now := s.now()
	if strings.TrimSpace(claim.AuthenticatedAuthorityStation) == "" ||
		strings.TrimSpace(claim.AuthenticatedAuthorityStation) !=
			strings.TrimSpace(claim.AuthorityStationID) {
		return domain.MLSKeyPackageReservation{}, domain.NewError(
			domain.ErrorCodeUnauthorized,
			claimMLSOperation,
			"authority_station_peer_id",
			"does not match the authenticated Federation peer",
		)
	}
	if err := domain.ValidateRequestID(
		claimMLSOperation,
		claim.RequestID,
	); err != nil {
		return domain.MLSKeyPackageReservation{}, err
	}
	if claim.RequestSHA256 == ([sha256.Size]byte{}) {
		return domain.MLSKeyPackageReservation{}, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			claimMLSOperation,
			"request_sha256",
			"exact request hash is required",
		)
	}
	if strings.TrimSpace(claim.AuthorityStationID) == s.localStation {
		return domain.MLSKeyPackageReservation{}, domain.NewError(
			domain.ErrorCodeUnauthorized,
			claimMLSOperation,
			"authority_station_peer_id",
			"must identify a remote authority Station",
		)
	}
	if err := validateFederatedAuthorityPlan(
		claimMLSOperation,
		claim.AuthorityPlanID,
		claim.PlanExpiresAt,
		now,
	); err != nil {
		return domain.MLSKeyPackageReservation{}, err
	}
	route, err := s.resolveActiveDevice(ctx, claimMLSOperation, claim.Target)
	if err != nil {
		return domain.MLSKeyPackageReservation{}, err
	}
	if route.HomeStationID != s.localStation {
		return domain.MLSKeyPackageReservation{}, domain.NewError(
			domain.ErrorCodeUnauthorized,
			claimMLSOperation,
			"target",
			"is not owned by this Home Station",
		)
	}
	claim.Target = route.Endpoint
	claim.AuthorityPlanID = strings.TrimSpace(claim.AuthorityPlanID)
	claim.AuthorityStationID = strings.TrimSpace(claim.AuthorityStationID)
	claim.AuthenticatedAuthorityStation = strings.TrimSpace(
		claim.AuthenticatedAuthorityStation,
	)
	claim.PlanExpiresAt = claim.PlanExpiresAt.UTC()

	reservation, err := s.mlsStore.ClaimMLSKeyPackageIrreversibly(
		ctx,
		claim,
		s.localStation,
		now,
	)
	if err != nil {
		return domain.MLSKeyPackageReservation{},
			wrapStoreError(claimMLSOperation, err)
	}
	if err := validateClaimedReservation(
		claimMLSOperation,
		reservation,
		claim,
		s.localStation,
	); err != nil {
		return domain.MLSKeyPackageReservation{}, err
	}
	return reservation.Clone(), nil
}

func (s *CanonicalService) SendDirectKeyExchange(
	ctx context.Context,
	authenticatedSender domain.Endpoint,
	command domain.DirectKeyExchangeCommand,
) (string, error) {
	senderRoute, err := s.requireLocalActiveEndpoint(
		ctx,
		sendDKXOperation,
		authenticatedSender,
	)
	if err != nil {
		return "", err
	}
	recipientRoute, err := s.resolveActiveDevice(
		ctx,
		sendDKXOperation,
		command.Recipient,
	)
	if err != nil {
		return "", err
	}
	if senderRoute.Endpoint == recipientRoute.Endpoint {
		return "", domain.NewError(
			domain.ErrorCodeInvalidArgument,
			sendDKXOperation,
			"recipient",
			"must differ from the sender endpoint",
		)
	}
	requestedStation := strings.TrimSpace(
		command.RequestedRecipientHomeStation,
	)
	if requestedStation != "" &&
		requestedStation != recipientRoute.HomeStationID {
		return "", domain.NewError(
			domain.ErrorCodeConflict,
			sendDKXOperation,
			"recipient_home_station_peer_id",
			"does not match the active recipient device",
		)
	}
	envelope := domain.DirectKeyExchangeEnvelope{
		EnvelopeID:           strings.TrimSpace(s.ids.NewID()),
		Sender:               senderRoute.Endpoint,
		Recipient:            recipientRoute.Endpoint,
		RecipientHomeStation: recipientRoute.HomeStationID,
		SessionID:            strings.TrimSpace(command.SessionID),
		Kind:                 command.Kind,
		OpaqueKeyMaterial:    append([]byte(nil), command.OpaqueKeyMaterial...),
		ConversationID:       strings.TrimSpace(command.ConversationID),
	}
	envelope.IdempotencyKey = directKeyExchangeIdempotencyKey(envelope)
	if err := envelope.Validate(sendDKXOperation); err != nil {
		return "", err
	}

	var envelopeID string
	if recipientRoute.HomeStationID == s.localStation {
		envelopeID, err = s.deviceInbox.EnqueueDirectKeyExchange(
			ctx,
			envelope.Clone(),
		)
	} else {
		envelopeID, err = s.federation.EnqueueDirectKeyExchange(
			ctx,
			recipientRoute.HomeStationID,
			envelope.Clone(),
		)
	}
	if err != nil {
		return "", wrapDependencyError(sendDKXOperation, err)
	}
	envelopeID = strings.TrimSpace(envelopeID)
	if envelopeID == "" {
		return "", domain.NewError(
			domain.ErrorCodeDependency,
			sendDKXOperation,
			"envelope_id",
			"delivery port returned an empty envelope ID",
		)
	}
	return envelopeID, nil
}

func (s *CanonicalService) requireLocalActiveEndpoint(
	ctx context.Context,
	operation string,
	endpoint domain.Endpoint,
) (domain.DeviceRoute, error) {
	route, err := s.resolveActiveDevice(ctx, operation, endpoint)
	if err != nil {
		if domain.IsCode(err, domain.ErrorCodeNotFound) {
			return domain.DeviceRoute{}, domain.NewError(
				domain.ErrorCodeUnauthorized,
				operation,
				"device",
				"endpoint is not active",
			)
		}
		return domain.DeviceRoute{}, err
	}
	if route.HomeStationID != s.localStation {
		return domain.DeviceRoute{}, domain.NewError(
			domain.ErrorCodeUnauthorized,
			operation,
			"device",
			"is not owned by this Home Station",
		)
	}
	return route, nil
}

func (s *CanonicalService) resolveActiveDevice(
	ctx context.Context,
	operation string,
	endpoint domain.Endpoint,
) (domain.DeviceRoute, error) {
	if err := endpoint.Validate(operation); err != nil {
		return domain.DeviceRoute{}, err
	}
	route, err := s.devices.ResolveActiveDevice(ctx, endpoint)
	if err != nil {
		return domain.DeviceRoute{}, wrapDependencyError(operation, err)
	}
	if err := route.Validate(operation); err != nil {
		return domain.DeviceRoute{}, err
	}
	if route.Endpoint != endpoint {
		return domain.DeviceRoute{}, domain.NewError(
			domain.ErrorCodeConflict,
			operation,
			"device",
			"directory result does not match the requested actor and device",
		)
	}
	return route, nil
}

func (s *CanonicalService) resolveActorRoutes(
	ctx context.Context,
	operation string,
	actorPTID string,
	targetDeviceID string,
	requestedHomeStationID string,
) ([]domain.DeviceRoute, string, error) {
	actorPTID = strings.TrimSpace(actorPTID)
	if actorPTID == "" || len(actorPTID) > domain.MaxActorPTIDBytes {
		return nil, "", domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"actor.ptid",
			"is required and must be bounded",
		)
	}
	targetDeviceID = strings.TrimSpace(targetDeviceID)
	requestedHomeStationID = strings.TrimSpace(requestedHomeStationID)
	if len(requestedHomeStationID) > domain.MaxStationIDBytes {
		return nil, "", domain.NewError(
			domain.ErrorCodePayloadTooLarge,
			operation,
			"home_station_peer_id",
			"exceeds the length limit",
		)
	}
	homeStationID, err := s.actorHomes.ResolveActorHomeStationPeerID(
		ctx,
		actorPTID,
	)
	if err != nil {
		return nil, "", wrapDependencyError(operation, err)
	}
	homeStationID = strings.TrimSpace(homeStationID)
	if homeStationID == "" || len(homeStationID) > domain.MaxStationIDBytes {
		return nil, "", domain.NewError(
			domain.ErrorCodeConflict,
			operation,
			"home_station_peer_id",
			"Actor Identity returned an invalid Home Station",
		)
	}
	if requestedHomeStationID != "" &&
		requestedHomeStationID != homeStationID {
		return nil, "", domain.NewError(
			domain.ErrorCodeConflict,
			operation,
			"home_station_peer_id",
			"does not match the Actor Identity route",
		)
	}
	if targetDeviceID != "" && homeStationID != s.localStation {
		route := domain.DeviceRoute{
			Endpoint: domain.Endpoint{
				ActorPTID: actorPTID,
				DeviceID:  targetDeviceID,
			},
			HomeStationID: homeStationID,
		}
		if err := route.Validate(operation); err != nil {
			return nil, "", err
		}
		return []domain.DeviceRoute{route}, homeStationID, nil
	}

	var routes []domain.DeviceRoute
	if targetDeviceID != "" {
		route, err := s.resolveActiveDevice(
			ctx,
			operation,
			domain.Endpoint{
				ActorPTID: actorPTID,
				DeviceID:  targetDeviceID,
			},
		)
		if err != nil {
			return nil, "", err
		}
		routes = []domain.DeviceRoute{route}
	} else {
		listed, err := s.devices.ListActiveDevices(ctx, actorPTID)
		if err != nil {
			return nil, "", wrapDependencyError(operation, err)
		}
		routes = append(routes, listed...)
	}
	if len(routes) == 0 {
		return nil, "", domain.NewError(
			domain.ErrorCodeNotFound,
			operation,
			"actor",
			"has no active devices",
		)
	}

	sort.Slice(routes, func(i, j int) bool {
		return routes[i].Endpoint.Key() < routes[j].Endpoint.Key()
	})
	seenDevices := make(map[string]struct{}, len(routes))
	for _, route := range routes {
		if err := route.Validate(operation); err != nil {
			return nil, "", err
		}
		if route.Endpoint.ActorPTID != actorPTID {
			return nil, "", domain.NewError(
				domain.ErrorCodeConflict,
				operation,
				"actor",
				"directory returned a device for another actor",
			)
		}
		if _, duplicate := seenDevices[route.Endpoint.DeviceID]; duplicate {
			return nil, "", domain.NewError(
				domain.ErrorCodeConflict,
				operation,
				"device",
				"directory returned a duplicate device",
			)
		}
		seenDevices[route.Endpoint.DeviceID] = struct{}{}
		if route.HomeStationID != homeStationID {
			return nil, "", domain.NewError(
				domain.ErrorCodeConflict,
				operation,
				"home_station_peer_id",
				"active actor devices disagree on Home Station ownership",
			)
		}
	}
	return routes, homeStationID, nil
}

func (s *CanonicalService) now() time.Time {
	return s.clock.Now().UTC().Truncate(time.Microsecond)
}

func validateFetchedDirectBundles(
	bundles []domain.DirectKeyBundle,
	routes []domain.DeviceRoute,
	actorPTID string,
) error {
	allowed := make(map[string]struct{}, len(routes))
	for _, route := range routes {
		allowed[route.Endpoint.Key()] = struct{}{}
	}
	seen := make(map[string]struct{}, len(bundles))
	for _, bundle := range bundles {
		if err := bundle.Validate(fetchDirectOperation); err != nil {
			return err
		}
		if len(bundle.OneTimePreKeys) > 1 {
			return domain.NewError(
				domain.ErrorCodeConflict,
				fetchDirectOperation,
				"bundle.one_time_pre_keys",
				"contains more than one consumed one-time pre-key",
			)
		}
		if bundle.Device.ActorPTID != strings.TrimSpace(actorPTID) {
			return domain.NewError(
				domain.ErrorCodeConflict,
				fetchDirectOperation,
				"bundle.device.actor.ptid",
				"does not match the requested actor",
			)
		}
		if _, ok := allowed[bundle.Device.Key()]; !ok {
			return domain.NewError(
				domain.ErrorCodeConflict,
				fetchDirectOperation,
				"bundle.device",
				"is not an active requested endpoint",
			)
		}
		if _, duplicate := seen[bundle.Device.Key()]; duplicate {
			return domain.NewError(
				domain.ErrorCodeConflict,
				fetchDirectOperation,
				"bundle.device",
				"was returned more than once",
			)
		}
		seen[bundle.Device.Key()] = struct{}{}
	}
	return nil
}

func validateFederatedReservation(
	operation string,
	reservation domain.MLSKeyPackageReservation,
	routes []domain.DeviceRoute,
	homeStationID string,
) error {
	if err := reservation.Validate(operation); err != nil {
		return err
	}
	if reservation.HomeStation != homeStationID ||
		!reservation.IrreversiblyConsumed {
		return domain.NewError(
			domain.ErrorCodeConflict,
			operation,
			"reservation",
			"does not prove one-time consumption by the target Home Station",
		)
	}
	for _, route := range routes {
		if reservation.Target == route.Endpoint {
			return nil
		}
	}
	return domain.NewError(
		domain.ErrorCodeConflict,
		operation,
		"reservation.target",
		"is not an active requested endpoint",
	)
}

func validateClaimedReservation(
	operation string,
	reservation domain.MLSKeyPackageReservation,
	claim domain.MLSKeyPackageClaim,
	homeStationID string,
) error {
	if err := reservation.Validate(operation); err != nil {
		return err
	}
	if reservation.PlanID != claim.AuthorityPlanID ||
		reservation.Target != claim.Target ||
		reservation.HomeStation != homeStationID ||
		!reservation.PlanExpiresAt.Equal(claim.PlanExpiresAt) ||
		!reservation.IrreversiblyConsumed {
		return domain.NewError(
			domain.ErrorCodeConflict,
			operation,
			"reservation",
			"does not match the authenticated authority plan",
		)
	}
	return nil
}

func validateReservationSet(
	operation string,
	reservations []domain.MLSKeyPackageReservation,
	localStation string,
) ([]domain.MLSKeyPackageReservation, error) {
	seen := make(map[string]struct{}, len(reservations))
	local := make([]domain.MLSKeyPackageReservation, 0, len(reservations))
	for _, reservation := range reservations {
		if err := reservation.Validate(operation); err != nil {
			return nil, err
		}
		identity := strings.Join(
			[]string{
				reservation.PlanID,
				reservation.Target.Key(),
				reservation.PackageID,
			},
			"\x00",
		)
		if _, duplicate := seen[identity]; duplicate {
			return nil, domain.NewError(
				domain.ErrorCodeConflict,
				operation,
				"reservations",
				"contains a duplicate reservation",
			)
		}
		seen[identity] = struct{}{}
		if reservation.HomeStation == localStation &&
			!reservation.IrreversiblyConsumed {
			local = append(local, reservation.Clone())
		}
	}
	return local, nil
}

func validateMLSKeyPackagePayload(operation string, keyPackage []byte) error {
	switch {
	case len(keyPackage) == 0:
		return domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"key_package",
			"is required",
		)
	case len(keyPackage) > domain.MaxMLSKeyPackageBytes:
		return domain.NewError(
			domain.ErrorCodePayloadTooLarge,
			operation,
			"key_package",
			"exceeds the payload limit",
		)
	default:
		return nil
	}
}

func validateAuthorityPlan(
	operation string,
	planID string,
	expiresAt time.Time,
	now time.Time,
) error {
	if strings.TrimSpace(planID) == "" {
		return domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"authority_plan_id",
			"is required",
		)
	}
	expiresAt = expiresAt.UTC()
	if !expiresAt.After(now) ||
		expiresAt.After(now.Add(domain.MaxAuthorityPlanTTL)) {
		return domain.NewError(
			domain.ErrorCodePlanExpired,
			operation,
			"plan_expires_at",
			"must be in the bounded active plan window",
		)
	}
	return nil
}

func validateFederatedAuthorityPlan(
	operation string,
	planID string,
	expiresAt time.Time,
	now time.Time,
) error {
	if strings.TrimSpace(planID) == "" {
		return domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"authority_plan_id",
			"is required",
		)
	}
	expiresAt = expiresAt.UTC()
	if !expiresAt.After(now.Add(-domain.FederationClockSkewBudget)) ||
		expiresAt.After(
			now.
				Add(domain.MaxAuthorityPlanTTL).
				Add(domain.FederationClockSkewBudget),
		) {
		return domain.NewError(
			domain.ErrorCodePlanExpired,
			operation,
			"plan_expires_at",
			"is outside the bounded Federation clock window",
		)
	}
	return nil
}

func reservationFromPackage(
	planID string,
	keyPackage domain.MLSKeyPackage,
	expiresAt time.Time,
	consumed bool,
) domain.MLSKeyPackageReservation {
	return domain.MLSKeyPackageReservation{
		PlanID:               planID,
		Target:               keyPackage.Device,
		PackageID:            keyPackage.PackageID,
		KeyPackage:           append([]byte(nil), keyPackage.KeyPackage...),
		PackageHash:          keyPackage.PackageHash,
		HomeStation:          keyPackage.HomeStation,
		PlanExpiresAt:        expiresAt.UTC(),
		IrreversiblyConsumed: consumed,
	}
}

func replayedMLSReservation(
	keyPackage *domain.MLSKeyPackage,
) *domain.MLSKeyPackageReservation {
	if keyPackage == nil {
		return nil
	}
	reservation := reservationFromPackage(
		"",
		*keyPackage,
		time.Time{},
		true,
	)

	return &reservation
}

func directKeyExchangeIdempotencyKey(
	envelope domain.DirectKeyExchangeEnvelope,
) string {
	hash := sha256.New()
	for _, field := range [][]byte{
		[]byte("peers-touch/key-exchange/dkx"),
		[]byte(envelope.SessionID),
		[]byte(envelope.Sender.ActorPTID),
		[]byte(envelope.Sender.DeviceID),
		[]byte(envelope.Recipient.ActorPTID),
		[]byte(envelope.Recipient.DeviceID),
		[]byte{byte(envelope.Kind)},
		[]byte(envelope.ConversationID),
		envelope.OpaqueKeyMaterial,
	} {
		var size [8]byte
		binary.BigEndian.PutUint64(size[:], uint64(len(field)))
		_, _ = hash.Write(size[:])
		_, _ = hash.Write(field)
	}
	return "dkx:" + hex.EncodeToString(hash.Sum(nil))
}

func wrapStoreError(operation string, err error) error {
	if err == nil {
		return nil
	}
	if domain.CodeOf(err) != "" {
		return err
	}
	return domain.WrapError(domain.ErrorCodeInternal, operation, err)
}

func wrapDependencyError(operation string, err error) error {
	if err == nil {
		return nil
	}
	if domain.CodeOf(err) != "" {
		return err
	}
	return domain.WrapError(domain.ErrorCodeDependency, operation, err)
}

func cloneDirectKeys(
	keys []domain.DirectOneTimePreKey,
) []domain.DirectOneTimePreKey {
	result := make([]domain.DirectOneTimePreKey, 0, len(keys))
	for _, key := range keys {
		result = append(result, key.Clone())
	}
	return result
}
