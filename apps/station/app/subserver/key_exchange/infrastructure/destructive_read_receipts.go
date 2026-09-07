package infrastructure

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	kemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type DirectFetchReceiptModel struct {
	RequesterPTID     string    `gorm:"column:requester_ptid;size:255;primaryKey"`
	RequesterDeviceID string    `gorm:"column:requester_device_id;size:128;primaryKey"`
	RequestID         string    `gorm:"column:request_id;size:128;primaryKey"`
	RequestSHA256     []byte    `gorm:"column:request_sha256;type:bytea;not null"`
	ResponseBytes     []byte    `gorm:"column:response_bytes;type:bytea"`
	ResponseSHA256    []byte    `gorm:"column:response_sha256;type:bytea"`
	CreatedAt         time.Time `gorm:"column:created_at;not null"`
}

func (*DirectFetchReceiptModel) TableName() string {
	return "key_exchange_direct_fetch_receipts"
}

type MLSFetchReceiptModel struct {
	RequesterPTID     string    `gorm:"column:requester_ptid;size:255;primaryKey"`
	RequesterDeviceID string    `gorm:"column:requester_device_id;size:128;primaryKey"`
	RequestID         string    `gorm:"column:request_id;size:128;primaryKey"`
	RequestSHA256     []byte    `gorm:"column:request_sha256;type:bytea;not null"`
	ResponseBytes     []byte    `gorm:"column:response_bytes;type:bytea"`
	ResponseSHA256    []byte    `gorm:"column:response_sha256;type:bytea"`
	CreatedAt         time.Time `gorm:"column:created_at;not null"`
}

func (*MLSFetchReceiptModel) TableName() string {
	return "key_exchange_mls_fetch_receipts"
}

func (s *CanonicalStore) ReplayDirectBundles(
	ctx context.Context,
	identity domain.DestructiveReadIdentity,
) ([]domain.DirectKeyBundle, bool, error) {
	if err := identity.Validate("key_exchange.store.replay_direct_fetch"); err != nil {
		return nil, false, err
	}
	var receipt DirectFetchReceiptModel
	err := s.db.WithContext(ctx).
		Where(
			"requester_ptid = ? AND requester_device_id = ? AND request_id = ?",
			identity.Requester.ActorPTID,
			identity.Requester.DeviceID,
			identity.RequestID,
		).
		First(&receipt).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, storeFailure("load Direct fetch receipt", err)
	}
	bundles, err := decodeDirectFetchReceipt(receipt, identity)

	return bundles, true, err
}

func (s *CanonicalStore) ReplayMLSKeyPackage(
	ctx context.Context,
	identity domain.DestructiveReadIdentity,
) (*domain.MLSKeyPackage, bool, error) {
	if err := identity.Validate("key_exchange.store.replay_mls_fetch"); err != nil {
		return nil, false, err
	}
	var receipt MLSFetchReceiptModel
	err := s.db.WithContext(ctx).
		Where(
			"requester_ptid = ? AND requester_device_id = ? AND request_id = ?",
			identity.Requester.ActorPTID,
			identity.Requester.DeviceID,
			identity.RequestID,
		).
		First(&receipt).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, storeFailure("load MLS fetch receipt", err)
	}
	keyPackage, err := decodeMLSFetchReceipt(receipt, identity)

	return keyPackage, true, err
}

func claimDirectFetchReceipt(
	tx *gorm.DB,
	identity domain.DestructiveReadIdentity,
	now time.Time,
) (DirectFetchReceiptModel, bool, error) {
	candidate := DirectFetchReceiptModel{
		RequesterPTID:     identity.Requester.ActorPTID,
		RequesterDeviceID: identity.Requester.DeviceID,
		RequestID:         identity.RequestID,
		RequestSHA256:     append([]byte(nil), identity.RequestSHA256[:]...),
		CreatedAt:         now.UTC(),
	}
	result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&candidate)
	if result.Error != nil {
		return DirectFetchReceiptModel{}, false,
			storeFailure("claim Direct fetch receipt", result.Error)
	}
	if result.RowsAffected == 1 {
		return candidate, true, nil
	}

	var existing DirectFetchReceiptModel
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"requester_ptid = ? AND requester_device_id = ? AND request_id = ?",
			identity.Requester.ActorPTID,
			identity.Requester.DeviceID,
			identity.RequestID,
		).
		First(&existing).Error; err != nil {
		return DirectFetchReceiptModel{}, false,
			storeFailure("load claimed Direct fetch receipt", err)
	}

	return existing, false, nil
}

func claimMLSFetchReceipt(
	tx *gorm.DB,
	identity domain.DestructiveReadIdentity,
	now time.Time,
) (MLSFetchReceiptModel, bool, error) {
	candidate := MLSFetchReceiptModel{
		RequesterPTID:     identity.Requester.ActorPTID,
		RequesterDeviceID: identity.Requester.DeviceID,
		RequestID:         identity.RequestID,
		RequestSHA256:     append([]byte(nil), identity.RequestSHA256[:]...),
		CreatedAt:         now.UTC(),
	}
	result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&candidate)
	if result.Error != nil {
		return MLSFetchReceiptModel{}, false,
			storeFailure("claim MLS fetch receipt", result.Error)
	}
	if result.RowsAffected == 1 {
		return candidate, true, nil
	}

	var existing MLSFetchReceiptModel
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"requester_ptid = ? AND requester_device_id = ? AND request_id = ?",
			identity.Requester.ActorPTID,
			identity.Requester.DeviceID,
			identity.RequestID,
		).
		First(&existing).Error; err != nil {
		return MLSFetchReceiptModel{}, false,
			storeFailure("load claimed MLS fetch receipt", err)
	}

	return existing, false, nil
}

func completeDirectFetchReceipt(
	tx *gorm.DB,
	receipt DirectFetchReceiptModel,
	bundles []domain.DirectKeyBundle,
) error {
	responseBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		directFetchResponse(bundles),
	)
	if err != nil {
		return storeFailure("encode Direct fetch receipt", err)
	}
	responseHash := sha256.Sum256(responseBytes)
	result := tx.Model(&DirectFetchReceiptModel{}).
		Where(
			"requester_ptid = ? AND requester_device_id = ? AND request_id = ? "+
				"AND response_bytes IS NULL",
			receipt.RequesterPTID,
			receipt.RequesterDeviceID,
			receipt.RequestID,
		).
		Updates(map[string]interface{}{
			"response_bytes":  responseBytes,
			"response_sha256": responseHash[:],
		})
	if result.Error != nil {
		return storeFailure("complete Direct fetch receipt", result.Error)
	}
	if result.RowsAffected != 1 {
		return domain.NewError(
			domain.ErrorCodeConflict,
			"key_exchange.store.complete_direct_fetch",
			"request_id",
			"was completed concurrently",
		)
	}

	return nil
}

func completeMLSFetchReceipt(
	tx *gorm.DB,
	receipt MLSFetchReceiptModel,
	keyPackage *domain.MLSKeyPackage,
	homeStationID string,
) error {
	responseBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		mlsFetchResponse(keyPackage, homeStationID),
	)
	if err != nil {
		return storeFailure("encode MLS fetch receipt", err)
	}
	responseHash := sha256.Sum256(responseBytes)
	result := tx.Model(&MLSFetchReceiptModel{}).
		Where(
			"requester_ptid = ? AND requester_device_id = ? AND request_id = ? "+
				"AND response_bytes IS NULL",
			receipt.RequesterPTID,
			receipt.RequesterDeviceID,
			receipt.RequestID,
		).
		Updates(map[string]interface{}{
			"response_bytes":  responseBytes,
			"response_sha256": responseHash[:],
		})
	if result.Error != nil {
		return storeFailure("complete MLS fetch receipt", result.Error)
	}
	if result.RowsAffected != 1 {
		return domain.NewError(
			domain.ErrorCodeConflict,
			"key_exchange.store.complete_mls_fetch",
			"request_id",
			"was completed concurrently",
		)
	}

	return nil
}

func decodeDirectFetchReceipt(
	receipt DirectFetchReceiptModel,
	identity domain.DestructiveReadIdentity,
) ([]domain.DirectKeyBundle, error) {
	if err := validateReceipt(
		receipt.RequestSHA256,
		receipt.ResponseBytes,
		receipt.ResponseSHA256,
		identity.RequestSHA256,
		"key_exchange.store.replay_direct_fetch",
	); err != nil {
		return nil, err
	}
	var response kemodel.FetchDirectKeyBundlesResponse
	if err := proto.Unmarshal(receipt.ResponseBytes, &response); err != nil {
		return nil, storeFailure("decode Direct fetch receipt", err)
	}
	bundles := make([]domain.DirectKeyBundle, 0, len(response.GetBundles()))
	for _, bundle := range response.GetBundles() {
		if bundle == nil || bundle.GetDevice() == nil ||
			bundle.GetDevice().GetActor() == nil {
			return nil, domain.NewError(
				domain.ErrorCodeInternal,
				"key_exchange.store.replay_direct_fetch",
				"response",
				"contains an invalid persisted bundle",
			)
		}
		oneTimePreKeys := make(
			[]domain.DirectOneTimePreKey,
			0,
			len(bundle.GetOneTimePreKeys()),
		)
		for _, key := range bundle.GetOneTimePreKeys() {
			if key == nil {
				return nil, domain.NewError(
					domain.ErrorCodeInternal,
					"key_exchange.store.replay_direct_fetch",
					"response",
					"contains an invalid persisted one-time pre-key",
				)
			}
			publicKey, err := decodeReceiptBase64(
				"one_time_pre_keys.public_key",
				key.GetPublicKey(),
			)
			if err != nil {
				return nil, err
			}
			oneTimePreKeys = append(oneTimePreKeys, domain.DirectOneTimePreKey{
				KeyID:     key.GetKeyId(),
				PublicKey: publicKey,
			})
		}
		identityKey, err := decodeReceiptBase64(
			"identity_key_public",
			bundle.GetIdentityKeyPublic(),
		)
		if err != nil {
			return nil, err
		}
		signedPreKey, err := decodeReceiptBase64(
			"signed_pre_key_public",
			bundle.GetSignedPreKeyPublic(),
		)
		if err != nil {
			return nil, err
		}
		signedPreKeySignature, err := decodeReceiptBase64(
			"signed_pre_key_signature",
			bundle.GetSignedPreKeySignature(),
		)
		if err != nil {
			return nil, err
		}
		value := domain.DirectKeyBundle{
			Device: domain.Endpoint{
				ActorPTID: bundle.GetDevice().GetActor().GetPtid(),
				DeviceID:  bundle.GetDevice().GetDeviceId(),
			},
			IdentityKeyPublic:     identityKey,
			SignedPreKeyID:        bundle.GetSignedPreKeyId(),
			SignedPreKeyPublic:    signedPreKey,
			SignedPreKeySignature: signedPreKeySignature,
			OneTimePreKeys:        oneTimePreKeys,
			PublishedAt:           time.UnixMilli(bundle.GetPublishedAtUnixMs()).UTC(),
			SupportedWireVersions: append([]uint32(nil), bundle.GetSupportedWireVersions()...),
		}
		if err := value.Validate("key_exchange.store.replay_direct_fetch"); err != nil {
			return nil, err
		}
		bundles = append(bundles, value)
	}

	return bundles, nil
}

func decodeMLSFetchReceipt(
	receipt MLSFetchReceiptModel,
	identity domain.DestructiveReadIdentity,
) (*domain.MLSKeyPackage, error) {
	if err := validateReceipt(
		receipt.RequestSHA256,
		receipt.ResponseBytes,
		receipt.ResponseSHA256,
		identity.RequestSHA256,
		"key_exchange.store.replay_mls_fetch",
	); err != nil {
		return nil, err
	}
	var response kemodel.FetchMlsKeyPackageResponse
	if err := proto.Unmarshal(receipt.ResponseBytes, &response); err != nil {
		return nil, storeFailure("decode MLS fetch receipt", err)
	}
	if !response.GetAvailable() {
		if response.GetReservation() != nil {
			return nil, domain.NewError(
				domain.ErrorCodeInternal,
				"key_exchange.store.replay_mls_fetch",
				"response",
				"contains a reservation for an unavailable result",
			)
		}
		return nil, nil
	}
	reservation := response.GetReservation()
	if reservation == nil || reservation.GetTarget() == nil ||
		reservation.GetTarget().GetActor() == nil ||
		len(reservation.GetKeyPackageSha256()) != sha256.Size {
		return nil, domain.NewError(
			domain.ErrorCodeInternal,
			"key_exchange.store.replay_mls_fetch",
			"response",
			"contains an invalid persisted reservation",
		)
	}
	value := &domain.MLSKeyPackage{
		PackageID: reservation.GetPackageId(),
		Device: domain.Endpoint{
			ActorPTID: reservation.GetTarget().GetActor().GetPtid(),
			DeviceID:  reservation.GetTarget().GetDeviceId(),
		},
		HomeStation: response.GetHomeStationPeerId(),
		KeyPackage:  append([]byte(nil), reservation.GetKeyPackage()...),
		CreatedAt:   receipt.CreatedAt.UTC(),
	}
	copy(value.PackageHash[:], reservation.GetKeyPackageSha256())
	if err := value.Validate("key_exchange.store.replay_mls_fetch"); err != nil {
		return nil, err
	}

	return value, nil
}

func validateReceipt(
	requestSHA256 []byte,
	responseBytes []byte,
	responseSHA256 []byte,
	expectedRequestSHA256 [sha256.Size]byte,
	operation string,
) error {
	if !bytes.Equal(requestSHA256, expectedRequestSHA256[:]) {
		return domain.NewError(
			domain.ErrorCodeConflict,
			operation,
			"request_id",
			"was already used with different request bytes",
		)
	}
	if len(responseBytes) == 0 || len(responseSHA256) != sha256.Size {
		return domain.NewError(
			domain.ErrorCodeInternal,
			operation,
			"response",
			"is not durably complete",
		)
	}
	actual := sha256.Sum256(responseBytes)
	if !bytes.Equal(actual[:], responseSHA256) {
		return domain.NewError(
			domain.ErrorCodeInternal,
			operation,
			"response_sha256",
			"does not match persisted response bytes",
		)
	}

	return nil
}

func directFetchResponse(
	bundles []domain.DirectKeyBundle,
) *kemodel.FetchDirectKeyBundlesResponse {
	response := &kemodel.FetchDirectKeyBundlesResponse{
		Bundles: make([]*kemodel.DirectKeyBundle, 0, len(bundles)),
	}
	for _, bundle := range bundles {
		wire := &kemodel.DirectKeyBundle{
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
			PublishedAtUnixMs:     bundle.PublishedAt.UTC().UnixMilli(),
			SupportedWireVersions: append([]uint32(nil), bundle.SupportedWireVersions...),
		}
		for _, key := range bundle.OneTimePreKeys {
			wire.OneTimePreKeys = append(
				wire.OneTimePreKeys,
				&kemodel.DirectOneTimePreKey{
					KeyId:     key.KeyID,
					PublicKey: base64.StdEncoding.EncodeToString(key.PublicKey),
				},
			)
		}
		response.Bundles = append(response.Bundles, wire)
	}

	return response
}

func decodeReceiptBase64(field string, value string) ([]byte, error) {
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return nil, domain.WrapError(
			domain.ErrorCodeInternal,
			"key_exchange.store.decode_receipt_"+field,
			err,
		)
	}

	return decoded, nil
}

func mlsFetchResponse(
	keyPackage *domain.MLSKeyPackage,
	homeStationID string,
) *kemodel.FetchMlsKeyPackageResponse {
	response := &kemodel.FetchMlsKeyPackageResponse{
		Available:         keyPackage != nil,
		HomeStationPeerId: homeStationID,
	}
	if keyPackage == nil {
		return response
	}
	response.Reservation = &kemodel.MlsKeyPackageReservation{
		Target: &actormodel.ActorDeviceRef{
			Actor:    &actormodel.ActorRef{Ptid: keyPackage.Device.ActorPTID},
			DeviceId: keyPackage.Device.DeviceID,
		},
		PackageId:        keyPackage.PackageID,
		KeyPackage:       append([]byte(nil), keyPackage.KeyPackage...),
		KeyPackageSha256: append([]byte(nil), keyPackage.PackageHash[:]...),
	}

	return response
}
