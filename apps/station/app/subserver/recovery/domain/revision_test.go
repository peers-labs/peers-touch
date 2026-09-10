package domain_test

import (
	"crypto/sha256"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/domain"
)

func TestArchivePolicyValidatesOpaqueHashAndSize(t *testing.T) {
	policy, err := domain.NewArchivePolicy(8)
	if err != nil {
		t.Fatal(err)
	}
	opaque := []byte{0x00, 0xff, 0x7f, 0x01}
	hash := sha256.Sum256(opaque)
	revision, err := domain.NewRevision(
		"revision-1",
		"ptid:alice",
		1,
		opaque,
		hash[:],
		"alice-device",
		time.Unix(1_700_000_000, 0),
		policy,
	)
	if err != nil {
		t.Fatal(err)
	}
	opaque[0] ^= 0xff
	hash[0] ^= 0xff
	if revision.EncryptedArchive[0] != 0x00 ||
		revision.EncryptedArchiveSHA256[0] == hash[0] {
		t.Fatal("revision retained caller-owned archive storage")
	}

	tooLarge := []byte("123456789")
	tooLargeHash := sha256.Sum256(tooLarge)
	if _, err := domain.NewRevision(
		"revision-2",
		"ptid:alice",
		1,
		tooLarge,
		tooLargeHash[:],
		"alice-device",
		time.Unix(1_700_000_000, 0),
		policy,
	); !domain.IsCode(err, domain.ErrorCodeArchiveTooLarge) {
		t.Fatalf("oversize error = %v", err)
	}

	corruptHash := sha256.Sum256([]byte("different"))
	if _, err := domain.NewRevision(
		"revision-3",
		"ptid:alice",
		1,
		[]byte("opaque"),
		corruptHash[:],
		"alice-device",
		time.Unix(1_700_000_000, 0),
		policy,
	); !domain.IsCode(err, domain.ErrorCodeArchiveIntegrity) {
		t.Fatalf("integrity error = %v", err)
	}
}

func TestRevisionImmutableIdentityExcludesServerReplayTime(t *testing.T) {
	policy, err := domain.NewArchivePolicy(1024)
	if err != nil {
		t.Fatal(err)
	}
	archive := []byte("opaque")
	hash := sha256.Sum256(archive)
	createdAt := time.Unix(1_700_000_000, 123_456_789)
	first, err := domain.NewRevision(
		"revision-1",
		"ptid:alice",
		1,
		archive,
		hash[:],
		"alice-device",
		createdAt,
		policy,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !first.CreatedAt.Equal(createdAt.UTC().Truncate(time.Microsecond)) {
		t.Fatalf("created_at = %s", first.CreatedAt)
	}
	replay, err := domain.NewRevision(
		"revision-1",
		"ptid:alice",
		1,
		archive,
		hash[:],
		"alice-device",
		time.Unix(1_800_000_000, 0),
		policy,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !first.SameImmutableContent(replay) {
		t.Fatal("server retry time changed immutable revision identity")
	}
	replay.CreatedByDeviceID = "other-device"
	if first.SameImmutableContent(replay) {
		t.Fatal("different creating device was accepted as an exact replay")
	}
}
