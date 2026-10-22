package catalogrepo

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/x-config/internal/domain/catalog"
	"github.com/peers-labs/peers-touch/x-config/internal/publication"
	"gopkg.in/yaml.v3"
)

func TestInitialDraftCASIsScopedToCatalogPath(t *testing.T) {
	noOp, err := resolveDraftWrite("", "shared-repository-head", false, nil, []byte("catalog"))
	if err != nil || noOp {
		t.Fatalf("initial catalog write was rejected: noOp=%v err=%v", noOp, err)
	}
	noOp, err = resolveDraftWrite(
		"",
		"commit-response-lost",
		true,
		[]byte("catalog"),
		[]byte("catalog"),
	)
	if err != nil || !noOp {
		t.Fatalf("exact initial retry was not idempotent: noOp=%v err=%v", noOp, err)
	}
	if _, err := resolveDraftWrite(
		"",
		"concurrent-head",
		true,
		[]byte("other"),
		[]byte("catalog"),
	); !errors.Is(err, catalog.ErrDraftConflict) {
		t.Fatalf("concurrent initial catalog was accepted: %v", err)
	}
	if _, err := resolveDraftWrite(
		"stale-head",
		"current-head",
		true,
		[]byte("other"),
		[]byte("catalog"),
	); !errors.Is(err, catalog.ErrDraftConflict) {
		t.Fatalf("stale catalog revision was accepted: %v", err)
	}
}

func TestPublicationMetadataAndEnvelopeValidation(t *testing.T) {
	now := time.Date(2026, 10, 19, 1, 0, 0, 0, time.UTC)
	value := catalog.Catalog{
		SchemaVersion: 1,
		Channel:       "stable",
	}
	catalogRaw, err := yaml.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	contentDigest := sha256.Sum256(catalogRaw)
	_, statementBytes, err := publication.BuildStatement(
		&value,
		1,
		now,
		now.Add(time.Hour),
	)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := publication.NewEd25519Signer(
		"publisher-test",
		ed25519.NewKeyFromSeed(make([]byte, ed25519.SeedSize)),
	)
	if err != nil {
		t.Fatal(err)
	}
	envelopeBytes, err := publication.BuildSignedEnvelope(signer, statementBytes)
	if err != nil {
		t.Fatal(err)
	}
	statementDigest := sha256.Sum256(statementBytes)
	envelopeDigest := sha256.Sum256(envelopeBytes)
	record := catalog.Publication{
		SchemaVersion:   1,
		PublicationID:   "publication-00000000000000000001",
		Channel:         "stable",
		Sequence:        1,
		SourceRevision:  "source-revision",
		ContentSHA256:   hex.EncodeToString(contentDigest[:]),
		SigningKeyID:    signer.KeyID(),
		StatementSHA256: hex.EncodeToString(statementDigest[:]),
		EnvelopeSHA256:  hex.EncodeToString(envelopeDigest[:]),
		PublishedBy:     "github:subject",
		PublishedAt:     now,
		ExpiresAt:       now.Add(time.Hour),
		Catalog:         value,
		EnvelopeBytes:   envelopeBytes,
	}
	if !validPublication(
		record,
		record.SourceRevision,
		record.Channel,
		record.Sequence,
	) || !validEnvelope(record, envelopeBytes) {
		t.Fatal("valid publication was rejected")
	}
	retry := clonePublication(record)
	retry.RepositoryRevision = "new-head"
	if !samePublication(record, retry) {
		t.Fatal("repository readback did not match exact retry")
	}
	prefix := "f"
	if retry.EnvelopeSHA256[0] == 'f' {
		prefix = "e"
	}
	retry.EnvelopeSHA256 = prefix + retry.EnvelopeSHA256[1:]
	if samePublication(record, retry) {
		t.Fatal("changed publication matched exact retry")
	}
	envelopeBytes[len(envelopeBytes)-1] ^= 0x01
	if validEnvelope(record, envelopeBytes) {
		t.Fatal("tampered envelope was accepted")
	}
}
