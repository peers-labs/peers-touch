package federation

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/x509"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	// ContentProofVerificationKeyTable is the Federation-owned append-only
	// history of public keys that may verify durable Station content proofs.
	ContentProofVerificationKeyTable = "auth_station_content_signing_key_history"

	// ContentProofKeyAttestationFormatVersion is the accepted SC-D19 wire
	// format for StationContentSigningKeyAttestation.
	ContentProofKeyAttestationFormatVersion uint32 = 1

	// ContentProofKeyAttestationTTL bounds trust in an attestation without
	// changing the lifetime of the retained proof key or content proof.
	ContentProofKeyAttestationTTL = 5 * time.Minute

	contentProofKeyAttestationDomain = "peers-touch:secure-content:station-content-signing-key-attestation:v1\x00"
	maxContentProofKeyIdentifierSize = 512
)

var (
	// ErrContentProofKeyUnavailable is the typed failure used when a caller
	// requests an unknown Station, an unknown key, or a non-local Station.
	ErrContentProofKeyUnavailable = errors.New("STATION_PROOF_KEY_UNAVAILABLE")

	localKeyLifecycleMu sync.RWMutex
)

// contentProofVerificationKeyRow stores public verification material only.
// There is deliberately no update/delete API: once archived, a key remains
// addressable while durable content may reference it.
type contentProofVerificationKeyRow struct {
	StationPeerID    string    `gorm:"column:station_peer_id;size:512;primaryKey"`
	SigningKeyID     string    `gorm:"column:signing_key_id;size:64;primaryKey"`
	Ed25519PublicKey []byte    `gorm:"column:ed25519_public_key;type:bytea;not null"`
	FirstActiveAt    time.Time `gorm:"column:first_active_at;not null"`
	LastActiveAt     time.Time `gorm:"column:last_active_at;not null"`
	RetiredAt        time.Time `gorm:"column:retired_at;not null"`
	RetirementReason string    `gorm:"column:retirement_reason;size:32;not null"`
}

func (contentProofVerificationKeyRow) TableName() string {
	return ContentProofVerificationKeyTable
}

// ContentProofKeyUnavailableError preserves the requested composite identity
// while supporting errors.Is(err, ErrContentProofKeyUnavailable).
type ContentProofKeyUnavailableError struct {
	StationPeerID string
	SigningKeyID  string
}

func (e *ContentProofKeyUnavailableError) Error() string {
	return fmt.Sprintf(
		"%s: station_peer_id=%q signing_key_id=%q",
		ErrContentProofKeyUnavailable,
		e.StationPeerID,
		e.SigningKeyID,
	)
}

func (e *ContentProofKeyUnavailableError) Unwrap() error {
	return ErrContentProofKeyUnavailable
}

// ContentProofKeyAuthority is the single Federation-owned capability for
// resolving and attesting local Station proof-verification keys.
type ContentProofKeyAuthority struct {
	localStationPeerID string
	keys               KeyStore
	history            contentProofKeyHistoryStore
}

type contentProofKeyHistoryStore interface {
	resolveArchivedContentProofVerificationKey(
		ctx context.Context,
		stationPeerID string,
		signingKeyID string,
	) ([]byte, error)
}

// NewContentProofKeyAuthority binds proof-key operations to one explicit local
// Station identity. Blank/local sentinel identities are rejected.
func NewContentProofKeyAuthority(
	localStationPeerID string,
	keys KeyStore,
) (*ContentProofKeyAuthority, error) {
	localStationPeerID = strings.TrimSpace(localStationPeerID)
	if localStationPeerID == "" {
		return nil, errors.New("federation: content proof keys: local station peer id is required")
	}
	if keys == nil {
		return nil, errors.New("federation: content proof keys: key store is required")
	}
	history, ok := keys.(contentProofKeyHistoryStore)
	if !ok {
		return nil, errors.New("federation: content proof keys: key store lacks retained public-key history")
	}
	return &ContentProofKeyAuthority{
		localStationPeerID: localStationPeerID,
		keys:               keys,
		history:            history,
	}, nil
}

// CurrentSigningKeyID returns the active Station key ID under the same
// lifecycle fence used by rotation.
func (a *ContentProofKeyAuthority) CurrentSigningKeyID(
	ctx context.Context,
) (string, error) {
	localKeyLifecycleMu.RLock()
	defer localKeyLifecycleMu.RUnlock()

	current, err := a.keys.Load(ctx, SlotCurrent)
	if err != nil {
		return "", fmt.Errorf(
			"federation: load current content signing key: %w",
			err,
		)
	}
	if err := validateLocalKeyPublicIdentity(current); err != nil {
		return "", fmt.Errorf(
			"federation: validate current content signing key: %w",
			err,
		)
	}
	return current.Kid, nil
}

func (a *ContentProofKeyAuthority) CurrentSigningKeyIDInTransaction(
	ctx context.Context,
	transaction *gorm.DB,
) (string, error) {
	if transaction == nil {
		return "", errors.New(
			"federation: current content signing key transaction is required",
		)
	}

	current, err := loadLocalKeyFromDatabase(
		transaction.WithContext(ctx),
		SlotCurrent,
	)
	if err != nil {
		return "", fmt.Errorf(
			"federation: load transactional content signing key: %w",
			err,
		)
	}
	if err := validateLocalKeyPublicIdentity(current); err != nil {
		return "", fmt.Errorf(
			"federation: validate transactional content signing key: %w",
			err,
		)
	}
	return current.Kid, nil
}

// SignWithCurrentKey signs only when expectedSigningKeyID remains current.
// Rotation and signing share localKeyLifecycleMu, so a caller either signs
// before archive-before-retire or fails and rebuilds its canonical input with
// the new key ID.
func (a *ContentProofKeyAuthority) SignWithCurrentKey(
	ctx context.Context,
	expectedSigningKeyID string,
	canonical []byte,
) ([]byte, error) {
	if strings.TrimSpace(expectedSigningKeyID) == "" || len(canonical) == 0 {
		return nil, errors.New(
			"federation: sign content proof: key ID and canonical bytes are required",
		)
	}
	localKeyLifecycleMu.RLock()
	defer localKeyLifecycleMu.RUnlock()

	current, err := a.keys.Load(ctx, SlotCurrent)
	if err != nil {
		return nil, fmt.Errorf(
			"federation: sign content proof: load current key: %w",
			err,
		)
	}
	if err := validateLocalKeyPublicIdentity(current); err != nil {
		return nil, fmt.Errorf(
			"federation: sign content proof: %w",
			err,
		)
	}
	if current.Kid != expectedSigningKeyID {
		return nil, errors.New(
			"federation: sign content proof: expected key is no longer current",
		)
	}
	return ed25519.Sign(current.Priv, canonical), nil
}

func (a *ContentProofKeyAuthority) SignWithCurrentKeyInTransaction(
	ctx context.Context,
	transaction *gorm.DB,
	expectedSigningKeyID string,
	canonical []byte,
) ([]byte, error) {
	if transaction == nil ||
		strings.TrimSpace(expectedSigningKeyID) == "" ||
		len(canonical) == 0 {
		return nil, errors.New(
			"federation: transactional content signing input is invalid",
		)
	}

	current, err := loadLocalKeyFromDatabase(
		transaction.WithContext(ctx),
		SlotCurrent,
	)
	if err != nil {
		return nil, fmt.Errorf(
			"federation: transactional content signing load: %w",
			err,
		)
	}
	if err := validateLocalKeyPublicIdentity(current); err != nil {
		return nil, fmt.Errorf(
			"federation: transactional content signing: %w",
			err,
		)
	}
	if current.Kid != expectedSigningKeyID {
		return nil, errors.New(
			"federation: transactional content signing key is no longer current",
		)
	}
	return ed25519.Sign(current.Priv, canonical), nil
}

// ResolveContentProofVerificationKey returns the current local public key
// directly or an older key from append-only history. Foreign Station requests
// fail closed even if the backing database contains a matching row.
func (a *ContentProofKeyAuthority) ResolveContentProofVerificationKey(
	ctx context.Context,
	stationPeerID string,
	signingKeyID string,
) (ed25519.PublicKey, error) {
	return a.resolveContentProofVerificationKey(
		ctx,
		nil,
		stationPeerID,
		signingKeyID,
	)
}

// ResolveContentProofVerificationKeyInTransaction resolves the same
// Federation-owned key through the caller's SQL transaction. It prevents
// single-connection deployments from deadlocking while Social holds its UOW.
func (a *ContentProofKeyAuthority) ResolveContentProofVerificationKeyInTransaction(
	ctx context.Context,
	transaction *gorm.DB,
	stationPeerID string,
	signingKeyID string,
) (ed25519.PublicKey, error) {
	if transaction == nil {
		return nil, errors.New(
			"federation: content proof key transaction is required",
		)
	}
	return a.resolveContentProofVerificationKey(
		ctx,
		transaction.WithContext(ctx),
		stationPeerID,
		signingKeyID,
	)
}

func (a *ContentProofKeyAuthority) resolveContentProofVerificationKey(
	ctx context.Context,
	transaction *gorm.DB,
	stationPeerID string,
	signingKeyID string,
) (ed25519.PublicKey, error) {
	stationPeerID = strings.TrimSpace(stationPeerID)
	signingKeyID = strings.TrimSpace(signingKeyID)
	if stationPeerID == "" ||
		signingKeyID == "" ||
		stationPeerID != a.localStationPeerID {
		return nil, contentProofKeyUnavailable(stationPeerID, signingKeyID)
	}

	var current *LocalKey
	var err error
	if transaction == nil {
		current, err = a.keys.Load(ctx, SlotCurrent)
	} else {
		current, err = loadLocalKeyFromDatabase(
			transaction,
			SlotCurrent,
		)
	}
	switch {
	case err == nil && current != nil && current.Kid == signingKeyID:
		if err := validateLocalKeyPublicIdentity(current); err != nil {
			return nil, fmt.Errorf("federation: resolve current content proof key: %w", err)
		}
		return append(ed25519.PublicKey(nil), current.Pub...), nil
	case err != nil && !errors.Is(err, ErrNoLocalKey):
		return nil, fmt.Errorf("federation: resolve current content proof key: %w", err)
	}

	var publicKey []byte
	if transaction == nil {
		publicKey, err = a.history.resolveArchivedContentProofVerificationKey(
			ctx,
			stationPeerID,
			signingKeyID,
		)
	} else {
		publicKey, err = resolveArchivedContentProofVerificationKeyFromDatabase(
			transaction,
			stationPeerID,
			signingKeyID,
		)
	}
	if err != nil {
		return nil, err
	}
	if err := validateContentProofPublicKeyIdentity(
		publicKey,
		signingKeyID,
	); err != nil {
		return nil, fmt.Errorf("federation: resolve archived content proof key: %w", err)
	}
	return append(ed25519.PublicKey(nil), publicKey...), nil
}

func loadLocalKeyFromDatabase(
	database *gorm.DB,
	slot string,
) (*LocalKey, error) {
	var row AuthLocalKeyRow
	err := database.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("slot = ?", slot).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNoLocalKey
	}
	if err != nil {
		return nil, err
	}
	key, err := ParseLocalKey(
		row.PrivPEM,
		row.PubPEM,
		row.Kid,
		row.GeneratedAt,
	)
	if err != nil {
		return nil, err
	}
	key.UpdatedAt = row.UpdatedAt
	return key, nil
}

func resolveArchivedContentProofVerificationKeyFromDatabase(
	database *gorm.DB,
	stationPeerID string,
	signingKeyID string,
) ([]byte, error) {
	var row contentProofVerificationKeyRow
	err := database.Where(
		"station_peer_id = ? AND signing_key_id = ?",
		stationPeerID,
		signingKeyID,
	).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, contentProofKeyUnavailable(
			stationPeerID,
			signingKeyID,
		)
	}
	if err != nil {
		return nil, err
	}
	return append([]byte(nil), row.Ed25519PublicKey...), nil
}

// AttestContentProofVerificationKey signs a five-minute attestation for a
// current or retained proof key with the current local Station key.
func (a *ContentProofKeyAuthority) AttestContentProofVerificationKey(
	ctx context.Context,
	signingKeyID string,
	now time.Time,
) (*securecontentpb.StationContentSigningKeyAttestation, error) {
	if now.IsZero() {
		return nil, errors.New("federation: attest content proof key: now is required")
	}

	localKeyLifecycleMu.RLock()
	defer localKeyLifecycleMu.RUnlock()

	proofKey, err := a.ResolveContentProofVerificationKey(
		ctx,
		a.localStationPeerID,
		signingKeyID,
	)
	if err != nil {
		return nil, err
	}
	attestingKey, err := a.keys.Load(ctx, SlotCurrent)
	if err != nil {
		return nil, fmt.Errorf("federation: attest content proof key: load current key: %w", err)
	}
	if attestingKey == nil ||
		len(attestingKey.Priv) != ed25519.PrivateKeySize ||
		strings.TrimSpace(attestingKey.Kid) == "" {
		return nil, errors.New("federation: attest content proof key: current key is incomplete")
	}
	if err := validateLocalKeyPublicIdentity(attestingKey); err != nil {
		return nil, fmt.Errorf("federation: attest content proof key: %w", err)
	}

	issuedAt := now.UTC()
	attestation := &securecontentpb.StationContentSigningKeyAttestation{
		FormatVersion:         ContentProofKeyAttestationFormatVersion,
		StationPeerId:         a.localStationPeerID,
		ProofSigningKeyId:     strings.TrimSpace(signingKeyID),
		ProofEd25519PublicKey: append([]byte(nil), proofKey...),
		AttestingSigningKeyId: attestingKey.Kid,
		IssuedAt:              timestamppb.New(issuedAt),
		ExpiresAt:             timestamppb.New(issuedAt.Add(ContentProofKeyAttestationTTL)),
	}
	signingBytes, err := ContentProofKeyAttestationSigningBytes(attestation)
	if err != nil {
		return nil, err
	}
	attestation.StationSignature = ed25519.Sign(attestingKey.Priv, signingBytes)
	return attestation, nil
}

// CanonicalContentProofKeyAttestationBytes encodes exactly protobuf fields
// 1..7 in ascending order with standard omitted-default semantics.
func CanonicalContentProofKeyAttestationBytes(
	attestation *securecontentpb.StationContentSigningKeyAttestation,
) ([]byte, error) {
	if err := validateContentProofKeyAttestation(attestation); err != nil {
		return nil, err
	}

	output := appendAttestationVarintField(
		nil,
		1,
		uint64(attestation.GetFormatVersion()),
	)
	output = appendAttestationBytesField(
		output,
		2,
		[]byte(attestation.GetStationPeerId()),
	)
	output = appendAttestationBytesField(
		output,
		3,
		[]byte(attestation.GetProofSigningKeyId()),
	)
	output = appendAttestationBytesField(
		output,
		4,
		attestation.GetProofEd25519PublicKey(),
	)
	output = appendAttestationBytesField(
		output,
		5,
		[]byte(attestation.GetAttestingSigningKeyId()),
	)
	output = appendAttestationMessageField(
		output,
		6,
		canonicalAttestationTimestamp(attestation.GetIssuedAt()),
	)
	return appendAttestationMessageField(
		output,
		7,
		canonicalAttestationTimestamp(attestation.GetExpiresAt()),
	), nil
}

// ContentProofKeyAttestationSigningBytes prefixes the canonical fields with
// the SC-D19 domain separator before Ed25519 signing or verification.
func ContentProofKeyAttestationSigningBytes(
	attestation *securecontentpb.StationContentSigningKeyAttestation,
) ([]byte, error) {
	canonical, err := CanonicalContentProofKeyAttestationBytes(attestation)
	if err != nil {
		return nil, err
	}
	output := make([]byte, 0, len(contentProofKeyAttestationDomain)+len(canonical))
	output = append(output, contentProofKeyAttestationDomain...)
	return append(output, canonical...), nil
}

func (s *gormKeyStore) resolveArchivedContentProofVerificationKey(
	ctx context.Context,
	stationPeerID string,
	signingKeyID string,
) ([]byte, error) {
	stationPeerID = strings.TrimSpace(stationPeerID)
	signingKeyID = strings.TrimSpace(signingKeyID)
	if stationPeerID == "" || signingKeyID == "" {
		return nil, contentProofKeyUnavailable(stationPeerID, signingKeyID)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}

	var row contentProofVerificationKeyRow
	err = db.
		Where("station_peer_id = ? AND signing_key_id = ?", stationPeerID, signingKeyID).
		First(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, contentProofKeyUnavailable(stationPeerID, signingKeyID)
		}
		return nil, err
	}
	return append([]byte(nil), row.Ed25519PublicKey...), nil
}

func archiveContentProofVerificationKey(
	tx *gorm.DB,
	stationPeerID string,
	outgoing AuthLocalKeyRow,
	archivedAt time.Time,
) error {
	publicKey, derivedKeyID, err := ParsePeerJWKPEM(outgoing.PubPEM)
	if err != nil {
		return fmt.Errorf("federation: archive outgoing content proof key: %w", err)
	}
	if derivedKeyID != outgoing.Kid {
		return errors.New("federation: archive outgoing content proof key: kid does not match public key")
	}

	var existing contentProofVerificationKeyRow
	err = tx.
		Where("station_peer_id = ? AND signing_key_id = ?", stationPeerID, outgoing.Kid).
		First(&existing).Error
	switch {
	case err == nil:
		if !bytes.Equal(existing.Ed25519PublicKey, publicKey) {
			return errors.New("federation: archive outgoing content proof key: immutable history conflict")
		}
		return nil
	case !errors.Is(err, gorm.ErrRecordNotFound):
		return err
	}

	return tx.Create(&contentProofVerificationKeyRow{
		StationPeerID:    stationPeerID,
		SigningKeyID:     outgoing.Kid,
		Ed25519PublicKey: append([]byte(nil), publicKey...),
		FirstActiveAt:    outgoing.UpdatedAt.UTC(),
		LastActiveAt:     archivedAt.UTC(),
		RetiredAt:        archivedAt.UTC(),
		RetirementReason: "ROTATED",
	}).Error
}

func validateContentProofKeyAttestation(
	attestation *securecontentpb.StationContentSigningKeyAttestation,
) error {
	if attestation == nil {
		return errors.New("federation: content proof key attestation is required")
	}
	if len(attestation.ProtoReflect().GetUnknown()) != 0 {
		return errors.New("federation: content proof key attestation has unknown fields")
	}
	if attestation.GetFormatVersion() != ContentProofKeyAttestationFormatVersion {
		return errors.New("federation: content proof key attestation format version is unsupported")
	}
	for name, value := range map[string]string{
		"station_peer_id":          attestation.GetStationPeerId(),
		"proof_signing_key_id":     attestation.GetProofSigningKeyId(),
		"attesting_signing_key_id": attestation.GetAttestingSigningKeyId(),
	} {
		if value == "" ||
			value != strings.TrimSpace(value) ||
			len(value) > maxContentProofKeyIdentifierSize {
			return fmt.Errorf(
				"federation: content proof key attestation %s is invalid",
				name,
			)
		}
	}
	if err := validateContentProofPublicKeyIdentity(
		attestation.GetProofEd25519PublicKey(),
		attestation.GetProofSigningKeyId(),
	); err != nil {
		return fmt.Errorf("federation: content proof key attestation: %w", err)
	}
	if err := validateAttestationTimestamp("issued_at", attestation.GetIssuedAt()); err != nil {
		return err
	}
	if err := validateAttestationTimestamp("expires_at", attestation.GetExpiresAt()); err != nil {
		return err
	}
	if !attestation.GetExpiresAt().AsTime().Equal(
		attestation.GetIssuedAt().AsTime().Add(ContentProofKeyAttestationTTL),
	) {
		return errors.New("federation: content proof key attestation lifetime must be five minutes")
	}
	return nil
}

func validateAttestationTimestamp(name string, timestamp *timestamppb.Timestamp) error {
	if timestamp == nil {
		return fmt.Errorf("federation: content proof key attestation %s is required", name)
	}
	if err := timestamp.CheckValid(); err != nil {
		return fmt.Errorf(
			"federation: content proof key attestation %s is invalid: %w",
			name,
			err,
		)
	}
	if len(timestamp.ProtoReflect().GetUnknown()) != 0 {
		return fmt.Errorf(
			"federation: content proof key attestation %s has unknown fields",
			name,
		)
	}
	return nil
}

func validateEd25519PublicKey(publicKey []byte) error {
	if len(publicKey) != ed25519.PublicKeySize {
		return errors.New("Ed25519 public key length is invalid")
	}
	if bytes.Equal(publicKey, make([]byte, ed25519.PublicKeySize)) {
		return errors.New("Ed25519 public key is zero")
	}
	return nil
}

func validateContentProofPublicKeyIdentity(
	publicKey []byte,
	signingKeyID string,
) error {
	if err := validateEd25519PublicKey(publicKey); err != nil {
		return err
	}
	publicDER, err := x509.MarshalPKIXPublicKey(ed25519.PublicKey(publicKey))
	if err != nil {
		return fmt.Errorf("marshal Ed25519 public key: %w", err)
	}
	if KidFromPubDER(publicDER) != signingKeyID {
		return errors.New("Ed25519 public key does not match signing key ID")
	}
	return nil
}

func validateLocalKeyPublicIdentity(key *LocalKey) error {
	if key == nil {
		return errors.New("local key is required")
	}
	if len(key.Priv) != ed25519.PrivateKeySize ||
		len(key.Pub) != ed25519.PublicKeySize {
		return errors.New("local key material length is invalid")
	}
	publicKey, derivedKeyID, err := ParsePeerJWKPEM(key.PubPEM)
	if err != nil {
		return err
	}
	if derivedKeyID != key.Kid ||
		!bytes.Equal(publicKey, key.Pub) ||
		!bytes.Equal(key.Priv.Public().(ed25519.PublicKey), key.Pub) {
		return errors.New("local key ID, public key, and private key do not match")
	}
	return nil
}

func contentProofKeyUnavailable(
	stationPeerID string,
	signingKeyID string,
) error {
	return &ContentProofKeyUnavailableError{
		StationPeerID: stationPeerID,
		SigningKeyID:  signingKeyID,
	}
}

func appendAttestationVarintField(
	output []byte,
	number protowire.Number,
	value uint64,
) []byte {
	if value == 0 {
		return output
	}
	output = protowire.AppendTag(output, number, protowire.VarintType)
	return protowire.AppendVarint(output, value)
}

func appendAttestationBytesField(
	output []byte,
	number protowire.Number,
	value []byte,
) []byte {
	if len(value) == 0 {
		return output
	}
	output = protowire.AppendTag(output, number, protowire.BytesType)
	return protowire.AppendBytes(output, value)
}

func appendAttestationMessageField(
	output []byte,
	number protowire.Number,
	value []byte,
) []byte {
	output = protowire.AppendTag(output, number, protowire.BytesType)
	return protowire.AppendBytes(output, value)
}

func canonicalAttestationTimestamp(timestamp *timestamppb.Timestamp) []byte {
	output := appendAttestationVarintField(nil, 1, uint64(timestamp.GetSeconds()))
	return appendAttestationVarintField(output, 2, uint64(timestamp.GetNanos()))
}
