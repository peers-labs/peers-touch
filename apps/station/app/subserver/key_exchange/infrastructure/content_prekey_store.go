package infrastructure

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"

	securecontentkernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	actoridentitydomain "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	actoridentitypersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	contentPreKeyStoreOperation                  = "key_exchange.store.content_prekeys"
	contentPreKeyPublicationReceiptStatePending  = "PENDING"
	contentPreKeyPublicationReceiptStateComplete = "COMPLETED"
)

// ContentPreKeyPoolModel is a lockable per-principal inventory fence. Endpoint
// and actor-recovery kinds always produce different rows.
type ContentPreKeyPoolModel struct {
	Kind              int32     `gorm:"column:kind;primaryKey"`
	PrincipalPTID     string    `gorm:"column:principal_ptid;size:255;primaryKey"`
	PrincipalDeviceID string    `gorm:"column:principal_device_id;size:128;primaryKey"`
	CurrentEpoch      int64     `gorm:"column:current_epoch;not null"`
	CreatedAt         time.Time `gorm:"column:created_at;not null"`
	UpdatedAt         time.Time `gorm:"column:updated_at;not null"`
}

func (*ContentPreKeyPoolModel) TableName() string {
	return "key_exchange_content_prekey_pools"
}

// ContentPreKeyModel stores only public one-time material. Consumed rows remain
// immutable so a later publication cannot reactivate an exposed key.
type ContentPreKeyModel struct {
	ID                          uint       `gorm:"column:id;primaryKey"`
	Kind                        int32      `gorm:"column:kind;not null;uniqueIndex:uidx_ke_content_prekey_identity,priority:1;index:idx_ke_content_prekey_available,priority:1"`
	PrincipalPTID               string     `gorm:"column:principal_ptid;size:255;not null;uniqueIndex:uidx_ke_content_prekey_identity,priority:2;index:idx_ke_content_prekey_available,priority:2"`
	PrincipalDeviceID           string     `gorm:"column:principal_device_id;size:128;not null;uniqueIndex:uidx_ke_content_prekey_identity,priority:3;index:idx_ke_content_prekey_available,priority:3"`
	KeyID                       string     `gorm:"column:key_id;size:128;not null;uniqueIndex:uidx_ke_content_prekey_identity,priority:4"`
	PublicKey                   []byte     `gorm:"column:public_key;type:bytea;not null"`
	PublicKeySHA256             []byte     `gorm:"column:public_key_sha256;type:bytea;not null;uniqueIndex:uidx_ke_content_prekey_public"`
	ProfileOrRecoveryEpoch      int64      `gorm:"column:profile_or_recovery_epoch;not null;index:idx_ke_content_prekey_available,priority:4"`
	IssuerSignature             []byte     `gorm:"column:issuer_signature;type:bytea;not null"`
	PublishedByPTID             string     `gorm:"column:published_by_ptid;size:255;not null"`
	PublishedByDeviceID         string     `gorm:"column:published_by_device_id;size:128;not null"`
	PublisherSigningKeyID       string     `gorm:"column:publisher_signing_key_id;size:128;not null"`
	PublisherProfileVersion     int64      `gorm:"column:publisher_profile_version;not null"`
	PublisherVerificationSource int32      `gorm:"column:publisher_verification_source;not null"`
	ExpectedPoolEpoch           int64      `gorm:"column:expected_pool_epoch;not null"`
	CreatedAt                   time.Time  `gorm:"column:created_at;not null"`
	ConsumedAt                  *time.Time `gorm:"column:consumed_at;index:idx_ke_content_prekey_available,priority:5"`
	RetiredAt                   *time.Time `gorm:"column:retired_at;index:idx_ke_content_prekey_available,priority:6"`
	ClaimID                     string     `gorm:"column:claim_id;size:96;not null;default:'';index"`
	ClaimPlanID                 string     `gorm:"column:claim_plan_id;size:128;not null;default:'';index"`
}

func (*ContentPreKeyModel) TableName() string {
	return "key_exchange_content_prekeys"
}

// ContentPreKeyClaimReceiptModel is the exact-once boundary for an entire
// multi-target plan. The response bytes retain every irreversible claim.
type ContentPreKeyClaimReceiptModel struct {
	PlanID                 string     `gorm:"column:plan_id;size:128;primaryKey"`
	PlanRequestSHA256      []byte     `gorm:"column:plan_request_sha256;type:bytea;not null"`
	CanonicalRequestSHA256 []byte     `gorm:"column:canonical_request_sha256;type:bytea;not null"`
	ResponseBytes          []byte     `gorm:"column:response_bytes;type:bytea"`
	ResponseSHA256         []byte     `gorm:"column:response_sha256;type:bytea"`
	CreatedAt              time.Time  `gorm:"column:created_at;not null"`
	CompletedAt            *time.Time `gorm:"column:completed_at"`
}

func (*ContentPreKeyClaimReceiptModel) TableName() string {
	return "key_exchange_content_prekey_claim_receipts"
}

type ContentPreKeyPublicationReceiptModel struct {
	PublisherPTID     string     `gorm:"column:publisher_ptid;size:255;primaryKey"`
	PublisherDeviceID string     `gorm:"column:publisher_device_id;size:128;primaryKey"`
	CommandID         string     `gorm:"column:command_id;size:128;primaryKey"`
	RequestBytes      []byte     `gorm:"column:request_bytes;type:bytea;not null"`
	RequestSHA256     []byte     `gorm:"column:request_sha256;type:bytea;not null"`
	State             string     `gorm:"column:state;size:16;not null"`
	ResponseBytes     []byte     `gorm:"column:response_bytes;type:bytea"`
	ResponseSHA256    []byte     `gorm:"column:response_sha256;type:bytea"`
	CreatedAt         time.Time  `gorm:"column:created_at;not null"`
	CompletedAt       *time.Time `gorm:"column:completed_at"`
}

func (*ContentPreKeyPublicationReceiptModel) TableName() string {
	return "key_exchange_content_prekey_publication_receipts"
}

// ContentPreKeyStore is deliberately separate from CanonicalStore so Direct,
// MLS, and Content quotas and lifecycle transitions cannot alias.
type ContentPreKeyStore struct {
	db         *gorm.DB
	publishers ContentPreKeyPublisherResolver
}

// ContentPreKeyPublisherResolver is the Actor Identity-owned verified signing
// key capability used inside the Key Exchange transaction.
type ContentPreKeyPublisherResolver interface {
	ResolveVerifiedActorDeviceSigningKey(
		context.Context,
		federationdelivery.Transaction,
		string,
		string,
		string,
	) (*actormodel.VerifiedActorDeviceSigningKey, error)
	ResolveRetainedActorDeviceSigningKey(
		context.Context,
		federationdelivery.Transaction,
		string,
		string,
		string,
	) (*actormodel.VerifiedActorDeviceSigningKey, error)
}

type contentPreKeyTransaction struct {
	db *gorm.DB
}

func (t contentPreKeyTransaction) DB() *gorm.DB {
	return t.db
}

func (contentPreKeyTransaction) Outbox() federationdelivery.OutboxWriter {
	return nil
}

func NewContentPreKeyStore(
	db *gorm.DB,
	publishers ContentPreKeyPublisherResolver,
) (*ContentPreKeyStore, error) {
	if db == nil || publishers == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			"key_exchange.new_content_prekey_store",
			"dependencies",
			"database and Actor Identity publisher resolver are required",
		)
	}
	return &ContentPreKeyStore{
		db:         db,
		publishers: publishers,
	}, nil
}

func (s *ContentPreKeyStore) Migrate(ctx context.Context) error {
	if err := s.db.WithContext(ctx).AutoMigrate(
		&ContentPreKeyPoolModel{},
		&ContentPreKeyModel{},
		&ContentPreKeyClaimReceiptModel{},
		&ContentPreKeyPublicationReceiptModel{},
	); err != nil {
		return domain.WrapError(
			domain.ErrorCodeInternal,
			"key_exchange.migrate_content_prekeys",
			err,
		)
	}
	if err := s.db.WithContext(ctx).Exec(
		"CREATE UNIQUE INDEX IF NOT EXISTS " +
			"uidx_ke_content_prekey_claim ON " +
			"key_exchange_content_prekeys(claim_id) " +
			"WHERE claim_id <> ''",
	).Error; err != nil {
		return domain.WrapError(
			domain.ErrorCodeInternal,
			"key_exchange.migrate_content_prekey_claim_index",
			err,
		)
	}
	return nil
}

func (s *ContentPreKeyStore) PublishContentPreKeys(
	ctx context.Context,
	publication domain.ContentPreKeyPublication,
	publishedAt time.Time,
) (domain.ContentPreKeyInventory, error) {
	inventory, _, err := s.publishContentPreKeys(
		ctx,
		publication,
		nil,
		publishedAt,
	)
	return inventory, err
}

func (s *ContentPreKeyStore) PublishContentPreKeysClient(
	ctx context.Context,
	command domain.ContentPreKeyClientPublication,
	publishedAt time.Time,
) (*securecontentpb.PublishContentPreKeysResponse, error) {
	inventory, exactReplay, err := s.publishContentPreKeys(
		ctx,
		command.Publication,
		&command,
		publishedAt,
	)
	if err != nil {
		return nil, err
	}
	return &securecontentpb.PublishContentPreKeysResponse{
		Inventory:   contentPreKeyInventoryResponse(inventory),
		ExactReplay: exactReplay,
	}, nil
}

func (s *ContentPreKeyStore) publishContentPreKeys(
	ctx context.Context,
	publication domain.ContentPreKeyPublication,
	clientCommand *domain.ContentPreKeyClientPublication,
	publishedAt time.Time,
) (domain.ContentPreKeyInventory, bool, error) {
	const operation = contentPreKeyStoreOperation + ".publish"

	var verifiedClientKey *actormodel.VerifiedActorDeviceSigningKey
	if clientCommand != nil {
		var err error
		verifiedClientKey, err = s.verifyContentPreKeyClientAuthorization(
			ctx,
			clientCommand.Authorization,
			operation,
		)
		if err != nil {
			return domain.ContentPreKeyInventory{}, false, err
		}
	}
	var inventory domain.ContentPreKeyInventory
	var exactReplay bool
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var publicationReceipt ContentPreKeyPublicationReceiptModel
		if clientCommand != nil {
			var err error
			publicationReceipt, err = claimContentPreKeyPublicationReceipt(
				tx,
				clientCommand.Authorization,
				clientCommand.CommandID,
				publishedAt,
			)
			if err != nil {
				return err
			}
			if publicationReceipt.State ==
				contentPreKeyPublicationReceiptStateComplete {
				if err := fenceContentPreKeyClientAuthorization(
					tx,
					verifiedClientKey,
					operation,
				); err != nil {
					return err
				}
				replayed, err := decodeContentPreKeyPublicationReceipt(
					publicationReceipt,
					publication.Principal,
					publication.PoolEpoch,
				)
				if err != nil {
					return err
				}
				inventory, err = contentPreKeyInventoryFromResponse(
					replayed.GetInventory(),
					publication.Principal,
					publication.PoolEpoch,
				)
				if err != nil {
					return err
				}
				exactReplay = true
				return nil
			}
			if clientCommand.Authorization.SigningKeyID !=
				publication.PublisherSigningKeyID ||
				clientCommand.Authorization.ProfileVersion !=
					publication.PublisherProfileVersion {
				return domain.NewError(
					domain.ErrorCodeUnauthorized,
					operation,
					"proof.input.publisher_signing_key",
					"does not authorize the publication identity",
				)
			}
		}
		pool, poolFound, err := findAndLockContentPreKeyPool(
			tx,
			publication.Principal,
		)
		if err != nil {
			return err
		}
		if !poolFound {
			var created bool
			pool, created, err = ensureAndLockContentPreKeyPool(
				tx,
				publication.Principal,
				publication.PoolEpoch,
				publishedAt,
			)
			if err != nil {
				return err
			}
			poolFound = !created
		}

		var publisherKey *actormodel.VerifiedActorDeviceSigningKey
		if clientCommand != nil {
			err = fenceContentPreKeyClientAuthorization(
				tx,
				verifiedClientKey,
				operation,
			)
			publisherKey = verifiedClientKey
		} else {
			publisherKey, err = s.resolveAndFenceContentPreKeyPublisher(
				ctx,
				tx,
				publication,
				operation,
			)
		}
		if err != nil {
			return err
		}
		if publication.Principal.Kind ==
			securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT &&
			publication.PoolEpoch != publication.PublisherProfileVersion {
			return domain.NewError(
				domain.ErrorCodeStaleMaterial,
				operation,
				"profile_or_recovery_epoch",
				"does not match the active endpoint profile version",
			)
		}
		if err := verifyContentPreKeyPublicationSignatures(
			publication,
			publisherKey.GetEd25519PublicKey(),
			operation,
		); err != nil {
			return err
		}

		newKeys := make(
			[]*securecontentpb.ContentOneTimePreKey,
			0,
			len(publication.PreKeys),
		)
		for _, prekey := range publication.PreKeys {
			existing, found, err := findContentPreKeyByIdentity(
				tx,
				publication.Principal,
				prekey.GetKeyId(),
				true,
			)
			if err != nil {
				return err
			}
			if found {
				if err := validateExactContentPreKeyReplay(
					existing,
					publication,
					publisherKey.GetVerificationSource(),
					prekey,
				); err != nil {
					return err
				}
				continue
			}
			if err := requireUnusedContentPreKeyPublicMaterial(
				tx,
				prekey.GetX25519PublicKey(),
			); err != nil {
				return err
			}
			newKeys = append(newKeys, prekey)
		}

		if len(newKeys) == 0 {
			if clientCommand != nil {
				return domain.NewError(
					domain.ErrorCodeConflict,
					operation,
					"command_id",
					"first publication command must insert immutable key material",
				)
			}
			if !poolFound {
				return domain.NewError(
					domain.ErrorCodeInternal,
					operation,
					"pool",
					"is missing for persisted Content PreKeys",
				)
			}
			available, err := s.reconcileAvailableContentPreKeys(
				ctx,
				tx,
				publication.Principal,
				uint64(pool.CurrentEpoch),
				publishedAt,
				operation,
			)
			if err != nil {
				return err
			}
			inventory = domain.NewContentPreKeyInventory(
				publication.Principal,
				uint64(pool.CurrentEpoch),
				available,
			)
			return nil
		}

		if err := validateContentPreKeyEpochTransition(
			publication,
			uint64(pool.CurrentEpoch),
			poolFound,
			operation,
		); err != nil {
			return err
		}
		if publication.PoolEpoch > uint64(pool.CurrentEpoch) {
			if err := retireContentPreKeysBeforeEpoch(
				tx,
				publication.Principal,
				publication.PoolEpoch,
				publishedAt,
			); err != nil {
				return err
			}
			pool.CurrentEpoch = int64(publication.PoolEpoch)
		}

		available, err := s.reconcileAvailableContentPreKeys(
			ctx,
			tx,
			publication.Principal,
			uint64(pool.CurrentEpoch),
			publishedAt,
			operation,
		)
		if err != nil {
			return err
		}
		if available+int64(len(newKeys)) > domain.MaxContentPreKeysPerPool {
			return domain.NewError(
				domain.ErrorCodeQuotaExceeded,
				operation,
				"prekeys",
				"would exceed the bounded Content PreKey pool capacity",
			)
		}
		for _, prekey := range newKeys {
			publicKeyHash := sha256.Sum256(prekey.GetX25519PublicKey())
			record := ContentPreKeyModel{
				Kind:                   int32(publication.Principal.Kind),
				PrincipalPTID:          publication.Principal.ActorPTID,
				PrincipalDeviceID:      publication.Principal.DeviceID,
				KeyID:                  prekey.GetKeyId(),
				PublicKey:              append([]byte(nil), prekey.GetX25519PublicKey()...),
				PublicKeySHA256:        append([]byte(nil), publicKeyHash[:]...),
				ProfileOrRecoveryEpoch: int64(publication.PoolEpoch),
				IssuerSignature:        append([]byte(nil), prekey.GetIssuerSignature()...),
				PublishedByPTID:        publication.Publisher.ActorPTID,
				PublishedByDeviceID:    publication.Publisher.DeviceID,
				PublisherSigningKeyID:  publication.PublisherSigningKeyID,
				PublisherProfileVersion: int64(
					publication.PublisherProfileVersion,
				),
				PublisherVerificationSource: int32(
					publisherKey.GetVerificationSource(),
				),
				ExpectedPoolEpoch: int64(publication.ExpectedPoolEpoch),
				CreatedAt:         publishedAt.UTC(),
			}
			if err := tx.Create(&record).Error; err != nil {
				if isContentPreKeyContention(err) {
					return domain.NewError(
						domain.ErrorCodeConflict,
						operation,
						"prekeys",
						"conflicts with concurrently published Content PreKey material",
					)
				}
				return contentPreKeyStoreFailure("persist Content PreKey", err)
			}
		}
		if err := tx.Model(&ContentPreKeyPoolModel{}).
			Where(
				contentPreKeyPoolPredicate(),
				contentPreKeyPoolArgs(publication.Principal)...,
			).
			Updates(map[string]any{
				"current_epoch": pool.CurrentEpoch,
				"updated_at":    publishedAt.UTC(),
			}).Error; err != nil {
			return contentPreKeyStoreFailure("update Content PreKey pool", err)
		}

		available += int64(len(newKeys))
		inventory = domain.NewContentPreKeyInventory(
			publication.Principal,
			uint64(pool.CurrentEpoch),
			available,
		)
		if clientCommand != nil {
			response := &securecontentpb.PublishContentPreKeysResponse{
				Inventory: contentPreKeyInventoryResponse(inventory),
			}
			if err := completeContentPreKeyPublicationReceipt(
				tx,
				publicationReceipt,
				response,
				publishedAt,
			); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return domain.ContentPreKeyInventory{}, false, err
	}
	return inventory, exactReplay, nil
}

func (s *ContentPreKeyStore) ContentPreKeyInventory(
	ctx context.Context,
	publisher domain.Endpoint,
	principal domain.ContentPreKeyPrincipal,
	observedAt time.Time,
) (domain.ContentPreKeyInventory, error) {
	return s.contentPreKeyInventory(
		ctx,
		publisher,
		principal,
		nil,
		observedAt,
	)
}

func (s *ContentPreKeyStore) ContentPreKeyInventoryClient(
	ctx context.Context,
	publisher domain.Endpoint,
	principal domain.ContentPreKeyPrincipal,
	authorization domain.ContentPreKeyClientAuthorization,
	observedAt time.Time,
) (domain.ContentPreKeyInventory, error) {
	return s.contentPreKeyInventory(
		ctx,
		publisher,
		principal,
		&authorization,
		observedAt,
	)
}

func (s *ContentPreKeyStore) contentPreKeyInventory(
	ctx context.Context,
	publisher domain.Endpoint,
	principal domain.ContentPreKeyPrincipal,
	authorization *domain.ContentPreKeyClientAuthorization,
	observedAt time.Time,
) (domain.ContentPreKeyInventory, error) {
	const operation = contentPreKeyStoreOperation + ".inventory"

	var verifiedClientKey *actormodel.VerifiedActorDeviceSigningKey
	if authorization != nil {
		var err error
		verifiedClientKey, err = s.verifyContentPreKeyClientAuthorization(
			ctx,
			*authorization,
			operation,
		)
		if err != nil {
			return domain.ContentPreKeyInventory{}, err
		}
	}

	var inventory domain.ContentPreKeyInventory
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		pool, found, err := findAndLockContentPreKeyPool(tx, principal)
		if err != nil {
			return err
		}
		if authorization != nil {
			err = fenceContentPreKeyClientAuthorization(
				tx,
				verifiedClientKey,
				operation,
			)
			if err != nil {
				return err
			}
		} else {
			_, err =
				actoridentitypersistence.LockActiveDeviceProfileVersionForMutation(
					tx,
					actoridentitypersistence.DeviceLocator{
						PTID:     publisher.ActorPTID,
						DeviceID: publisher.DeviceID,
					},
				)
		}
		if authorization == nil && err != nil {
			return mapContentPreKeyActorIdentityError(operation, err)
		}
		if !found {
			return domain.NewError(
				domain.ErrorCodeNotFound,
				operation,
				"pool",
				"has not been published",
			)
		}
		effectiveEpoch := pool.CurrentEpoch
		available, err := s.reconcileAvailableContentPreKeys(
			ctx,
			tx,
			principal,
			uint64(effectiveEpoch),
			observedAt,
			operation,
		)
		if err != nil {
			return err
		}
		inventory = domain.NewContentPreKeyInventory(
			principal,
			uint64(effectiveEpoch),
			available,
		)
		return nil
	})
	if err != nil {
		return domain.ContentPreKeyInventory{}, err
	}
	return inventory, nil
}

func (s *ContentPreKeyStore) ClaimContentPreKeys(
	ctx context.Context,
	request *securecontentpb.ClaimContentPreKeysRequest,
	principals []domain.ContentPreKeyPrincipal,
	claimedAt time.Time,
) (*securecontentpb.ClaimContentPreKeysResponse, error) {
	const operation = contentPreKeyStoreOperation + ".claim"

	var response *securecontentpb.ClaimContentPreKeysResponse
	var committedClaimError error
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		receipt, ownsClaim, err := claimContentPreKeyReceipt(
			tx,
			request,
			claimedAt,
		)
		if err != nil {
			return err
		}
		if !ownsClaim {
			replayed, err := s.decodeContentPreKeyClaimReceipt(
				ctx,
				tx,
				receipt,
				request,
			)
			if err != nil {
				return err
			}
			replayed.ExactReplay = true
			response = replayed
			return nil
		}

		candidatesByPrincipal := make(
			map[string][]ContentPreKeyModel,
			len(principals),
		)
		allCandidates := make(
			[]ContentPreKeyModel,
			0,
			len(principals),
		)
		for _, principal := range principals {
			pool, found, err := findAndLockContentPreKeyPool(tx, principal)
			if err != nil {
				return err
			}
			if !found {
				return contentPreKeyDepleted(operation, principal)
			}
			candidates, err := listAvailableContentPreKeys(
				tx,
				principal,
				uint64(pool.CurrentEpoch),
			)
			if err != nil {
				return err
			}
			if len(candidates) == 0 {
				return contentPreKeyDepleted(operation, principal)
			}
			candidatesByPrincipal[principal.Key()] = candidates
			allCandidates = append(allCandidates, candidates...)
		}
		publisherKeys, ineligiblePublishers, err :=
			s.resolveAndFenceContentPreKeyPublishers(
				ctx,
				tx,
				allCandidates,
				operation,
			)
		if err != nil {
			return err
		}

		selected := make(
			map[string]ContentPreKeyModel,
			len(principals),
		)
		wirePreKeys := make(
			map[string]*securecontentpb.ContentOneTimePreKey,
			len(principals),
		)
		for _, principal := range principals {
			prekey, wirePreKey, err := selectClaimableContentPreKey(
				tx,
				candidatesByPrincipal[principal.Key()],
				publisherKeys,
				ineligiblePublishers,
				claimedAt,
				operation,
			)
			if err != nil {
				if isContentPreKeyPublisherIneligible(err) {
					if deleteErr := deletePendingContentPreKeyClaimReceipt(
						tx,
						receipt.PlanID,
					); deleteErr != nil {
						return deleteErr
					}
					committedClaimError = err
					return nil
				}
				return err
			}
			selected[principal.Key()] = prekey
			wirePreKeys[principal.Key()] = wirePreKey
		}

		var planRequestSHA256 [sha256.Size]byte
		copy(planRequestSHA256[:], request.GetPlanRequestSha256())
		response = &securecontentpb.ClaimContentPreKeysResponse{
			Claims: make(
				[]*securecontentpb.ClaimedContentPreKey,
				0,
				len(principals),
			),
		}
		for _, principal := range principals {
			prekey := selected[principal.Key()]
			claimID := domain.NewContentPreKeyClaimID(
				request.GetPlanId(),
				planRequestSHA256,
				principal,
				prekey.KeyID,
			)
			result := tx.Model(&ContentPreKeyModel{}).
				Where(
					"id = ? AND consumed_at IS NULL AND retired_at IS NULL"+
						" AND claim_id = '' AND claim_plan_id = ''",
					prekey.ID,
				).
				Updates(map[string]any{
					"consumed_at":   claimedAt.UTC(),
					"claim_id":      claimID,
					"claim_plan_id": request.GetPlanId(),
				})
			if result.Error != nil {
				return contentPreKeyStoreFailure(
					"consume Content PreKey",
					result.Error,
				)
			}
			if result.RowsAffected != 1 {
				return domain.NewError(
					domain.ErrorCodeStaleMaterial,
					operation,
					"prekey",
					"was consumed concurrently",
				)
			}
			response.Claims = append(
				response.Claims,
				&securecontentpb.ClaimedContentPreKey{
					ClaimId:              claimID,
					Target:               principal.ClaimTarget(),
					Prekey:               wirePreKeys[principal.Key()],
					IrreversiblyConsumed: true,
				},
			)
		}
		return completeContentPreKeyClaimReceipt(
			tx,
			receipt,
			response,
			claimedAt,
		)
	})
	if err != nil {
		return nil, err
	}
	if committedClaimError != nil {
		return nil, committedClaimError
	}
	return response, nil
}

// ValidateContentPreKeyClaims revalidates a completed claim inside the
// caller-owned transaction so its current principal fences remain held through
// the caller's commit.
func (s *ContentPreKeyStore) ValidateContentPreKeyClaims(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	request *securecontentpb.ClaimContentPreKeysRequest,
	response *securecontentpb.ClaimContentPreKeysResponse,
	principals []domain.ContentPreKeyPrincipal,
) error {
	const operation = contentPreKeyStoreOperation + ".validate"

	if transaction == nil || transaction.DB() == nil {
		return domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"transaction",
			"is required",
		)
	}

	tx := transaction.DB().WithContext(ctx)
	var receipt ContentPreKeyClaimReceiptModel
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("plan_id = ?", request.GetPlanId()).
		First(&receipt).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.NewError(
			domain.ErrorCodeNotFound,
			operation,
			"plan_id",
			"has no completed Content PreKey claim receipt",
		)
	}
	if err != nil {
		return contentPreKeyStoreFailure(
			"load Content PreKey claim receipt for validation",
			err,
		)
	}

	persistedResponse, err := decodeCanonicalContentPreKeyClaimReceipt(
		receipt,
		request,
		operation,
	)
	if err != nil {
		return err
	}
	providedResponse := proto.Clone(
		response,
	).(*securecontentpb.ClaimContentPreKeysResponse)
	providedResponse.ExactReplay = false
	if !proto.Equal(providedResponse, persistedResponse) {
		return domain.NewError(
			domain.ErrorCodeInvalidMaterial,
			operation,
			"response",
			"does not match the completed Content PreKey claim receipt",
		)
	}

	currentEpochs, err := lockCurrentContentPreKeyClaimEpochs(
		tx,
		principals,
		operation,
	)
	if err != nil {
		return err
	}
	if err := s.verifyCompletedContentPreKeyClaimReceipt(
		ctx,
		tx,
		request,
		persistedResponse,
		operation,
	); err != nil {
		return err
	}

	return validateCurrentContentPreKeyClaimEpochs(
		persistedResponse,
		currentEpochs,
		operation,
	)
}

func ensureAndLockContentPreKeyPool(
	tx *gorm.DB,
	principal domain.ContentPreKeyPrincipal,
	epoch uint64,
	at time.Time,
) (ContentPreKeyPoolModel, bool, error) {
	candidate := ContentPreKeyPoolModel{
		Kind:              int32(principal.Kind),
		PrincipalPTID:     principal.ActorPTID,
		PrincipalDeviceID: principal.DeviceID,
		CurrentEpoch:      int64(epoch),
		CreatedAt:         at.UTC(),
		UpdatedAt:         at.UTC(),
	}
	result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&candidate)
	if result.Error != nil {
		return ContentPreKeyPoolModel{}, false,
			contentPreKeyStoreFailure("create Content PreKey pool", result.Error)
	}
	pool, found, err := findAndLockContentPreKeyPool(tx, principal)
	if err != nil {
		return ContentPreKeyPoolModel{}, false, err
	}
	if !found {
		return ContentPreKeyPoolModel{}, false, domain.NewError(
			domain.ErrorCodeInternal,
			contentPreKeyStoreOperation+".pool",
			"pool",
			"was not available after creation",
		)
	}
	return pool, result.RowsAffected == 1, nil
}

func findAndLockContentPreKeyPool(
	tx *gorm.DB,
	principal domain.ContentPreKeyPrincipal,
) (ContentPreKeyPoolModel, bool, error) {
	var pool ContentPreKeyPoolModel
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(contentPreKeyPoolPredicate(), contentPreKeyPoolArgs(principal)...).
		First(&pool).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ContentPreKeyPoolModel{}, false, nil
	}
	if err != nil {
		return ContentPreKeyPoolModel{}, false,
			contentPreKeyStoreFailure("lock Content PreKey pool", err)
	}
	return pool, true, nil
}

func contentPreKeyPoolPredicate() string {
	return "kind = ? AND principal_ptid = ? AND principal_device_id = ?"
}

func contentPreKeyPoolArgs(principal domain.ContentPreKeyPrincipal) []any {
	return []any{
		int32(principal.Kind),
		principal.ActorPTID,
		principal.DeviceID,
	}
}

func retireContentPreKeysBeforeEpoch(
	tx *gorm.DB,
	principal domain.ContentPreKeyPrincipal,
	epoch uint64,
	retiredAt time.Time,
) error {
	args := append(
		contentPreKeyPoolArgs(principal),
		int64(epoch),
	)
	if err := tx.Model(&ContentPreKeyModel{}).
		Where(
			contentPreKeyPoolPredicate()+
				" AND profile_or_recovery_epoch < ?"+
				" AND consumed_at IS NULL AND retired_at IS NULL",
			args...,
		).
		Update("retired_at", retiredAt.UTC()).Error; err != nil {
		return contentPreKeyStoreFailure("retire prior Content PreKey epoch", err)
	}
	return nil
}

func findContentPreKeyByIdentity(
	tx *gorm.DB,
	principal domain.ContentPreKeyPrincipal,
	keyID string,
	lock bool,
) (ContentPreKeyModel, bool, error) {
	var existing ContentPreKeyModel
	query := tx
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	args := append(contentPreKeyPoolArgs(principal), keyID)
	err := query.Where(
		contentPreKeyPoolPredicate()+" AND key_id = ?",
		args...,
	).First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ContentPreKeyModel{}, false, nil
	}
	if err != nil {
		return ContentPreKeyModel{}, false,
			contentPreKeyStoreFailure("lookup Content PreKey", err)
	}
	return existing, true, nil
}

func validateExactContentPreKeyReplay(
	existing ContentPreKeyModel,
	publication domain.ContentPreKeyPublication,
	verificationSource actormodel.ActorSigningKeyVerificationSource,
	prekey *securecontentpb.ContentOneTimePreKey,
) error {
	if uint64(existing.ProfileOrRecoveryEpoch) != prekey.GetProfileOrRecoveryEpoch() ||
		existing.PublishedByPTID != publication.Publisher.ActorPTID ||
		existing.PublishedByDeviceID != publication.Publisher.DeviceID ||
		existing.PublisherSigningKeyID != publication.PublisherSigningKeyID ||
		existing.PublisherProfileVersion != int64(
			publication.PublisherProfileVersion,
		) ||
		existing.PublisherVerificationSource != int32(verificationSource) ||
		existing.ExpectedPoolEpoch != int64(publication.ExpectedPoolEpoch) ||
		!bytes.Equal(existing.PublicKey, prekey.GetX25519PublicKey()) ||
		!bytes.Equal(existing.IssuerSignature, prekey.GetIssuerSignature()) {
		return domain.NewError(
			domain.ErrorCodeConflict,
			contentPreKeyStoreOperation+".publish",
			"prekey.key_id",
			"is already bound to different Content PreKey material",
		)
	}
	return nil
}

func validateContentPreKeyEpochTransition(
	publication domain.ContentPreKeyPublication,
	currentEpoch uint64,
	poolExisted bool,
	operation string,
) error {
	if !poolExisted {
		if publication.ExpectedPoolEpoch != 0 {
			return domain.NewError(
				domain.ErrorCodeStaleMaterial,
				operation,
				"expected_pool_epoch",
				"must be zero for the initial pool publication",
			)
		}
		if publication.Principal.Kind ==
			securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY &&
			publication.PoolEpoch != 1 {
			return domain.NewError(
				domain.ErrorCodeStaleMaterial,
				operation,
				"profile_or_recovery_epoch",
				"initial recovery publication must advance 0 -> 1",
			)
		}
		return nil
	}
	if publication.ExpectedPoolEpoch != currentEpoch {
		return domain.NewError(
			domain.ErrorCodeStaleMaterial,
			operation,
			"expected_pool_epoch",
			"does not match the current Content PreKey pool epoch",
		)
	}
	if publication.PoolEpoch < currentEpoch {
		return domain.NewError(
			domain.ErrorCodeStaleMaterial,
			operation,
			"profile_or_recovery_epoch",
			"would roll back the Content PreKey pool",
		)
	}
	if publication.Principal.Kind ==
		securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY &&
		publication.PoolEpoch != currentEpoch &&
		publication.PoolEpoch != currentEpoch+1 {
		return domain.NewError(
			domain.ErrorCodeStaleMaterial,
			operation,
			"profile_or_recovery_epoch",
			"recovery rotation must be N -> N+1",
		)
	}
	return nil
}

func verifyContentPreKeyPublicationSignatures(
	publication domain.ContentPreKeyPublication,
	publicKey []byte,
	operation string,
) error {
	for _, prekey := range publication.PreKeys {
		signingBytes, err := securecontentkernel.ContentPreKeySigningBytes(
			publication.SigningInput(prekey),
		)
		if err != nil {
			return domain.WrapError(
				domain.ErrorCodeInvalidMaterial,
				operation,
				err,
			)
		}
		if !ed25519.Verify(
			ed25519.PublicKey(publicKey),
			signingBytes,
			prekey.GetIssuerSignature(),
		) {
			return domain.NewError(
				domain.ErrorCodeInvalidMaterial,
				operation,
				"prekeys.issuer_signature",
				"does not verify against the active Actor device signing key",
			)
		}
	}
	return nil
}

func requireUnusedContentPreKeyPublicMaterial(
	tx *gorm.DB,
	publicKey []byte,
) error {
	publicKeyHash := sha256.Sum256(publicKey)
	var count int64
	if err := tx.Model(&ContentPreKeyModel{}).
		Where("public_key_sha256 = ?", publicKeyHash[:]).
		Count(&count).Error; err != nil {
		return contentPreKeyStoreFailure("lookup Content PreKey public material", err)
	}
	if count != 0 {
		return domain.NewError(
			domain.ErrorCodeConflict,
			contentPreKeyStoreOperation+".publish",
			"prekey.x25519_public_key",
			"is already bound to another Content PreKey identity",
		)
	}
	return nil
}

func (s *ContentPreKeyStore) reconcileAvailableContentPreKeys(
	ctx context.Context,
	tx *gorm.DB,
	principal domain.ContentPreKeyPrincipal,
	epoch uint64,
	retiredAt time.Time,
	operation string,
) (int64, error) {
	candidates, err := listAvailableContentPreKeys(tx, principal, epoch)
	if err != nil {
		return 0, err
	}
	publisherKeys, ineligiblePublishers, err :=
		s.resolveAndFenceContentPreKeyPublishers(
			ctx,
			tx,
			candidates,
			operation,
		)
	if err != nil {
		return 0, err
	}

	var available int64
	for _, candidate := range candidates {
		binding, err := contentPreKeyPublisherBindingFromModel(candidate)
		if err != nil {
			return 0, err
		}
		if ineligiblePublishers[binding.key()] != nil {
			if err := retireContentPreKeyCandidate(
				tx,
				candidate.ID,
				retiredAt,
			); err != nil {
				return 0, err
			}
			continue
		}
		key := publisherKeys[binding.key()]
		if key == nil {
			return 0, domain.NewError(
				domain.ErrorCodeConflict,
				operation,
				"publisher",
				"changed while the Content PreKey pool was locked",
			)
		}
		if _, err := verifyPersistedContentPreKey(
			candidate,
			map[string]*actormodel.VerifiedActorDeviceSigningKey{
				binding.key(): key,
			},
			operation,
			false,
		); err != nil {
			return 0, err
		}
		available++
	}
	return available, nil
}

func listAvailableContentPreKeys(
	tx *gorm.DB,
	principal domain.ContentPreKeyPrincipal,
	epoch uint64,
) ([]ContentPreKeyModel, error) {
	args := append(contentPreKeyPoolArgs(principal), epoch)
	var prekeys []ContentPreKeyModel
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			contentPreKeyPoolPredicate()+
				" AND profile_or_recovery_epoch = ?"+
				" AND consumed_at IS NULL AND retired_at IS NULL"+
				" AND claim_id = '' AND claim_plan_id = ''",
			args...,
		).
		Order("created_at ASC, key_id ASC, id ASC").
		Find(&prekeys).Error
	if err != nil {
		return nil,
			contentPreKeyStoreFailure(
				"select available Content PreKey",
				err,
			)
	}
	return prekeys, nil
}

func selectClaimableContentPreKey(
	tx *gorm.DB,
	candidates []ContentPreKeyModel,
	publisherKeys map[string]*actormodel.VerifiedActorDeviceSigningKey,
	ineligiblePublishers map[string]error,
	retiredAt time.Time,
	operation string,
) (ContentPreKeyModel, *securecontentpb.ContentOneTimePreKey, error) {
	var firstIneligible error
	for _, candidate := range candidates {
		binding, err := contentPreKeyPublisherBindingFromModel(candidate)
		if err != nil {
			return ContentPreKeyModel{}, nil, err
		}
		if err := ineligiblePublishers[binding.key()]; err != nil {
			if firstIneligible == nil {
				firstIneligible = err
			}
			if retireErr := retireContentPreKeyCandidate(
				tx,
				candidate.ID,
				retiredAt,
			); retireErr != nil {
				return ContentPreKeyModel{}, nil, retireErr
			}
			continue
		}
		key := publisherKeys[binding.key()]
		if key == nil {
			return ContentPreKeyModel{}, nil, domain.NewError(
				domain.ErrorCodeConflict,
				operation,
				"publisher",
				"changed while the Content PreKey pool was locked",
			)
		}
		wire, err := verifyPersistedContentPreKey(
			candidate,
			map[string]*actormodel.VerifiedActorDeviceSigningKey{
				binding.key(): key,
			},
			operation,
			false,
		)
		if err != nil {
			return ContentPreKeyModel{}, nil, err
		}
		return candidate, wire, nil
	}
	if firstIneligible != nil {
		return ContentPreKeyModel{}, nil, firstIneligible
	}
	return ContentPreKeyModel{}, nil, domain.NewError(
		domain.ErrorCodePoolDepleted,
		operation,
		"pool",
		"has no claimable Content PreKey material",
	)
}

func retireContentPreKeyCandidate(
	tx *gorm.DB,
	id uint,
	retiredAt time.Time,
) error {
	result := tx.Model(&ContentPreKeyModel{}).
		Where("id = ? AND consumed_at IS NULL AND retired_at IS NULL", id).
		Update("retired_at", retiredAt.UTC())
	if result.Error != nil {
		return contentPreKeyStoreFailure(
			"retire ineligible Content PreKey",
			result.Error,
		)
	}
	if result.RowsAffected != 1 {
		return domain.NewError(
			domain.ErrorCodeStaleMaterial,
			contentPreKeyStoreOperation+".claim",
			"prekey",
			"changed before retirement",
		)
	}
	return nil
}

type contentPreKeyPublisherBinding struct {
	Publisher          domain.Endpoint
	SigningKeyID       string
	ProfileVersion     uint64
	VerificationSource actormodel.ActorSigningKeyVerificationSource
}

func (b contentPreKeyPublisherBinding) key() string {
	return strings.Join(
		[]string{
			b.Publisher.ActorPTID,
			b.Publisher.DeviceID,
			b.SigningKeyID,
			strconv.FormatUint(b.ProfileVersion, 10),
			strconv.FormatInt(int64(b.VerificationSource), 10),
		},
		"\x00",
	)
}

func (s *ContentPreKeyStore) resolveAndFenceContentPreKeyPublisher(
	ctx context.Context,
	tx *gorm.DB,
	publication domain.ContentPreKeyPublication,
	operation string,
) (*actormodel.VerifiedActorDeviceSigningKey, error) {
	resolved, err := s.publishers.ResolveVerifiedActorDeviceSigningKey(
		ctx,
		contentPreKeyTransaction{db: tx},
		publication.Publisher.ActorPTID,
		publication.Publisher.DeviceID,
		publication.PublisherSigningKeyID,
	)
	if err != nil {
		return nil, mapContentPreKeyActorIdentityError(operation, err)
	}
	if resolved == nil {
		return nil, domain.NewError(
			domain.ErrorCodeUnauthorized,
			operation,
			"publisher",
			"has no verified Actor device signing key",
		)
	}
	if resolved.GetActorPtid() != publication.Publisher.ActorPTID ||
		resolved.GetActorDeviceId() != publication.Publisher.DeviceID ||
		resolved.GetSigningKeyId() != publication.PublisherSigningKeyID ||
		len(resolved.GetEd25519PublicKey()) != ed25519.PublicKeySize ||
		!trustedContentPreKeyVerificationSource(
			resolved.GetVerificationSource(),
		) {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidMaterial,
			operation,
			"publisher_signing_key",
			"does not match the requested verified Actor device key",
		)
	}
	if resolved.GetRevokedAtUnixMs() != 0 {
		return nil, domain.NewError(
			domain.ErrorCodeUnauthorized,
			operation,
			"publisher",
			"was revoked",
		)
	}
	if resolved.GetProfileVersion() <= 0 ||
		uint64(resolved.GetProfileVersion()) !=
			publication.PublisherProfileVersion {
		return nil, domain.NewError(
			domain.ErrorCodeStaleMaterial,
			operation,
			"publisher_profile_version",
			"does not match the current Actor device profile",
		)
	}
	if err := actoridentitypersistence.
		RequireVerifiedActorDeviceSigningKeyForMutation(tx, resolved); err != nil {
		return nil, mapContentPreKeyActorIdentityError(operation, err)
	}
	return resolved, nil
}

func (s *ContentPreKeyStore) verifyContentPreKeyClientAuthorization(
	ctx context.Context,
	authorization domain.ContentPreKeyClientAuthorization,
	operation string,
) (*actormodel.VerifiedActorDeviceSigningKey, error) {
	resolved, err := s.publishers.ResolveVerifiedActorDeviceSigningKey(
		ctx,
		contentPreKeyTransaction{db: s.db.WithContext(ctx)},
		authorization.Publisher.ActorPTID,
		authorization.Publisher.DeviceID,
		authorization.SigningKeyID,
	)
	if err != nil {
		return nil, mapContentPreKeyClientActorIdentityError(operation, err)
	}
	if resolved == nil ||
		resolved.GetActorPtid() != authorization.Publisher.ActorPTID ||
		resolved.GetActorDeviceId() != authorization.Publisher.DeviceID ||
		resolved.GetSigningKeyId() != authorization.SigningKeyID ||
		resolved.GetProfileVersion() <= 0 ||
		uint64(resolved.GetProfileVersion()) != authorization.ProfileVersion ||
		resolved.GetRevokedAtUnixMs() != 0 ||
		len(resolved.GetEd25519PublicKey()) != ed25519.PublicKeySize ||
		!trustedContentPreKeyVerificationSource(
			resolved.GetVerificationSource(),
		) {
		return nil, domain.NewError(
			domain.ErrorCodeUnauthorized,
			operation,
			"proof.input.publisher",
			"is not the active verified Actor endpoint",
		)
	}
	if !ed25519.Verify(
		resolved.GetEd25519PublicKey(),
		authorization.SigningBytes,
		authorization.Signature,
	) {
		return nil, domain.NewError(
			domain.ErrorCodeUnauthorized,
			operation,
			"proof.signature",
			"is invalid",
		)
	}
	return resolved, nil
}

func fenceContentPreKeyClientAuthorization(
	tx *gorm.DB,
	verified *actormodel.VerifiedActorDeviceSigningKey,
	operation string,
) error {
	if err := actoridentitypersistence.
		RequireVerifiedActorDeviceSigningKeyForMutation(tx, verified); err != nil {
		return mapContentPreKeyClientActorIdentityError(operation, err)
	}
	return nil
}

func (s *ContentPreKeyStore) resolveAndFenceContentPreKeyPublishers(
	ctx context.Context,
	tx *gorm.DB,
	candidates []ContentPreKeyModel,
	operation string,
) (
	map[string]*actormodel.VerifiedActorDeviceSigningKey,
	map[string]error,
	error,
) {
	bindingsByKey := make(map[string]contentPreKeyPublisherBinding)
	for _, candidate := range candidates {
		binding, err := contentPreKeyPublisherBindingFromModel(candidate)
		if err != nil {
			return nil, nil, err
		}
		bindingsByKey[binding.key()] = binding
	}
	bindings := make(
		[]contentPreKeyPublisherBinding,
		0,
		len(bindingsByKey),
	)
	for _, binding := range bindingsByKey {
		bindings = append(bindings, binding)
	}
	sort.Slice(bindings, func(left int, right int) bool {
		return bindings[left].key() < bindings[right].key()
	})

	resolved := make(
		map[string]*actormodel.VerifiedActorDeviceSigningKey,
		len(bindings),
	)
	ineligible := make(map[string]error)
	for _, binding := range bindings {
		publication := domain.ContentPreKeyPublication{
			Publisher:               binding.Publisher,
			PublisherSigningKeyID:   binding.SigningKeyID,
			PublisherProfileVersion: binding.ProfileVersion,
		}
		key, err := s.resolveAndFenceContentPreKeyPublisher(
			ctx,
			tx,
			publication,
			operation,
		)
		if err != nil {
			if !isContentPreKeyPublisherIneligible(err) {
				return nil, nil, err
			}
			ineligible[binding.key()] = err
			continue
		}
		if key.GetVerificationSource() != binding.VerificationSource {
			ineligible[binding.key()] = domain.NewError(
				domain.ErrorCodeStaleMaterial,
				operation,
				"publisher_verification_source",
				"does not match the current Actor device projection",
			)
			continue
		}
		resolved[binding.key()] = key
	}
	return resolved, ineligible, nil
}

func contentPreKeyPublisherBindingFromModel(
	model ContentPreKeyModel,
) (contentPreKeyPublisherBinding, error) {
	if model.PublisherProfileVersion <= 0 {
		return contentPreKeyPublisherBinding{}, persistedContentPreKeyInvalid(
			"publisher_profile_version",
		)
	}
	binding := contentPreKeyPublisherBinding{
		Publisher: domain.Endpoint{
			ActorPTID: model.PublishedByPTID,
			DeviceID:  model.PublishedByDeviceID,
		},
		SigningKeyID:   model.PublisherSigningKeyID,
		ProfileVersion: uint64(model.PublisherProfileVersion),
		VerificationSource: actormodel.ActorSigningKeyVerificationSource(
			model.PublisherVerificationSource,
		),
	}
	if err := binding.Publisher.Validate(
		contentPreKeyStoreOperation + ".decode_publisher",
	); err != nil {
		return contentPreKeyPublisherBinding{}, persistedContentPreKeyInvalid(
			"publisher",
		)
	}
	if strings.TrimSpace(binding.SigningKeyID) == "" ||
		binding.SigningKeyID != strings.TrimSpace(binding.SigningKeyID) ||
		!trustedContentPreKeyVerificationSource(binding.VerificationSource) {
		return contentPreKeyPublisherBinding{}, persistedContentPreKeyInvalid(
			"publisher_signing_metadata",
		)
	}
	return binding, nil
}

func trustedContentPreKeyVerificationSource(
	source actormodel.ActorSigningKeyVerificationSource,
) bool {
	switch source {
	case actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION,
		actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE,
		actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_LOCATOR:
		return true
	default:
		return false
	}
}

func claimContentPreKeyReceipt(
	tx *gorm.DB,
	request *securecontentpb.ClaimContentPreKeysRequest,
	claimedAt time.Time,
) (ContentPreKeyClaimReceiptModel, bool, error) {
	canonicalRequestSHA256, err := canonicalContentPreKeyClaimRequestSHA256(
		request,
	)
	if err != nil {
		return ContentPreKeyClaimReceiptModel{}, false, err
	}
	candidate := ContentPreKeyClaimReceiptModel{
		PlanID: request.GetPlanId(),
		PlanRequestSHA256: append(
			[]byte(nil),
			request.GetPlanRequestSha256()...,
		),
		CanonicalRequestSHA256: append(
			[]byte(nil),
			canonicalRequestSHA256[:]...,
		),
		CreatedAt: claimedAt.UTC(),
	}
	result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&candidate)
	if result.Error != nil {
		return ContentPreKeyClaimReceiptModel{}, false,
			contentPreKeyStoreFailure("claim Content PreKey receipt", result.Error)
	}
	if result.RowsAffected == 1 {
		return candidate, true, nil
	}

	var existing ContentPreKeyClaimReceiptModel
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("plan_id = ?", request.GetPlanId()).
		First(&existing).Error; err != nil {
		return ContentPreKeyClaimReceiptModel{}, false,
			contentPreKeyStoreFailure("load Content PreKey claim receipt", err)
	}
	return existing, false, nil
}

func deletePendingContentPreKeyClaimReceipt(
	tx *gorm.DB,
	planID string,
) error {
	result := tx.Where(
		"plan_id = ? AND response_bytes IS NULL",
		planID,
	).Delete(&ContentPreKeyClaimReceiptModel{})
	if result.Error != nil {
		return contentPreKeyStoreFailure(
			"delete pending Content PreKey claim receipt",
			result.Error,
		)
	}
	if result.RowsAffected != 1 {
		return domain.NewError(
			domain.ErrorCodeConflict,
			contentPreKeyStoreOperation+".claim",
			"plan_id",
			"pending receipt changed concurrently",
		)
	}
	return nil
}

func completeContentPreKeyClaimReceipt(
	tx *gorm.DB,
	receipt ContentPreKeyClaimReceiptModel,
	response *securecontentpb.ClaimContentPreKeysResponse,
	completedAt time.Time,
) error {
	responseBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(response)
	if err != nil {
		return contentPreKeyStoreFailure("encode Content PreKey claim receipt", err)
	}
	responseSHA256 := sha256.Sum256(responseBytes)
	completedAt = completedAt.UTC()
	result := tx.Model(&ContentPreKeyClaimReceiptModel{}).
		Where("plan_id = ? AND response_bytes IS NULL", receipt.PlanID).
		Updates(map[string]any{
			"response_bytes":  responseBytes,
			"response_sha256": responseSHA256[:],
			"completed_at":    completedAt,
		})
	if result.Error != nil {
		return contentPreKeyStoreFailure("complete Content PreKey claim receipt", result.Error)
	}
	if result.RowsAffected != 1 {
		return domain.NewError(
			domain.ErrorCodeConflict,
			contentPreKeyStoreOperation+".claim",
			"plan_id",
			"was completed concurrently",
		)
	}
	return nil
}

func (s *ContentPreKeyStore) decodeContentPreKeyClaimReceipt(
	ctx context.Context,
	tx *gorm.DB,
	receipt ContentPreKeyClaimReceiptModel,
	request *securecontentpb.ClaimContentPreKeysRequest,
) (*securecontentpb.ClaimContentPreKeysResponse, error) {
	const operation = contentPreKeyStoreOperation + ".replay"

	response, err := decodeCanonicalContentPreKeyClaimReceipt(
		receipt,
		request,
		operation,
	)
	if err != nil {
		return nil, err
	}
	if err := s.verifyCompletedContentPreKeyClaimReceipt(
		ctx,
		tx,
		request,
		response,
		operation,
	); err != nil {
		return nil, err
	}
	return response, nil
}

func decodeCanonicalContentPreKeyClaimReceipt(
	receipt ContentPreKeyClaimReceiptModel,
	request *securecontentpb.ClaimContentPreKeysRequest,
	operation string,
) (*securecontentpb.ClaimContentPreKeysResponse, error) {
	canonicalRequestSHA256, err := canonicalContentPreKeyClaimRequestSHA256(
		request,
	)
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(
		receipt.PlanRequestSHA256,
		request.GetPlanRequestSha256(),
	) || !bytes.Equal(
		receipt.CanonicalRequestSHA256,
		canonicalRequestSHA256[:],
	) {
		return nil, domain.NewError(
			domain.ErrorCodeConflict,
			operation,
			"plan_id",
			"was already used with a different plan request hash",
		)
	}
	if len(receipt.ResponseBytes) == 0 ||
		len(receipt.ResponseSHA256) != sha256.Size ||
		receipt.CompletedAt == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInternal,
			operation,
			"receipt",
			"is not durably complete",
		)
	}
	actualSHA256 := sha256.Sum256(receipt.ResponseBytes)
	if !bytes.Equal(actualSHA256[:], receipt.ResponseSHA256) {
		return nil, domain.NewError(
			domain.ErrorCodeInternal,
			operation,
			"response_sha256",
			"does not match persisted response bytes",
		)
	}
	var response securecontentpb.ClaimContentPreKeysResponse
	if err := proto.Unmarshal(receipt.ResponseBytes, &response); err != nil {
		return nil, contentPreKeyStoreFailure(
			"decode Content PreKey claim receipt",
			err,
		)
	}
	if len(response.ProtoReflect().GetUnknown()) != 0 ||
		response.GetExactReplay() {
		return nil, persistedContentPreKeyInvalid("receipt.exact_replay")
	}
	canonicalResponseBytes, err := proto.MarshalOptions{
		Deterministic: true,
	}.Marshal(&response)
	if err != nil || !bytes.Equal(canonicalResponseBytes, receipt.ResponseBytes) {
		return nil, persistedContentPreKeyInvalid("receipt.response_bytes")
	}
	return &response, nil
}

func (s *ContentPreKeyStore) verifyCompletedContentPreKeyClaimReceipt(
	ctx context.Context,
	tx *gorm.DB,
	request *securecontentpb.ClaimContentPreKeysRequest,
	response *securecontentpb.ClaimContentPreKeysResponse,
	operation string,
) error {
	if response == nil ||
		len(response.GetClaims()) != len(request.GetTargets()) {
		return persistedContentPreKeyInvalid("receipt.claims")
	}
	var planRequestSHA256 [sha256.Size]byte
	copy(planRequestSHA256[:], request.GetPlanRequestSha256())

	for index, claim := range response.GetClaims() {
		if claim == nil || len(claim.ProtoReflect().GetUnknown()) != 0 {
			return persistedContentPreKeyInvalid("receipt.claims")
		}
		if err := domain.ValidateClaimedContentPreKey(operation, claim); err != nil {
			return domain.WrapError(
				domain.ErrorCodeInvalidMaterial,
				operation,
				err,
			)
		}
		principal, err := domain.ContentPreKeyPrincipalFromTarget(
			operation,
			claim.GetTarget(),
		)
		if err != nil {
			return domain.WrapError(
				domain.ErrorCodeInvalidMaterial,
				operation,
				err,
			)
		}
		expectedPrincipal, err := domain.ContentPreKeyPrincipalFromTarget(
			operation,
			request.GetTargets()[index],
		)
		if err != nil || principal != expectedPrincipal {
			return persistedContentPreKeyInvalid("receipt.claims.target")
		}
		if !proto.Equal(claim.GetTarget(), principal.ClaimTarget()) {
			return persistedContentPreKeyInvalid("receipt.claims.target")
		}
		expectedClaimID := domain.NewContentPreKeyClaimID(
			request.GetPlanId(),
			planRequestSHA256,
			principal,
			claim.GetPrekey().GetKeyId(),
		)
		if claim.GetClaimId() != expectedClaimID {
			return persistedContentPreKeyInvalid("receipt.claims.claim_id")
		}

		var record ContentPreKeyModel
		err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"claim_id = ? AND claim_plan_id = ? AND consumed_at IS NOT NULL",
				claim.GetClaimId(),
				request.GetPlanId(),
			).
			First(&record).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return persistedContentPreKeyInvalid("receipt.claims.persisted_key")
		}
		if err != nil {
			return contentPreKeyStoreFailure(
				"load claimed Content PreKey",
				err,
			)
		}
		binding, err := contentPreKeyPublisherBindingFromModel(record)
		if err != nil {
			return err
		}
		key, err := s.publishers.ResolveRetainedActorDeviceSigningKey(
			ctx,
			contentPreKeyTransaction{db: tx},
			binding.Publisher.ActorPTID,
			binding.Publisher.DeviceID,
			binding.SigningKeyID,
		)
		if err != nil {
			return mapContentPreKeyActorIdentityError(operation, err)
		}
		if key == nil {
			return persistedContentPreKeyInvalid(
				"receipt.claims.publisher_signing_key",
			)
		}
		wire, err := verifyPersistedContentPreKey(
			record,
			map[string]*actormodel.VerifiedActorDeviceSigningKey{
				binding.key(): key,
			},
			operation,
			true,
		)
		if err != nil {
			return err
		}
		if !proto.Equal(wire, claim.GetPrekey()) {
			return persistedContentPreKeyInvalid("receipt.claims.prekey")
		}
	}
	return nil
}

func lockCurrentContentPreKeyClaimEpochs(
	tx *gorm.DB,
	principals []domain.ContentPreKeyPrincipal,
	operation string,
) (map[string]uint64, error) {
	currentEpochs := make(map[string]uint64, len(principals))

	for _, principal := range principals {
		pool, found, err := findAndLockContentPreKeyPool(tx, principal)
		if err != nil {
			return nil, err
		}
		if !found || pool.CurrentEpoch <= 0 {
			return nil, persistedContentPreKeyInvalid(
				"receipt.claims.pool",
			)
		}
		if principal.Kind ==
			securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY {
			currentEpochs[principal.Key()] = uint64(pool.CurrentEpoch)
		}
	}

	for _, principal := range principals {
		endpoint, isEndpoint := principal.Endpoint()
		if !isEndpoint {
			continue
		}
		profileVersion, err :=
			actoridentitypersistence.LockActiveDeviceProfileVersionForMutation(
				tx,
				actoridentitypersistence.DeviceLocator{
					PTID:     endpoint.ActorPTID,
					DeviceID: endpoint.DeviceID,
				},
			)
		if err != nil {
			return nil, mapContentPreKeyActorIdentityError(operation, err)
		}
		currentEpochs[principal.Key()] = profileVersion
	}

	return currentEpochs, nil
}

func validateCurrentContentPreKeyClaimEpochs(
	response *securecontentpb.ClaimContentPreKeysResponse,
	currentEpochs map[string]uint64,
	operation string,
) error {
	for _, claim := range response.GetClaims() {
		principal, err := domain.ContentPreKeyPrincipalFromTarget(
			operation,
			claim.GetTarget(),
		)
		if err != nil {
			return domain.WrapError(
				domain.ErrorCodeInvalidMaterial,
				operation,
				err,
			)
		}
		currentEpoch, found := currentEpochs[principal.Key()]
		if !found || currentEpoch == 0 {
			return persistedContentPreKeyInvalid(
				"receipt.claims.current_epoch",
			)
		}
		if claim.GetPrekey().GetProfileOrRecoveryEpoch() != currentEpoch {
			return domain.NewError(
				domain.ErrorCodeStaleMaterial,
				operation,
				"claims.prekey.profile_or_recovery_epoch",
				"does not match the current principal epoch",
			)
		}
	}

	return nil
}

func canonicalContentPreKeyClaimRequestSHA256(
	request *securecontentpb.ClaimContentPreKeysRequest,
) ([sha256.Size]byte, error) {
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(request)
	if err != nil {
		return [sha256.Size]byte{}, contentPreKeyStoreFailure(
			"encode canonical Content PreKey claim request",
			err,
		)
	}
	return sha256.Sum256(encoded), nil
}

func verifyPersistedContentPreKey(
	model ContentPreKeyModel,
	publisherKeys map[string]*actormodel.VerifiedActorDeviceSigningKey,
	operation string,
	allowHistoricalPublisherProfile bool,
) (*securecontentpb.ContentOneTimePreKey, error) {
	prekey, err := contentPreKeyFromModel(model)
	if err != nil {
		return nil, domain.WrapError(
			domain.ErrorCodeInvalidMaterial,
			operation,
			err,
		)
	}
	binding, err := contentPreKeyPublisherBindingFromModel(model)
	if err != nil {
		return nil, err
	}
	if model.ExpectedPoolEpoch < 0 {
		return nil, persistedContentPreKeyInvalid("expected_pool_epoch")
	}
	request := &securecontentpb.PublishContentPreKeysRequest{
		Publisher: &actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: binding.Publisher.ActorPTID,
			},
			DeviceId: binding.Publisher.DeviceID,
		},
		PublisherSigningKeyId:   binding.SigningKeyID,
		PublisherProfileVersion: binding.ProfileVersion,
		ExpectedPoolEpoch:       uint64(model.ExpectedPoolEpoch),
		Prekeys:                 []*securecontentpb.ContentOneTimePreKey{prekey},
	}
	publication, err := domain.NormalizePublishContentPreKeysRequest(
		operation,
		binding.Publisher,
		request,
	)
	if err != nil {
		return nil, domain.WrapError(
			domain.ErrorCodeInvalidMaterial,
			operation,
			err,
		)
	}
	key := publisherKeys[binding.key()]
	profileVersionMismatch := key != nil &&
		((!allowHistoricalPublisherProfile &&
			uint64(key.GetProfileVersion()) != binding.ProfileVersion) ||
			(allowHistoricalPublisherProfile &&
				uint64(key.GetProfileVersion()) < binding.ProfileVersion))
	if key == nil ||
		key.GetActorPtid() != binding.Publisher.ActorPTID ||
		key.GetActorDeviceId() != binding.Publisher.DeviceID ||
		key.GetSigningKeyId() != binding.SigningKeyID ||
		key.GetProfileVersion() <= 0 ||
		profileVersionMismatch ||
		key.GetVerificationSource() != binding.VerificationSource ||
		len(key.GetEd25519PublicKey()) != ed25519.PublicKeySize {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidMaterial,
			operation,
			"publisher",
			"does not match the persisted verified publisher binding",
		)
	}
	if err := verifyContentPreKeyPublicationSignatures(
		publication,
		key.GetEd25519PublicKey(),
		operation,
	); err != nil {
		return nil, err
	}
	return prekey, nil
}

func contentPreKeyFromModel(
	model ContentPreKeyModel,
) (*securecontentpb.ContentOneTimePreKey, error) {
	if model.ProfileOrRecoveryEpoch <= 0 {
		return nil, persistedContentPreKeyInvalid(
			"profile_or_recovery_epoch",
		)
	}
	principal := domain.ContentPreKeyPrincipal{
		Kind:      securecontentpb.ContentPreKeyKind(model.Kind),
		ActorPTID: model.PrincipalPTID,
		DeviceID:  model.PrincipalDeviceID,
	}
	prekey := &securecontentpb.ContentOneTimePreKey{
		Kind:                   principal.Kind,
		KeyId:                  model.KeyID,
		X25519PublicKey:        append([]byte(nil), model.PublicKey...),
		ProfileOrRecoveryEpoch: uint64(model.ProfileOrRecoveryEpoch),
		IssuerSignature:        append([]byte(nil), model.IssuerSignature...),
	}
	switch principal.Kind {
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT:
		prekey.Principal = &securecontentpb.ContentOneTimePreKey_Endpoint{
			Endpoint: principal.ClaimTarget().GetEndpoint(),
		}
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY:
		prekey.Principal = &securecontentpb.ContentOneTimePreKey_RecoveryActor{
			RecoveryActor: principal.ClaimTarget().GetRecoveryActor(),
		}
	}
	normalized, normalizedPrincipal, err := domain.NormalizeContentPreKey(
		contentPreKeyStoreOperation+".decode",
		prekey,
	)
	if err != nil {
		return nil, err
	}
	if normalizedPrincipal != principal {
		return nil, domain.NewError(
			domain.ErrorCodeInternal,
			contentPreKeyStoreOperation+".decode",
			"principal",
			"does not match persisted Content PreKey identity",
		)
	}
	publicKeySHA256 := sha256.Sum256(normalized.GetX25519PublicKey())
	if !bytes.Equal(publicKeySHA256[:], model.PublicKeySHA256) {
		return nil, domain.NewError(
			domain.ErrorCodeInternal,
			contentPreKeyStoreOperation+".decode",
			"public_key_sha256",
			"does not match persisted Content PreKey material",
		)
	}
	return normalized, nil
}

func persistedContentPreKeyInvalid(field string) error {
	return domain.NewError(
		domain.ErrorCodeInvalidMaterial,
		contentPreKeyStoreOperation+".decode",
		field,
		"does not satisfy the persisted Content PreKey contract",
	)
}

func claimContentPreKeyPublicationReceipt(
	tx *gorm.DB,
	authorization domain.ContentPreKeyClientAuthorization,
	commandID string,
	createdAt time.Time,
) (ContentPreKeyPublicationReceiptModel, error) {
	candidate := ContentPreKeyPublicationReceiptModel{
		PublisherPTID:     authorization.Publisher.ActorPTID,
		PublisherDeviceID: authorization.Publisher.DeviceID,
		CommandID:         commandID,
		RequestBytes:      append([]byte(nil), authorization.RequestBytes...),
		RequestSHA256:     append([]byte(nil), authorization.RequestSHA256[:]...),
		State:             contentPreKeyPublicationReceiptStatePending,
		CreatedAt:         createdAt.UTC(),
	}
	result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&candidate)
	if result.Error != nil {
		return ContentPreKeyPublicationReceiptModel{},
			contentPreKeyStoreFailure("reserve publication receipt", result.Error)
	}

	var receipt ContentPreKeyPublicationReceiptModel
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"publisher_ptid = ? AND publisher_device_id = ? AND command_id = ?",
			candidate.PublisherPTID,
			candidate.PublisherDeviceID,
			candidate.CommandID,
		).
		First(&receipt).Error; err != nil {
		return ContentPreKeyPublicationReceiptModel{},
			contentPreKeyStoreFailure("lock publication receipt", err)
	}
	requestHash := sha256.Sum256(receipt.RequestBytes)
	if len(receipt.RequestBytes) == 0 ||
		len(receipt.RequestSHA256) != sha256.Size ||
		!bytes.Equal(requestHash[:], receipt.RequestSHA256) {
		return ContentPreKeyPublicationReceiptModel{}, persistedContentPreKeyInvalid(
			"publication_receipt.request_sha256",
		)
	}
	if !bytes.Equal(receipt.RequestSHA256, authorization.RequestSHA256[:]) ||
		!bytes.Equal(receipt.RequestBytes, authorization.RequestBytes) {
		return ContentPreKeyPublicationReceiptModel{}, domain.NewError(
			domain.ErrorCodeConflict,
			contentPreKeyStoreOperation+".publish",
			"command_id",
			"is already bound to another publication request",
		)
	}
	switch receipt.State {
	case contentPreKeyPublicationReceiptStatePending:
		if result.RowsAffected != 1 ||
			receipt.CompletedAt != nil ||
			len(receipt.ResponseBytes) != 0 ||
			len(receipt.ResponseSHA256) != 0 {
			return ContentPreKeyPublicationReceiptModel{}, persistedContentPreKeyInvalid(
				"publication_receipt.state",
			)
		}
	case contentPreKeyPublicationReceiptStateComplete:
		if result.RowsAffected != 0 ||
			receipt.CompletedAt == nil ||
			len(receipt.ResponseBytes) == 0 ||
			len(receipt.ResponseSHA256) != sha256.Size ||
			receipt.CompletedAt.Before(receipt.CreatedAt) {
			return ContentPreKeyPublicationReceiptModel{}, persistedContentPreKeyInvalid(
				"publication_receipt.state",
			)
		}
	default:
		return ContentPreKeyPublicationReceiptModel{}, domain.NewError(
			domain.ErrorCodeInvalidMaterial,
			contentPreKeyStoreOperation+".decode",
			"publication_receipt.state",
			"is not a recognized publication receipt state",
		)
	}
	return receipt, nil
}

func completeContentPreKeyPublicationReceipt(
	tx *gorm.DB,
	receipt ContentPreKeyPublicationReceiptModel,
	response *securecontentpb.PublishContentPreKeysResponse,
	completedAt time.Time,
) error {
	response.ExactReplay = false
	responseBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(response)
	if err != nil {
		return contentPreKeyStoreFailure("encode publication receipt", err)
	}
	responseHash := sha256.Sum256(responseBytes)
	result := tx.Model(&ContentPreKeyPublicationReceiptModel{}).
		Where(
			"publisher_ptid = ? AND publisher_device_id = ? AND command_id = ? "+
				"AND state = ? AND completed_at IS NULL",
			receipt.PublisherPTID,
			receipt.PublisherDeviceID,
			receipt.CommandID,
			contentPreKeyPublicationReceiptStatePending,
		).
		Updates(map[string]any{
			"response_bytes":  responseBytes,
			"response_sha256": responseHash[:],
			"state":           contentPreKeyPublicationReceiptStateComplete,
			"completed_at":    completedAt.UTC(),
		})
	if result.Error != nil {
		return contentPreKeyStoreFailure("complete publication receipt", result.Error)
	}
	if result.RowsAffected != 1 {
		return domain.NewError(
			domain.ErrorCodeConflict,
			contentPreKeyStoreOperation+".publish",
			"publication_receipt",
			"completion lost transaction ownership",
		)
	}
	return nil
}

func decodeContentPreKeyPublicationReceipt(
	receipt ContentPreKeyPublicationReceiptModel,
	expectedPrincipal domain.ContentPreKeyPrincipal,
	expectedEpoch uint64,
) (*securecontentpb.PublishContentPreKeysResponse, error) {
	if receipt.State != contentPreKeyPublicationReceiptStateComplete ||
		receipt.CompletedAt == nil ||
		receipt.CompletedAt.Before(receipt.CreatedAt) ||
		len(receipt.ResponseBytes) == 0 ||
		len(receipt.ResponseSHA256) != sha256.Size {
		return nil, persistedContentPreKeyInvalid(
			"publication_receipt.state",
		)
	}
	hash := sha256.Sum256(receipt.ResponseBytes)
	if !bytes.Equal(hash[:], receipt.ResponseSHA256) {
		return nil, persistedContentPreKeyInvalid(
			"publication_receipt.response_sha256",
		)
	}
	var response securecontentpb.PublishContentPreKeysResponse
	if err := proto.Unmarshal(receipt.ResponseBytes, &response); err != nil {
		return nil, persistedContentPreKeyInvalid(
			"publication_receipt.response_bytes",
		)
	}
	canonical, err := proto.MarshalOptions{Deterministic: true}.Marshal(&response)
	if err != nil || !bytes.Equal(canonical, receipt.ResponseBytes) ||
		response.GetExactReplay() {
		return nil, persistedContentPreKeyInvalid(
			"publication_receipt.response_bytes",
		)
	}
	if _, err := contentPreKeyInventoryFromResponse(
		response.GetInventory(),
		expectedPrincipal,
		expectedEpoch,
	); err != nil {
		return nil, err
	}
	replayed := proto.Clone(&response).(*securecontentpb.PublishContentPreKeysResponse)
	replayed.ExactReplay = true
	return replayed, nil
}

func contentPreKeyInventoryResponse(
	inventory domain.ContentPreKeyInventory,
) *securecontentpb.ContentPreKeyInventory {
	return &securecontentpb.ContentPreKeyInventory{
		Target:             inventory.Principal.ClaimTarget(),
		CurrentEpoch:       inventory.CurrentEpoch,
		Available:          uint32(inventory.Available),
		Capacity:           uint32(inventory.Capacity),
		ReplenishAtOrBelow: uint32(inventory.ReplenishAtOrBelow),
		NeedsReplenishment: inventory.NeedsReplenishment,
	}
}

func contentPreKeyInventoryFromResponse(
	inventory *securecontentpb.ContentPreKeyInventory,
	expectedPrincipal domain.ContentPreKeyPrincipal,
	expectedEpoch uint64,
) (domain.ContentPreKeyInventory, error) {
	if inventory == nil {
		return domain.ContentPreKeyInventory{}, persistedContentPreKeyInvalid(
			"publication_receipt.inventory",
		)
	}
	principal, err := domain.ContentPreKeyPrincipalFromTarget(
		contentPreKeyStoreOperation+".decode_publication_receipt",
		inventory.GetTarget(),
	)
	if err != nil {
		return domain.ContentPreKeyInventory{}, persistedContentPreKeyInvalid(
			"publication_receipt.inventory",
		)
	}
	expected := domain.NewContentPreKeyInventory(
		principal,
		inventory.GetCurrentEpoch(),
		int64(inventory.GetAvailable()),
	)
	if principal != expectedPrincipal ||
		inventory.GetCurrentEpoch() != expectedEpoch ||
		inventory.GetAvailable() == 0 ||
		inventory.GetAvailable() > uint32(domain.MaxContentPreKeysPerPool) ||
		inventory.GetCapacity() != uint32(expected.Capacity) ||
		inventory.GetReplenishAtOrBelow() != uint32(expected.ReplenishAtOrBelow) ||
		inventory.GetNeedsReplenishment() != expected.NeedsReplenishment {
		return domain.ContentPreKeyInventory{}, persistedContentPreKeyInvalid(
			"publication_receipt.inventory",
		)
	}
	return expected, nil
}

func mapContentPreKeyClientActorIdentityError(
	operation string,
	err error,
) error {
	switch actoridentitydomain.CodeOf(err) {
	case actoridentitydomain.ErrorCodeInvalidProof,
		actoridentitydomain.ErrorCodeDeviceConflict:
		return domain.WrapError(domain.ErrorCodeUnauthorized, operation, err)
	default:
		return mapContentPreKeyActorIdentityError(operation, err)
	}
}

func mapContentPreKeyActorIdentityError(
	operation string,
	err error,
) error {
	if err == nil {
		return nil
	}
	switch actoridentitydomain.CodeOf(err) {
	case actoridentitydomain.ErrorCodeInvalidArgument:
		return domain.WrapError(domain.ErrorCodeInvalidArgument, operation, err)
	case actoridentitydomain.ErrorCodeUnauthorized,
		actoridentitydomain.ErrorCodeDeviceNotFound,
		actoridentitydomain.ErrorCodeDeviceRevoked:
		return domain.WrapError(domain.ErrorCodeUnauthorized, operation, err)
	case actoridentitydomain.ErrorCodeInvalidProof,
		actoridentitydomain.ErrorCodeDeviceConflict:
		return domain.WrapError(domain.ErrorCodeInvalidMaterial, operation, err)
	case actoridentitydomain.ErrorCodeIdentityConflict,
		actoridentitydomain.ErrorCodeStaleProfileVersion,
		actoridentitydomain.ErrorCodeFutureProfileVersion:
		return domain.WrapError(domain.ErrorCodeStaleMaterial, operation, err)
	default:
		return domain.WrapError(domain.ErrorCodeDependency, operation, err)
	}
}

func isContentPreKeyPublisherIneligible(err error) bool {
	switch domain.CodeOf(err) {
	case domain.ErrorCodeUnauthorized, domain.ErrorCodeStaleMaterial:
		return true
	default:
		return false
	}
}

func contentPreKeyDepleted(
	operation string,
	principal domain.ContentPreKeyPrincipal,
) error {
	return domain.NewError(
		domain.ErrorCodePoolDepleted,
		operation,
		"pool",
		"has no claimable "+contentPreKeyKindName(principal.Kind)+" material",
	)
}

func contentPreKeyKindName(kind securecontentpb.ContentPreKeyKind) string {
	switch kind {
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT:
		return "endpoint Content PreKey"
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY:
		return "actor-recovery Content PreKey"
	default:
		return "Content PreKey"
	}
}

func isContentPreKeyContention(err error) bool {
	if err == nil || errors.Is(err, gorm.ErrDuplicatedKey) {
		return err != nil
	}
	var sqlState interface {
		SQLState() string
	}
	if errors.As(err, &sqlState) {
		switch sqlState.SQLState() {
		case "23505", "40001", "40P01":
			return true
		}
	}
	message := err.Error()
	return strings.Contains(message, "SQLSTATE 23505") ||
		strings.Contains(message, "UNIQUE constraint failed")
}

func contentPreKeyStoreFailure(operation string, err error) error {
	if err == nil {
		return nil
	}
	if domain.CodeOf(err) != "" {
		return err
	}
	return domain.WrapError(
		domain.ErrorCodeInternal,
		contentPreKeyStoreOperation+"."+strings.ReplaceAll(operation, " ", "_"),
		err,
	)
}

var _ application.ContentPreKeyStore = (*ContentPreKeyStore)(nil)
