package domain

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const (
	recoverableContentCursorVersion = 1
	maxRecoverableContentCursorSize = 512
)

// RecoverableContentCursor is the stable keyset position for the merged
// private Post and Comment recovery stream.
type RecoverableContentCursor struct {
	CreatedAt    time.Time
	ResourceKind PrivateContentResourceKind
	ResourceID   string
}

// IsZero reports whether the cursor identifies the first recovery page.
func (c RecoverableContentCursor) IsZero() bool {
	return c.CreatedAt.IsZero() &&
		c.ResourceKind == "" &&
		c.ResourceID == ""
}

type recoverableContentCursorWire struct {
	Version           uint32 `json:"v"`
	ActorSHA256       string `json:"a"`
	CreatedAtUnixNano int64  `json:"t"`
	ResourceKind      string `json:"k"`
	ResourceID        string `json:"r"`
}

// EncodeRecoverableContentCursor binds a recovery cursor to the authenticated
// actor so another actor cannot reuse it as an authorization side channel.
func EncodeRecoverableContentCursor(
	actorPTID string,
	cursor RecoverableContentCursor,
) (string, error) {
	const operation = "social.private_content.encode_recovery_cursor"
	if cursor.IsZero() {
		return "", nil
	}
	if err := validateRecoverableContentCursor(
		operation,
		actorPTID,
		cursor,
	); err != nil {
		return "", err
	}

	wire := recoverableContentCursorWire{
		Version:           recoverableContentCursorVersion,
		ActorSHA256:       recoverableContentActorHash(actorPTID),
		CreatedAtUnixNano: cursor.CreatedAt.UTC().UnixNano(),
		ResourceKind:      string(cursor.ResourceKind),
		ResourceID:        cursor.ResourceID,
	}
	encoded, err := json.Marshal(wire)
	if err != nil {
		return "", WrapPrivateContentError(
			PrivateContentInternal,
			operation,
			err,
		)
	}

	return base64.RawURLEncoding.EncodeToString(encoded), nil
}

// DecodeRecoverableContentCursor rejects malformed, non-canonical, and
// cross-actor cursors instead of restarting from the first page.
func DecodeRecoverableContentCursor(
	actorPTID string,
	encoded string,
) (RecoverableContentCursor, error) {
	const operation = "social.private_content.decode_recovery_cursor"
	if encoded == "" {
		return RecoverableContentCursor{}, nil
	}
	if len(encoded) > maxRecoverableContentCursorSize ||
		encoded != strings.TrimSpace(encoded) {
		return RecoverableContentCursor{}, invalidRecoveryCursor(operation)
	}

	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return RecoverableContentCursor{}, invalidRecoveryCursor(operation)
	}
	var wire recoverableContentCursorWire
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		return RecoverableContentCursor{}, invalidRecoveryCursor(operation)
	}
	canonical, err := json.Marshal(wire)
	if err != nil || !bytes.Equal(canonical, raw) {
		return RecoverableContentCursor{}, invalidRecoveryCursor(operation)
	}
	if wire.Version != recoverableContentCursorVersion ||
		wire.ActorSHA256 != recoverableContentActorHash(actorPTID) ||
		wire.CreatedAtUnixNano <= 0 {
		return RecoverableContentCursor{}, invalidRecoveryCursor(operation)
	}

	cursor := RecoverableContentCursor{
		CreatedAt:    time.Unix(0, wire.CreatedAtUnixNano).UTC(),
		ResourceKind: PrivateContentResourceKind(wire.ResourceKind),
		ResourceID:   wire.ResourceID,
	}
	if err := validateRecoverableContentCursor(
		operation,
		actorPTID,
		cursor,
	); err != nil {
		return RecoverableContentCursor{}, invalidRecoveryCursor(operation)
	}

	return cursor, nil
}

func validateRecoverableContentCursor(
	operation string,
	actorPTID string,
	cursor RecoverableContentCursor,
) error {
	if err := validateIdentifier(
		actorPTID,
		255,
		"actor_ptid",
		operation,
	); err != nil {
		return err
	}
	if cursor.CreatedAt.IsZero() || cursor.CreatedAt.UnixNano() <= 0 {
		return invalidRecoveryCursor(operation)
	}
	switch cursor.ResourceKind {
	case PrivateContentResourcePost, PrivateContentResourceComment:
	default:
		return invalidRecoveryCursor(operation)
	}
	if err := ValidatePrivateContentID(
		cursor.ResourceID,
		"resource_id",
		operation,
	); err != nil {
		return invalidRecoveryCursor(operation)
	}

	return nil
}

func recoverableContentActorHash(actorPTID string) string {
	digest := sha256.Sum256(
		[]byte("peers-touch:social:recovery-cursor:v1\x00" + actorPTID),
	)

	return hex.EncodeToString(digest[:])
}

func invalidRecoveryCursor(operation string) error {
	return NewPrivateContentError(
		PrivateContentInvalidArgument,
		operation,
		"cursor",
		fmt.Sprintf(
			"must be a canonical version-%d recovery cursor",
			recoverableContentCursorVersion,
		),
	)
}
