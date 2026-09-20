package federation

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"errors"
	"testing"
	"time"

	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	"google.golang.org/protobuf/encoding/protowire"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestGORMKeyStoreRotateArchivesBeforeRetireAtomically(t *testing.T) {
	ctx := context.Background()
	database := openContentProofKeyTestDatabase(t)
	store := NewKeyStoreGORMWithDB(database)

	first, err := MintLocalKey(time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatalf("mint first key: %v", err)
	}
	if err := store.PutCurrent(ctx, first); err != nil {
		t.Fatalf("put first key: %v", err)
	}

	second, err := MintLocalKey(time.Now())
	if err != nil {
		t.Fatalf("mint second key: %v", err)
	}
	if err := store.PutCurrent(ctx, second); !errors.Is(
		err,
		ErrLocalKeyReplacementRequiresRotation,
	) {
		t.Fatalf("direct current replacement error = %v, want rotation-required", err)
	}
	result, err := store.Rotate(ctx, testLocalStationPeerID, second)
	if err != nil {
		t.Fatalf("rotate: %v", err)
	}
	if result.PreviousKid != first.Kid {
		t.Fatalf("previous kid = %q, want %q", result.PreviousKid, first.Kid)
	}

	authority, err := NewContentProofKeyAuthority(testLocalStationPeerID, store)
	if err != nil {
		t.Fatalf("new authority: %v", err)
	}
	archived, err := authority.ResolveContentProofVerificationKey(
		ctx,
		testLocalStationPeerID,
		first.Kid,
	)
	if err != nil {
		t.Fatalf("resolve archived first key: %v", err)
	}
	if !bytes.Equal(archived, first.Pub) {
		t.Fatal("archived first public key does not match")
	}

	previous, err := store.Load(ctx, SlotPrev)
	if err != nil {
		t.Fatalf("load previous private key: %v", err)
	}
	cleared, err := store.ClearPrev(
		ctx,
		previous.Kid,
		previous.UpdatedAt,
	)
	if err != nil || !cleared {
		t.Fatalf("clear previous private key = %v, %v", cleared, err)
	}
	if _, err := store.Load(ctx, SlotPrev); !errors.Is(err, ErrNoLocalKey) {
		t.Fatalf("previous private key remains after finalization: %v", err)
	}
	archived, err = authority.ResolveContentProofVerificationKey(
		ctx,
		testLocalStationPeerID,
		first.Kid,
	)
	if err != nil || !bytes.Equal(archived, first.Pub) {
		t.Fatalf("public history did not survive private-key retirement: key=%x err=%v", archived, err)
	}

	conflicting, err := MintLocalKey(time.Now().Add(time.Minute))
	if err != nil {
		t.Fatalf("mint conflicting history key: %v", err)
	}
	now := time.Now()
	if err := database.Create(&contentProofVerificationKeyRow{
		StationPeerID:    testLocalStationPeerID,
		SigningKeyID:     second.Kid,
		Ed25519PublicKey: append([]byte(nil), conflicting.Pub...),
		FirstActiveAt:    now.Add(-time.Hour),
		LastActiveAt:     now,
		RetiredAt:        now,
		RetirementReason: "ROTATED",
	}).Error; err != nil {
		t.Fatalf("seed immutable history conflict: %v", err)
	}

	third, err := MintLocalKey(time.Now().Add(2 * time.Minute))
	if err != nil {
		t.Fatalf("mint third key: %v", err)
	}
	if _, err := store.Rotate(ctx, testLocalStationPeerID, third); err == nil {
		t.Fatal("rotation succeeded despite an immutable history conflict")
	}
	current, err := store.Load(ctx, SlotCurrent)
	if err != nil {
		t.Fatalf("load current after failed rotation: %v", err)
	}
	if current.Kid != second.Kid {
		t.Fatalf("failed archive retired current key: got %q want %q", current.Kid, second.Kid)
	}
	if _, err := store.Load(ctx, SlotPrev); !errors.Is(err, ErrNoLocalKey) {
		t.Fatalf("failed archive recreated previous private key: %v", err)
	}
}

func TestTransactionalContentProofSigningDoesNotReenterLifecycleLock(
	t *testing.T,
) {
	ctx := context.Background()
	database := openContentProofKeyTestDatabase(t)
	sqlDatabase, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase.SetMaxOpenConns(1)
	store := NewKeyStoreGORMWithDB(database)
	current, err := MintLocalKey(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.PutCurrent(ctx, current); err != nil {
		t.Fatal(err)
	}
	authority, err := NewContentProofKeyAuthority(
		testLocalStationPeerID,
		store,
	)
	if err != nil {
		t.Fatal(err)
	}
	transaction := database.WithContext(ctx).Begin()
	if transaction.Error != nil {
		t.Fatal(transaction.Error)
	}
	defer transaction.Rollback()

	localKeyLifecycleMu.Lock()
	defer localKeyLifecycleMu.Unlock()
	done := make(chan error, 1)
	go func() {
		keyID, keyErr := authority.CurrentSigningKeyIDInTransaction(
			ctx,
			transaction,
		)
		if keyErr != nil {
			done <- keyErr
			return
		}
		_, keyErr = authority.SignWithCurrentKeyInTransaction(
			ctx,
			transaction,
			keyID,
			[]byte("transactional-proof"),
		)
		done <- keyErr
	}()

	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("transactional signing re-entered the lifecycle lock")
	}
}

func TestGORMKeyStoreClearPrevDoesNotDeleteConcurrentRotation(t *testing.T) {
	ctx := context.Background()
	store := NewKeyStoreGORMWithDB(openContentProofKeyTestDatabase(t))
	first, _ := MintLocalKey(time.Now().Add(-3 * time.Hour))
	second, _ := MintLocalKey(time.Now().Add(-2 * time.Hour))
	third, _ := MintLocalKey(time.Now().Add(-time.Hour))
	if err := store.PutCurrent(ctx, first); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Rotate(ctx, testLocalStationPeerID, second); err != nil {
		t.Fatal(err)
	}
	stalePrevious, err := store.Load(ctx, SlotPrev)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Rotate(ctx, testLocalStationPeerID, third); err != nil {
		t.Fatal(err)
	}
	cleared, err := store.ClearPrev(
		ctx,
		stalePrevious.Kid,
		stalePrevious.UpdatedAt,
	)
	if err != nil {
		t.Fatal(err)
	}
	if cleared {
		t.Fatal("stale finalizer deleted a newly demoted previous key")
	}
	currentPrevious, err := store.Load(ctx, SlotPrev)
	if err != nil {
		t.Fatal(err)
	}
	if currentPrevious.Kid != second.Kid {
		t.Fatalf(
			"previous key = %q, want newly demoted %q",
			currentPrevious.Kid,
			second.Kid,
		)
	}
}

func TestContentProofKeyAuthoritySelfAttestsAndReattestsAfterRotation(t *testing.T) {
	ctx := context.Background()
	store := NewInMemoryKeyStore()
	first, err := MintLocalKey(time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatalf("mint first key: %v", err)
	}
	if err := store.PutCurrent(ctx, first); err != nil {
		t.Fatalf("put first key: %v", err)
	}
	authority, err := NewContentProofKeyAuthority(testLocalStationPeerID, store)
	if err != nil {
		t.Fatalf("new authority: %v", err)
	}

	issuedAt := time.Date(2026, 9, 14, 12, 0, 0, 123000000, time.UTC)
	selfAttestation, err := authority.AttestContentProofVerificationKey(
		ctx,
		first.Kid,
		issuedAt,
	)
	if err != nil {
		t.Fatalf("self-attest current key: %v", err)
	}
	assertContentProofKeyAttestation(
		t,
		selfAttestation,
		first.Kid,
		first.Kid,
		first.Pub,
		issuedAt,
	)

	second, err := MintLocalKey(issuedAt.Add(time.Minute))
	if err != nil {
		t.Fatalf("mint second key: %v", err)
	}
	if _, err := store.Rotate(ctx, testLocalStationPeerID, second); err != nil {
		t.Fatalf("rotate: %v", err)
	}

	reattested, err := authority.AttestContentProofVerificationKey(
		ctx,
		first.Kid,
		issuedAt.Add(2*time.Minute),
	)
	if err != nil {
		t.Fatalf("re-attest historical key: %v", err)
	}
	assertContentProofKeyAttestation(
		t,
		reattested,
		first.Kid,
		second.Kid,
		second.Pub,
		issuedAt.Add(2*time.Minute),
	)
	if !bytes.Equal(reattested.GetProofEd25519PublicKey(), first.Pub) {
		t.Fatal("re-attestation did not retain the original proof public key")
	}

	currentAttestation, err := authority.AttestContentProofVerificationKey(
		ctx,
		second.Kid,
		issuedAt.Add(3*time.Minute),
	)
	if err != nil {
		t.Fatalf("self-attest rotated current key: %v", err)
	}
	assertContentProofKeyAttestation(
		t,
		currentAttestation,
		second.Kid,
		second.Kid,
		second.Pub,
		issuedAt.Add(3*time.Minute),
	)

	store.mu.Lock()
	store.history[contentProofKeyIdentity{
		stationPeerID: "foreign-station",
		signingKeyID:  first.Kid,
	}] = append([]byte(nil), first.Pub...)
	store.mu.Unlock()

	for _, request := range []struct {
		stationPeerID string
		signingKeyID  string
	}{
		{stationPeerID: "foreign-station", signingKeyID: first.Kid},
		{stationPeerID: testLocalStationPeerID, signingKeyID: "unknown-key"},
	} {
		_, err := authority.ResolveContentProofVerificationKey(
			ctx,
			request.stationPeerID,
			request.signingKeyID,
		)
		if !errors.Is(err, ErrContentProofKeyUnavailable) {
			t.Fatalf(
				"resolve station=%q key=%q error = %v, want unavailable",
				request.stationPeerID,
				request.signingKeyID,
				err,
			)
		}
	}
	if _, err := authority.AttestContentProofVerificationKey(
		ctx,
		"unknown-key",
		issuedAt.Add(4*time.Minute),
	); !errors.Is(err, ErrContentProofKeyUnavailable) {
		t.Fatalf("attest unknown key error = %v, want unavailable", err)
	}

	store.mu.Lock()
	store.history[contentProofKeyIdentity{
		stationPeerID: testLocalStationPeerID,
		signingKeyID:  first.Kid,
	}] = append([]byte(nil), second.Pub...)
	store.mu.Unlock()
	if _, err := authority.AttestContentProofVerificationKey(
		ctx,
		first.Kid,
		issuedAt.Add(5*time.Minute),
	); err == nil {
		t.Fatal("attested a retained public key whose bytes do not match its key ID")
	}
}

func TestCanonicalContentProofKeyAttestationBytesCoverFieldsOneThroughSeven(t *testing.T) {
	ctx := context.Background()
	store := NewInMemoryKeyStore()
	key, err := MintLocalKey(time.Now())
	if err != nil {
		t.Fatalf("mint key: %v", err)
	}
	if err := store.PutCurrent(ctx, key); err != nil {
		t.Fatalf("put current key: %v", err)
	}
	authority, err := NewContentProofKeyAuthority(testLocalStationPeerID, store)
	if err != nil {
		t.Fatalf("new authority: %v", err)
	}
	attestation, err := authority.AttestContentProofVerificationKey(
		ctx,
		key.Kid,
		time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC),
	)
	if err != nil {
		t.Fatalf("attest: %v", err)
	}
	canonical, err := CanonicalContentProofKeyAttestationBytes(attestation)
	if err != nil {
		t.Fatalf("canonicalize: %v", err)
	}

	var fields []protowire.Number
	for len(canonical) > 0 {
		number, wireType, tagLength := protowire.ConsumeTag(canonical)
		if tagLength < 0 {
			t.Fatalf("consume tag: %v", protowire.ParseError(tagLength))
		}
		valueLength := protowire.ConsumeFieldValue(number, wireType, canonical[tagLength:])
		if valueLength < 0 {
			t.Fatalf("consume field %d: %v", number, protowire.ParseError(valueLength))
		}
		fields = append(fields, number)
		canonical = canonical[tagLength+valueLength:]
	}
	if want := []protowire.Number{1, 2, 3, 4, 5, 6, 7}; !equalFieldNumbers(fields, want) {
		t.Fatalf("canonical fields = %v, want %v", fields, want)
	}
}

func openContentProofKeyTestDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := MigrateSchema(context.Background(), database); err != nil {
		t.Fatalf("migrate Federation schema: %v", err)
	}
	return database
}

func assertContentProofKeyAttestation(
	t *testing.T,
	attestation *securecontentpb.StationContentSigningKeyAttestation,
	proofKeyID string,
	attestingKeyID string,
	attestingPublicKey ed25519.PublicKey,
	issuedAt time.Time,
) {
	t.Helper()
	if attestation.GetFormatVersion() != ContentProofKeyAttestationFormatVersion ||
		attestation.GetStationPeerId() != testLocalStationPeerID ||
		attestation.GetProofSigningKeyId() != proofKeyID ||
		attestation.GetAttestingSigningKeyId() != attestingKeyID {
		t.Fatalf("attestation identity mismatch: %+v", attestation)
	}
	if !attestation.GetIssuedAt().AsTime().Equal(issuedAt) {
		t.Fatalf("issued_at = %v, want %v", attestation.GetIssuedAt().AsTime(), issuedAt)
	}
	if !attestation.GetExpiresAt().AsTime().Equal(issuedAt.Add(ContentProofKeyAttestationTTL)) {
		t.Fatalf(
			"expires_at = %v, want %v",
			attestation.GetExpiresAt().AsTime(),
			issuedAt.Add(ContentProofKeyAttestationTTL),
		)
	}
	signingBytes, err := ContentProofKeyAttestationSigningBytes(
		attestation,
	)
	if err != nil {
		t.Fatalf("canonicalize signed attestation: %v", err)
	}
	if !ed25519.Verify(attestingPublicKey, signingBytes, attestation.GetStationSignature()) {
		t.Fatal("attestation signature did not verify with the current Station key")
	}
}

func equalFieldNumbers(left []protowire.Number, right []protowire.Number) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
