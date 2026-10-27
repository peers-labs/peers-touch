package persistence_test

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestLinkedEnrollmentDoesNotActivateBeforeAckAndRollbackLeavesNoDevice(t *testing.T) {
	database, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := database.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	repository, err := persistence.NewRepository(database)
	require.NoError(t, err)
	require.NoError(t, repository.AutoMigrate())
	actorKey := ed25519.NewKeyFromSeed(make([]byte, 32))
	deviceKey := ed25519.NewKeyFromSeed(append([]byte{1}, make([]byte, 31)...))
	actorPublic := actorKey.Public().(ed25519.PublicKey)
	devicePublic := deviceKey.Public().(ed25519.PublicKey)
	fingerprint := sha256.Sum256(actorPublic)
	deviceFingerprint := sha256.Sum256(devicePublic)
	const ptid = "ptid:v1:actor:peers:p:bob:1220d112c4e53405d2df5b04355bc8cbde006d6f11db84bba1414bddd0d98ca55d2f"
	certificate := &actormodel.ActorDeviceCertificate{
		FormatVersion: 1, Device: &actormodel.ActorDeviceRef{
			Actor:    &actormodel.ActorRef{Ptid: ptid, Acct: "bob@example.test", Kind: actormodel.ActorKind_ACTOR_KIND_PERSON},
			DeviceId: "phone",
		},
		ActorIdentityPublicKey: actorPublic, ActorIdentityKeyFingerprint: fingerprint[:],
		DeviceSigningPublicKey: devicePublic, SigningKeyId: hex.EncodeToString(deviceFingerprint[:]),
		ObservedProfileVersion: 1,
	}
	bytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(certificate)
	require.NoError(t, err)
	enrollment := domain.Enrollment{
		FormatVersion: 1, PTID: ptid, ActorAccount: "bob@example.test", ActorKind: 1, DeviceID: "phone",
		Label: "Phone", HomeStationPeerID: "station-test", ActorIdentityPublicKey: actorPublic,
		ActorIdentityFingerprint: fingerprint[:], DeviceSigningPublicKey: devicePublic,
		SigningKeyID: certificate.SigningKeyId, ProfileVersion: 1, CanonicalCertificateBytes: bytes,
		ActorCrossSignature: ed25519.Sign(actorKey, bytes),
	}
	now := time.Now().UTC()
	require.NoError(t, database.Create(&persistence.ActorIdentityModel{
		PTID: ptid, PublicKey: actorPublic, Fingerprint: fingerprint[:], ProfileVersion: 1,
		CreatedAt: now, UpdatedAt: now,
	}).Error)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	require.NoError(t, database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		_, err := repository.LockLinkedActor(tx, ptid)
		require.NoError(t, err)
		return repository.ValidateLinkedEnrollment(tx, enrollment)
	}))
	assertCount := func(want int64) {
		var count int64
		require.NoError(t, database.Model(&persistence.ActorDeviceModel{}).Count(&count).Error)
		require.Equal(t, want, count)
	}
	assertCount(0)
	require.Error(t, database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		_, err := repository.CommitLinkedEnrollment(tx, enrollment, now)
		require.NoError(t, err)
		return errors.New("ack Session update failed")
	}))
	assertCount(0)
	require.NoError(t, database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		_, err := repository.CommitLinkedEnrollment(tx, enrollment, now)
		return err
	}))
	assertCount(1)
	require.NoError(t, database.Model(&persistence.ActorDeviceModel{}).
		Where("ptid = ?", ptid).Update("revoked", true).Error)
	require.Error(t, database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return repository.ValidateLinkedEnrollment(tx, enrollment)
	}))
	assertCount(1)
	require.Error(t, repository.ValidateLinkedEnrollment(database, enrollment))
}
