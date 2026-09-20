package domain

import (
	"testing"
	"time"
)

func TestRecoverableContentCursor(t *testing.T) {
	actorPTID := "ptid:v1:actor:peers:p:bob:key"
	cursor := RecoverableContentCursor{
		CreatedAt: time.Date(
			2026,
			time.September,
			14,
			10,
			30,
			0,
			123456789,
			time.UTC,
		),
		ResourceKind: PrivateContentResourceComment,
		ResourceID:   "01K55XG0000000000000000000",
	}

	t.Run("round trip", func(t *testing.T) {
		encoded, err := EncodeRecoverableContentCursor(actorPTID, cursor)
		if err != nil {
			t.Fatal(err)
		}
		decoded, err := DecodeRecoverableContentCursor(actorPTID, encoded)
		if err != nil {
			t.Fatal(err)
		}
		if !decoded.CreatedAt.Equal(cursor.CreatedAt) ||
			decoded.ResourceKind != cursor.ResourceKind ||
			decoded.ResourceID != cursor.ResourceID {
			t.Fatalf("decoded cursor = %+v, want %+v", decoded, cursor)
		}
	})

	t.Run("empty cursor starts first page", func(t *testing.T) {
		decoded, err := DecodeRecoverableContentCursor(actorPTID, "")
		if err != nil {
			t.Fatal(err)
		}
		if !decoded.IsZero() {
			t.Fatalf("empty cursor decoded as %+v", decoded)
		}
	})

	t.Run("wrong actor is rejected", func(t *testing.T) {
		encoded, err := EncodeRecoverableContentCursor(actorPTID, cursor)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := DecodeRecoverableContentCursor(
			"ptid:v1:actor:peers:p:eve:key",
			encoded,
		); !IsPrivateContentCode(err, PrivateContentInvalidArgument) {
			t.Fatalf("wrong-actor cursor error = %v", err)
		}
	})

	t.Run("malformed cursors are rejected", func(t *testing.T) {
		for _, encoded := range []string{
			"not-base64!",
			"eyJ2IjoxfQ",
			" eyJ2IjoxfQ",
		} {
			if _, err := DecodeRecoverableContentCursor(
				actorPTID,
				encoded,
			); !IsPrivateContentCode(err, PrivateContentInvalidArgument) {
				t.Fatalf("malformed cursor %q error = %v", encoded, err)
			}
		}
	})
}
