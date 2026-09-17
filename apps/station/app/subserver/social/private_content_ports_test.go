package social

import (
	"context"
	"crypto/ed25519"
	"testing"
	"time"

	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPrivateContentStationSignerVerifiesRetainedProofKeyAfterRotation(
	t *testing.T,
) {
	ctx := context.Background()
	const stationPeerID = "station-social-test"

	keys := authfed.NewInMemoryKeyStore()
	oldKey, err := authfed.MintLocalKey(time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if err := keys.PutCurrent(ctx, oldKey); err != nil {
		t.Fatal(err)
	}
	authority, err := authfed.NewContentProofKeyAuthority(
		stationPeerID,
		keys,
	)
	if err != nil {
		t.Fatal(err)
	}
	adapter := privateContentStationSigner{
		stationPeerID:     stationPeerID,
		proofKeyAuthority: authority,
	}
	canonical := []byte("durable-content-proof")
	oldSigningKeyID, err := adapter.SigningKeyID(ctx)
	if err != nil || oldSigningKeyID != oldKey.Kid {
		t.Fatalf("initial signing key = %q, %v", oldSigningKeyID, err)
	}
	signature, err := adapter.Sign(ctx, oldSigningKeyID, canonical)
	if err != nil {
		t.Fatal(err)
	}

	newKey, err := authfed.MintLocalKey(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := keys.Rotate(ctx, stationPeerID, newKey); err != nil {
		t.Fatal(err)
	}
	previous, err := keys.Load(ctx, authfed.SlotPrev)
	if err != nil {
		t.Fatal(err)
	}
	cleared, err := keys.ClearPrev(
		ctx,
		previous.Kid,
		previous.UpdatedAt,
	)
	if err != nil || !cleared {
		t.Fatalf("clear previous key = %v, %v", cleared, err)
	}
	if _, err := adapter.Sign(ctx, oldKey.Kid, canonical); err == nil {
		t.Fatal("retired Station key remained usable for new signatures")
	}
	currentSigningKeyID, err := adapter.SigningKeyID(ctx)
	if err != nil || currentSigningKeyID != newKey.Kid {
		t.Fatalf("rotated signing key = %q, %v", currentSigningKeyID, err)
	}
	currentSignature, err := adapter.Sign(
		ctx,
		currentSigningKeyID,
		canonical,
	)
	if err != nil ||
		!ed25519.Verify(newKey.Pub, canonical, currentSignature) {
		t.Fatalf("current Station signing failed after rotation: %v", err)
	}
	if err := adapter.Verify(
		ctx,
		oldKey.Kid,
		canonical,
		signature,
	); err != nil {
		t.Fatalf("verify retained proof key after rotation: %v", err)
	}

	issuedAt := time.Now().UTC().Truncate(time.Microsecond)
	attestation, err := adapter.AttestContentProofVerificationKey(
		ctx,
		oldKey.Kid,
		issuedAt,
	)
	if err != nil {
		t.Fatalf("attest retained proof key after rotation: %v", err)
	}
	if attestation.GetProofSigningKeyId() != oldKey.Kid ||
		attestation.GetAttestingSigningKeyId() != newKey.Kid ||
		!attestation.GetIssuedAt().AsTime().Equal(issuedAt) {
		t.Fatalf("retained proof-key attestation = %+v", attestation)
	}
}

func TestPrivateContentStationSignerUsesCallerTransactionOnSingleConnectionSQLite(
	t *testing.T,
) {
	ctx := context.Background()
	database, err := gorm.Open(
		sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase.SetMaxOpenConns(1)
	if err := authfed.MigrateSchema(ctx, database); err != nil {
		t.Fatal(err)
	}
	keys := authfed.NewKeyStoreGORMWithDB(database)
	key, err := authfed.MintLocalKey(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := keys.PutCurrent(ctx, key); err != nil {
		t.Fatal(err)
	}
	authority, err := authfed.NewContentProofKeyAuthority(
		"station-sqlite-test",
		keys,
	)
	if err != nil {
		t.Fatal(err)
	}
	adapter := privateContentStationSigner{
		stationPeerID:     "station-sqlite-test",
		proofKeyAuthority: authority,
	}

	done := make(chan error, 1)
	go func() {
		done <- database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			transaction := testFederationTransaction{database: tx}
			keyID, err := adapter.SigningKeyIDInTransaction(
				ctx,
				transaction,
			)
			if err != nil {
				return err
			}
			canonical := []byte("transactional-proof")
			signature, err := adapter.SignInTransaction(
				ctx,
				transaction,
				keyID,
				canonical,
			)
			if err != nil {
				return err
			}
			return adapter.VerifyInTransaction(
				ctx,
				transaction,
				keyID,
				canonical,
				signature,
			)
		})
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("transactional proof-key access deadlocked")
	}
}

type testFederationTransaction struct {
	database *gorm.DB
}

func (t testFederationTransaction) DB() *gorm.DB {
	return t.database
}

func (testFederationTransaction) Outbox() federationdelivery.OutboxWriter {
	return nil
}
