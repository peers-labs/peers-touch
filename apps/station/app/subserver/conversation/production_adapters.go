package conversation

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/delivery"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	attachmentinfra "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/attachment"
	deliveryinfra "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/delivery"
	conversationfederation "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/federation"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/persistence"
	federationdomain "github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	federationinfra "github.com/peers-labs/peers-touch/station/app/subserver/federation/infrastructure"
	keyexchangedomain "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	keyexchangeinfra "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/infrastructure"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/gorm"
)

// ProductionTransactionalAdapterFactoryConfig carries process-scoped policy
// while Bind supplies the command transaction. No adapter opens another store.
type ProductionTransactionalAdapterFactoryConfig struct {
	LocalStationID          valueobject.StationID
	DeviceInboxLimits       delivery.QueueLimits
	FederationSigner        federationdelivery.Signer
	Clock                   federationdelivery.Clock
	FederationFrameLifetime time.Duration
	KeyExchange             productionKeyPackageReservationService
}

type productionKeyPackageReservationService interface {
	ReserveMLSKeyPackage(
		context.Context,
		string,
		string,
		keyexchangedomain.Endpoint,
		time.Time,
	) (keyexchangedomain.MLSKeyPackageReservation, error)
}

// ProductionTransactionalAdapterFactory binds every Conversation DDD side
// effect to the exact GORM transaction owned by the authority unit of work.
type ProductionTransactionalAdapterFactory struct {
	localStation      valueobject.StationID
	deviceInboxLimits delivery.QueueLimits
	clock             federationdelivery.Clock
	federationSender  *conversationfederation.Sender
	keyExchange       productionKeyPackageReservationService
}

// NewProductionTransactionalAdapterFactory validates production dependencies
// once so transaction binding cannot silently substitute fallback owners.
func NewProductionTransactionalAdapterFactory(
	config ProductionTransactionalAdapterFactoryConfig,
) (*ProductionTransactionalAdapterFactory, error) {
	localStationID := string(config.LocalStationID)
	if strings.TrimSpace(localStationID) == "" ||
		localStationID != strings.TrimSpace(localStationID) ||
		config.DeviceInboxLimits.MaxUnackedItems <= 0 ||
		config.DeviceInboxLimits.MaxUnackedBytes <= 0 ||
		config.FederationSigner == nil ||
		config.Clock == nil ||
		config.KeyExchange == nil ||
		config.FederationFrameLifetime <= 0 {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"production_adapters.new_factory",
			"dependencies",
			"local Station, queue limits, Federation signer, clock, frame lifetime, and Key Exchange are required",
		)
	}

	sender, err := conversationfederation.NewSender(
		localStationID,
		config.FederationSigner,
		config.Clock,
		config.FederationFrameLifetime,
	)
	if err != nil {
		return nil, fmt.Errorf(
			"conversation production adapters: create Federation sender: %w",
			err,
		)
	}

	return &ProductionTransactionalAdapterFactory{
		localStation:      config.LocalStationID,
		deviceInboxLimits: config.DeviceInboxLimits,
		clock:             config.Clock,
		federationSender:  sender,
		keyExchange:       config.KeyExchange,
	}, nil
}

// Bind constructs owner-backed adapters over tx without migration, network
// fallback, or a second authoritative repository.
func (f *ProductionTransactionalAdapterFactory) Bind(
	tx *gorm.DB,
) (persistence.TransactionalAdapters, error) {
	if f == nil || tx == nil {
		return persistence.TransactionalAdapters{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"production_adapters.bind",
			"transaction",
			"is required",
		)
	}

	identity := &productionIdentityDirectory{db: tx}
	federation := &productionFederationDirectory{
		membership: federationinfra.NewRepos(tx).Membership,
	}

	deviceInboxRepository, err := deliveryinfra.NewRepository(tx, f.deviceInboxLimits)
	if err != nil {
		return persistence.TransactionalAdapters{}, fmt.Errorf(
			"conversation production adapters: bind Device Inbox repository: %w",
			err,
		)
	}
	deviceInbox, err := deliveryinfra.NewWriter(deviceInboxRepository)
	if err != nil {
		return persistence.TransactionalAdapters{}, fmt.Errorf(
			"conversation production adapters: bind Device Inbox writer: %w",
			err,
		)
	}

	sharedOutbox, err := federationdelivery.NewGORMRepository(tx, f.clock)
	if err != nil {
		return persistence.TransactionalAdapters{}, fmt.Errorf(
			"conversation production adapters: bind shared Federation outbox: %w",
			err,
		)
	}
	federationOutbox := &productionFederationOutboxWriter{
		sender: f.federationSender,
		outbox: sharedOutbox,
	}

	deliveryCommitments, err := deliveryinfra.NewAuthorityLedgerWriter(tx)
	if err != nil {
		return persistence.TransactionalAdapters{}, fmt.Errorf(
			"conversation production adapters: bind delivery ledger: %w",
			err,
		)
	}
	objectGrants, err := attachmentinfra.NewRepository(tx)
	if err != nil {
		return persistence.TransactionalAdapters{}, fmt.Errorf(
			"conversation production adapters: bind attachment grants: %w",
			err,
		)
	}
	keyPackageStore, err := keyexchangeinfra.NewCanonicalStore(tx)
	if err != nil {
		return persistence.TransactionalAdapters{}, fmt.Errorf(
			"conversation production adapters: bind Key Exchange reservations: %w",
			err,
		)
	}

	return persistence.TransactionalAdapters{
		Identity:            identity,
		Federation:          federation,
		DeviceInbox:         deviceInbox,
		FederationOutbox:    federationOutbox,
		DeliveryCommitments: deliveryCommitments,
		ObjectGrants:        objectGrants,
		KeyPackageReservations: &productionKeyPackageReservations{
			db:           tx,
			store:        keyPackageStore,
			identity:     identity,
			clock:        f.clock,
			localStation: f.localStation,
			keyExchange:  f.keyExchange,
		},
	}, nil
}

type productionIdentityDirectory struct {
	db *gorm.DB
}

func (d *productionIdentityDirectory) IsActive(
	ctx context.Context,
	endpoint valueobject.Endpoint,
) (bool, error) {
	if d == nil || d.db == nil || endpoint.Validate() != nil {
		return false, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"production_identity.is_active",
			"endpoint",
			"is invalid",
		)
	}

	var count int64
	err := d.db.WithContext(ctx).
		Model(&touchactor.DeviceRecord{}).
		Where(
			"ptid = ? AND device_id = ? AND revoked = ? "+
				"AND verification_source <> ? AND length(public_key) = ?",
			string(endpoint.Actor),
			string(endpoint.Device),
			false,
			int32(
				actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_UNSPECIFIED,
			),
			ed25519.PublicKeySize,
		).
		Count(&count).Error
	if err != nil {
		return false, fmt.Errorf(
			"conversation production identity: check active endpoint %s: %w",
			endpoint.Key(),
			err,
		)
	}

	return count == 1, nil
}

func (d *productionIdentityDirectory) ActorIdentityPublicKey(
	ctx context.Context,
	actor valueobject.PTID,
) ([]byte, error) {
	if d == nil || d.db == nil ||
		strings.TrimSpace(string(actor)) == "" ||
		string(actor) != strings.TrimSpace(string(actor)) {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"production_identity.actor_public_key",
			"actor",
			"is invalid",
		)
	}

	var identity touchactor.ActorIdentityRecord
	err := d.db.WithContext(ctx).
		Where("ptid = ?", string(actor)).
		First(&identity).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, actorKeyUnavailable(
			"production_identity.actor_public_key",
			"actor identity key was not found",
		)
	}
	if err != nil {
		return nil, fmt.Errorf(
			"conversation production identity: load actor key %s: %w",
			actor,
			err,
		)
	}
	if len(identity.PublicKey) != ed25519.PublicKeySize {
		return nil, actorKeyUnavailable(
			"production_identity.actor_public_key",
			"actor identity key is malformed",
		)
	}

	return append([]byte(nil), identity.PublicKey...), nil
}

func (d *productionIdentityDirectory) VerifyDeviceSignature(
	ctx context.Context,
	endpoint valueobject.Endpoint,
	signingKeyID string,
	payload []byte,
	signature []byte,
) (ports.DeviceSignatureVerification, error) {
	if d == nil || d.db == nil ||
		endpoint.Validate() != nil ||
		strings.TrimSpace(signingKeyID) == "" ||
		signingKeyID != strings.TrimSpace(signingKeyID) ||
		len(payload) == 0 {
		return ports.DeviceSignatureVerification{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"production_identity.verify_device_signature",
			"signature_input",
			"is incomplete",
		)
	}

	var record touchactor.DeviceRecord
	err := d.db.WithContext(ctx).
		Where(
			"ptid = ? AND device_id = ? AND signing_key_id = ?",
			string(endpoint.Actor),
			string(endpoint.Device),
			signingKeyID,
		).
		First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ports.DeviceSignatureVerification{}, actorKeyUnavailable(
			"production_identity.verify_device_signature",
			"verified device signing key was not found",
		)
	}
	if err != nil {
		return ports.DeviceSignatureVerification{}, fmt.Errorf(
			"conversation production identity: load device key %s: %w",
			endpoint.Key(),
			err,
		)
	}
	if record.VerificationSource == int32(
		actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_UNSPECIFIED,
	) || len(record.PublicKey) != ed25519.PublicKeySize {
		return ports.DeviceSignatureVerification{}, actorKeyUnavailable(
			"production_identity.verify_device_signature",
			"device signing key is not identity-verified",
		)
	}
	if len(signature) != ed25519.SignatureSize ||
		!ed25519.Verify(ed25519.PublicKey(record.PublicKey), payload, signature) {
		return ports.DeviceSignatureVerification{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalSignature,
			"production_identity.verify_device_signature",
			"signature",
			"does not match the verified actor-device key",
		)
	}

	return ports.DeviceSignatureVerification{KeyRevoked: record.Revoked}, nil
}

func (d *productionIdentityDirectory) ListActiveEndpoints(
	ctx context.Context,
	actors []valueobject.PTID,
) ([]ports.EndpointRoute, error) {
	canonicalActors, err := canonicalActorIDs(actors)
	if err != nil {
		return nil, err
	}
	if len(canonicalActors) == 0 {
		return []ports.EndpointRoute{}, nil
	}

	var records []touchactor.DeviceRecord
	err = d.db.WithContext(ctx).
		Where(
			"ptid IN ? AND revoked = ? AND verification_source <> ? "+
				"AND length(public_key) = ?",
			canonicalActors,
			false,
			int32(
				actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_UNSPECIFIED,
			),
			ed25519.PublicKeySize,
		).
		Order("ptid ASC, device_id ASC").
		Find(&records).Error
	if err != nil {
		return nil, fmt.Errorf(
			"conversation production identity: list active endpoints: %w",
			err,
		)
	}

	routes := make([]ports.EndpointRoute, 0, len(records))
	for _, record := range records {
		endpoint := valueobject.Endpoint{
			Actor:  valueobject.PTID(record.Ptid),
			Device: valueobject.DeviceID(record.DeviceID),
		}
		if endpoint.Validate() != nil ||
			strings.TrimSpace(record.HomeStationPeerID) == "" ||
			record.HomeStationPeerID != strings.TrimSpace(record.HomeStationPeerID) {
			return nil, actorKeyUnavailable(
				"production_identity.list_active_endpoints",
				"active device route is incomplete",
			)
		}
		routes = append(routes, ports.EndpointRoute{
			Endpoint:    endpoint,
			HomeStation: valueobject.StationID(record.HomeStationPeerID),
		})
	}

	return routes, nil
}

func (d *productionIdentityDirectory) activeRoute(
	ctx context.Context,
	endpoint valueobject.Endpoint,
) (ports.EndpointRoute, error) {
	routes, err := d.ListActiveEndpoints(
		ctx,
		[]valueobject.PTID{endpoint.Actor},
	)
	if err != nil {
		return ports.EndpointRoute{}, err
	}
	for _, route := range routes {
		if route.Endpoint == endpoint {
			return route, nil
		}
	}

	return ports.EndpointRoute{}, conversationdomain.NewError(
		conversationdomain.ErrorCodeUnauthorized,
		"production_identity.active_route",
		"endpoint",
		"is not an active verified actor device",
	)
}

func canonicalActorIDs(actors []valueobject.PTID) ([]string, error) {
	seen := make(map[string]struct{}, len(actors))
	result := make([]string, 0, len(actors))
	for _, actor := range actors {
		value := string(actor)
		if strings.TrimSpace(value) == "" || value != strings.TrimSpace(value) {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeInvalidArgument,
				"production_identity.list_active_endpoints",
				"actors",
				"contains an invalid PTID",
			)
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)

	return result, nil
}

func actorKeyUnavailable(operation string, message string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeActorKeyUnavailable,
		operation,
		"actor_signing_key",
		message,
	)
}

type productionFederationDirectory struct {
	membership federationdomain.MembershipRepository
}

func (d *productionFederationDirectory) IsActiveStation(
	ctx context.Context,
	federationID valueobject.FederationID,
	station valueobject.StationID,
) (bool, error) {
	if d == nil || d.membership == nil ||
		strings.TrimSpace(string(federationID)) == "" ||
		strings.TrimSpace(string(station)) == "" {
		return false, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"production_federation.is_active_station",
			"membership",
			"federation and Station are required",
		)
	}

	record, err := d.membership.GetByStation(
		ctx,
		string(federationID),
		string(station),
	)
	if err != nil {
		return false, fmt.Errorf(
			"conversation production Federation: load membership: %w",
			err,
		)
	}

	return record != nil && strings.EqualFold(record.Status, "active"), nil
}

type productionFederationOutboxWriter struct {
	sender *conversationfederation.Sender
	outbox federationdelivery.OutboxWriter
}

func (w *productionFederationOutboxWriter) Enqueue(
	ctx context.Context,
	intent ports.FederationOutboxIntent,
) error {
	if w == nil || w.sender == nil || w.outbox == nil {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"production_federation_outbox.enqueue",
			"dependencies",
			"sender and transaction-bound shared outbox are required",
		)
	}
	if _, err := w.sender.EnqueueDeviceDelivery(ctx, w.outbox, intent); err != nil {
		return fmt.Errorf(
			"conversation production Federation: enqueue device delivery: %w",
			err,
		)
	}

	return nil
}

type productionKeyPackageReservations struct {
	db           *gorm.DB
	store        *keyexchangeinfra.CanonicalStore
	identity     *productionIdentityDirectory
	clock        federationdelivery.Clock
	localStation valueobject.StationID
	keyExchange  productionKeyPackageReservationService
}

func (r *productionKeyPackageReservations) Reserve(
	ctx context.Context,
	planID valueobject.PlanID,
	endpoints []valueobject.Endpoint,
	expiresAt time.Time,
) ([]valueobject.KeyPackageReservation, error) {
	if r == nil || r.db == nil || r.store == nil || r.identity == nil || r.clock == nil ||
		r.localStation == "" || r.keyExchange == nil ||
		strings.TrimSpace(string(planID)) == "" ||
		expiresAt.IsZero() {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"production_key_packages.reserve",
			"reservation",
			"is incomplete",
		)
	}
	if len(endpoints) == 0 {
		return []valueobject.KeyPackageReservation{}, nil
	}

	now := r.clock.Now().UTC()
	if !expiresAt.After(now) {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeAuthorityPlanExpired,
			"production_key_packages.reserve",
			"expires_at",
			"must be after the reservation time",
		)
	}

	sorted := valueobject.SortEndpoints(endpoints)
	reservations := make([]valueobject.KeyPackageReservation, 0, len(sorted))
	var previous valueobject.Endpoint
	for index, endpoint := range sorted {
		if endpoint.Validate() != nil || (index > 0 && endpoint == previous) {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeInvalidArgument,
				"production_key_packages.reserve",
				"endpoints",
				"contains an invalid or duplicate endpoint",
			)
		}
		route, err := r.identity.activeRoute(ctx, endpoint)
		if err != nil {
			return nil, err
		}
		target := keyexchangedomain.Endpoint{
			ActorPTID: string(endpoint.Actor),
			DeviceID:  string(endpoint.Device),
		}
		var canonical keyexchangedomain.MLSKeyPackageReservation
		if route.HomeStation == r.localStation {
			canonical, err = r.store.ReserveMLSKeyPackage(
				ctx,
				string(planID),
				target,
				string(route.HomeStation),
				now,
				expiresAt.UTC(),
			)
		} else {
			canonical, err = r.keyExchange.ReserveMLSKeyPackage(
				ctx,
				productionKeyPackageClaimRequestID(
					r.localStation,
					planID,
					endpoint,
				),
				string(planID),
				target,
				expiresAt.UTC(),
			)
		}
		if err != nil {
			return nil, mapKeyExchangeReservationError(
				"production_key_packages.reserve",
				err,
			)
		}
		if canonical.PlanID != string(planID) ||
			canonical.Target != target ||
			canonical.HomeStation != string(route.HomeStation) ||
			!canonical.PlanExpiresAt.Equal(expiresAt.UTC()) ||
			canonical.IrreversiblyConsumed !=
				(route.HomeStation != r.localStation) {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeAuthorityPlanStale,
				"production_key_packages.reserve",
				"reservation",
				"does not match the verified endpoint route and authority plan",
			)
		}
		reservation, err := conversationReservationFromCanonical(canonical)
		if err != nil {
			return nil, err
		}
		reservations = append(reservations, reservation)
		previous = endpoint
	}

	return valueobject.SortKeyPackageReservations(reservations), nil
}

func (r *productionKeyPackageReservations) Consume(
	ctx context.Context,
	reservations []valueobject.KeyPackageReservation,
	at time.Time,
) error {
	canonical, err := r.loadCanonicalReservations(ctx, reservations)
	if err != nil {
		return err
	}
	if len(canonical) == 0 {
		return nil
	}
	if err := r.store.ConsumeMLSKeyPackages(ctx, canonical, at.UTC()); err != nil {
		return mapKeyExchangeReservationError(
			"production_key_packages.consume",
			err,
		)
	}

	return nil
}

func (r *productionKeyPackageReservations) Release(
	ctx context.Context,
	reservations []valueobject.KeyPackageReservation,
	at time.Time,
) error {
	canonical, err := r.loadCanonicalReservations(ctx, reservations)
	if err != nil {
		return err
	}
	if len(canonical) == 0 {
		return nil
	}
	if err := r.store.ReleaseMLSKeyPackages(ctx, canonical, at.UTC()); err != nil {
		return mapKeyExchangeReservationError(
			"production_key_packages.release",
			err,
		)
	}

	return nil
}

func (r *productionKeyPackageReservations) loadCanonicalReservations(
	ctx context.Context,
	reservations []valueobject.KeyPackageReservation,
) ([]keyexchangedomain.MLSKeyPackageReservation, error) {
	if r == nil || r.db == nil || r.store == nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"production_key_packages.load",
			"dependencies",
			"transaction-bound Key Exchange store is required",
		)
	}
	if len(reservations) == 0 {
		return []keyexchangedomain.MLSKeyPackageReservation{}, nil
	}

	canonical := make(
		[]keyexchangedomain.MLSKeyPackageReservation,
		0,
		len(reservations),
	)
	seen := make(map[string]struct{}, len(reservations))
	for _, reservation := range valueobject.SortKeyPackageReservations(reservations) {
		if err := reservation.Validate(); err != nil {
			return nil, err
		}
		if _, duplicate := seen[reservation.ID]; duplicate {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeInvalidArgument,
				"production_key_packages.load",
				"reservations",
				"contains a duplicate reservation",
			)
		}
		seen[reservation.ID] = struct{}{}
		if reservation.HomeStation != r.localStation {
			if !reservation.IrreversiblyConsumed {
				return nil, conversationdomain.NewError(
					conversationdomain.ErrorCodeAuthorityPlanStale,
					"production_key_packages.load",
					"reservation",
					"remote reservation is not terminal",
				)
			}
			continue
		}
		if reservation.IrreversiblyConsumed {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeAuthorityPlanStale,
				"production_key_packages.load",
				"reservation",
				"local reservation cannot be irreversibly consumed before commit",
			)
		}

		packageID, err := strconv.ParseUint(reservation.PackageID, 10, 64)
		if err != nil || packageID == 0 {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeAuthorityPlanStale,
				"production_key_packages.load",
				"package_id",
				"is not a canonical Key Exchange package identity",
			)
		}
		var model keyexchangeinfra.MLSKeyPackageModel
		err = r.db.WithContext(ctx).
			Where(
				"id = ? AND ptid = ? AND device_id = ?",
				packageID,
				string(reservation.Endpoint.Actor),
				string(reservation.Endpoint.Device),
			).
			First(&model).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeAuthorityPlanStale,
				"production_key_packages.load",
				"reservation",
				"does not resolve to canonical Key Exchange state",
			)
		}
		if err != nil {
			return nil, fmt.Errorf(
				"conversation production Key Exchange: load reservation: %w",
				err,
			)
		}
		if model.ReservedPlanID == "" ||
			model.ReservedUntil == nil ||
			len(model.DataSHA256) != len(valueobject.Hash{}) {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeAuthorityPlanStale,
				"production_key_packages.load",
				"reservation",
				"is no longer prepared",
			)
		}

		var packageHash [32]byte
		copy(packageHash[:], model.DataSHA256)
		candidate := keyexchangedomain.MLSKeyPackageReservation{
			PlanID: model.ReservedPlanID,
			Target: keyexchangedomain.Endpoint{
				ActorPTID: model.ActorPTID,
				DeviceID:  model.DeviceID,
			},
			PackageID:     reservation.PackageID,
			KeyPackage:    append([]byte(nil), model.Data...),
			PackageHash:   packageHash,
			HomeStation:   model.HomeStationID,
			PlanExpiresAt: model.ReservedUntil.UTC(),
		}
		expected, err := conversationReservationFromCanonical(candidate)
		if err != nil {
			return nil, err
		}
		if expected.ID != reservation.ID ||
			expected.Endpoint != reservation.Endpoint ||
			expected.PackageID != reservation.PackageID ||
			expected.PackageHash != reservation.PackageHash ||
			expected.HomeStation != reservation.HomeStation ||
			expected.IrreversiblyConsumed != reservation.IrreversiblyConsumed ||
			!bytes.Equal(expected.KeyPackage, reservation.KeyPackage) {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeAuthorityPlanStale,
				"production_key_packages.load",
				"reservation",
				"does not match canonical Key Exchange state",
			)
		}
		canonical = append(canonical, candidate)
	}

	return canonical, nil
}

func conversationReservationFromCanonical(
	reservation keyexchangedomain.MLSKeyPackageReservation,
) (valueobject.KeyPackageReservation, error) {
	if err := reservation.Validate("production_key_packages.map"); err != nil {
		return valueobject.KeyPackageReservation{},
			mapKeyExchangeReservationError("production_key_packages.map", err)
	}
	endpoint := valueobject.Endpoint{
		Actor:  valueobject.PTID(reservation.Target.ActorPTID),
		Device: valueobject.DeviceID(reservation.Target.DeviceID),
	}
	packageHash := valueobject.Hash(reservation.PackageHash)
	mapped := valueobject.KeyPackageReservation{
		ID: productionKeyPackageReservationID(
			reservation.PlanID,
			endpoint,
			reservation.PackageID,
			packageHash,
			valueobject.StationID(reservation.HomeStation),
			reservation.IrreversiblyConsumed,
		),
		Endpoint:             endpoint,
		PackageID:            reservation.PackageID,
		KeyPackage:           append([]byte(nil), reservation.KeyPackage...),
		PackageHash:          packageHash,
		HomeStation:          valueobject.StationID(reservation.HomeStation),
		IrreversiblyConsumed: reservation.IrreversiblyConsumed,
	}
	if err := mapped.Validate(); err != nil {
		return valueobject.KeyPackageReservation{}, err
	}

	return mapped, nil
}

func productionKeyPackageReservationID(
	planID string,
	endpoint valueobject.Endpoint,
	packageID string,
	packageHash valueobject.Hash,
	homeStation valueobject.StationID,
	irreversiblyConsumed bool,
) string {
	return valueobject.HashBytes(valueobject.CanonicalTuple(
		[]byte("conversation-key-package-reservation"),
		[]byte(planID),
		[]byte(endpoint.Actor),
		[]byte(endpoint.Device),
		[]byte(packageID),
		packageHash[:],
		[]byte(homeStation),
		[]byte(strconv.FormatBool(irreversiblyConsumed)),
	)).String()
}

func productionKeyPackageClaimRequestID(
	localStation valueobject.StationID,
	planID valueobject.PlanID,
	endpoint valueobject.Endpoint,
) string {
	return valueobject.HashBytes(valueobject.CanonicalTuple(
		[]byte("conversation-key-package-claim-request"),
		[]byte(localStation),
		[]byte(planID),
		[]byte(endpoint.Actor),
		[]byte(endpoint.Device),
	)).String()
}

func mapKeyExchangeReservationError(operation string, err error) error {
	if err == nil {
		return nil
	}
	switch keyexchangedomain.CodeOf(err) {
	case keyexchangedomain.ErrorCodeInvalidArgument,
		keyexchangedomain.ErrorCodePayloadTooLarge:
		return conversationdomain.WrapError(
			conversationdomain.ErrorCodeInvalidArgument,
			operation,
			err,
		)
	case keyexchangedomain.ErrorCodeUnauthorized:
		return conversationdomain.WrapError(
			conversationdomain.ErrorCodeUnauthorized,
			operation,
			err,
		)
	case keyexchangedomain.ErrorCodePlanExpired:
		return conversationdomain.WrapError(
			conversationdomain.ErrorCodeAuthorityPlanExpired,
			operation,
			err,
		)
	case keyexchangedomain.ErrorCodeNotFound,
		keyexchangedomain.ErrorCodeConflict,
		keyexchangedomain.ErrorCodeStaleMaterial:
		return conversationdomain.WrapError(
			conversationdomain.ErrorCodeAuthorityPlanStale,
			operation,
			err,
		)
	default:
		return fmt.Errorf(
			"conversation production Key Exchange %s: %w",
			operation,
			err,
		)
	}
}

var (
	_ persistence.TransactionalAdapterFactory = (*ProductionTransactionalAdapterFactory)(nil)
	_ ports.IdentityDirectory                 = (*productionIdentityDirectory)(nil)
	_ ports.FederationDirectory               = (*productionFederationDirectory)(nil)
	_ ports.FederationOutboxWriter            = (*productionFederationOutboxWriter)(nil)
	_ ports.KeyPackageReservations            = (*productionKeyPackageReservations)(nil)
)
