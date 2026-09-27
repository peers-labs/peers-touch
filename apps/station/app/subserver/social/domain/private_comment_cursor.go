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
	privateCommentCursorVersion = 1
	maxPrivateCommentCursorSize = 512
)

type PrivateCommentCursor struct {
	CreatedAt time.Time
	CommentID string
}

func (c PrivateCommentCursor) IsZero() bool {
	return c.CreatedAt.IsZero() && c.CommentID == ""
}

type privateCommentCursorWire struct {
	Version           uint32 `json:"v"`
	ScopeSHA256       string `json:"s"`
	CreatedAtUnixNano int64  `json:"t"`
	CommentID         string `json:"c"`
}

func EncodePrivateCommentCursor(
	viewerPTID string,
	postID string,
	cursor PrivateCommentCursor,
) (string, error) {
	const operation = "social.private_content.encode_comment_cursor"
	if cursor.IsZero() {
		return "", nil
	}
	if err := validatePrivateCommentCursor(
		operation,
		viewerPTID,
		postID,
		cursor,
	); err != nil {
		return "", err
	}
	raw, err := json.Marshal(privateCommentCursorWire{
		Version:           privateCommentCursorVersion,
		ScopeSHA256:       privateCommentCursorScopeHash(viewerPTID, postID),
		CreatedAtUnixNano: cursor.CreatedAt.UTC().UnixNano(),
		CommentID:         cursor.CommentID,
	})
	if err != nil {
		return "", WrapPrivateContentError(
			PrivateContentInternal,
			operation,
			err,
		)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func DecodePrivateCommentCursor(
	viewerPTID string,
	postID string,
	encoded string,
) (PrivateCommentCursor, error) {
	const operation = "social.private_content.decode_comment_cursor"
	if encoded == "" {
		return PrivateCommentCursor{}, nil
	}
	if len(encoded) > maxPrivateCommentCursorSize ||
		encoded != strings.TrimSpace(encoded) {
		return PrivateCommentCursor{}, invalidPrivateCommentCursor(operation)
	}
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return PrivateCommentCursor{}, invalidPrivateCommentCursor(operation)
	}
	var wire privateCommentCursorWire
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		return PrivateCommentCursor{}, invalidPrivateCommentCursor(operation)
	}
	canonical, err := json.Marshal(wire)
	if err != nil || !bytes.Equal(canonical, raw) ||
		wire.Version != privateCommentCursorVersion ||
		wire.ScopeSHA256 != privateCommentCursorScopeHash(viewerPTID, postID) ||
		wire.CreatedAtUnixNano <= 0 {
		return PrivateCommentCursor{}, invalidPrivateCommentCursor(operation)
	}
	cursor := PrivateCommentCursor{
		CreatedAt: time.Unix(0, wire.CreatedAtUnixNano).UTC(),
		CommentID: wire.CommentID,
	}
	if err := validatePrivateCommentCursor(
		operation,
		viewerPTID,
		postID,
		cursor,
	); err != nil {
		return PrivateCommentCursor{}, invalidPrivateCommentCursor(operation)
	}
	return cursor, nil
}

func validatePrivateCommentCursor(
	operation string,
	viewerPTID string,
	postID string,
	cursor PrivateCommentCursor,
) error {
	if err := validateIdentifier(
		viewerPTID,
		255,
		"viewer_ptid",
		operation,
	); err != nil {
		return err
	}
	if err := ValidatePrivateContentID(postID, "post_id", operation); err != nil {
		return err
	}
	if cursor.CreatedAt.IsZero() || cursor.CreatedAt.UnixNano() <= 0 {
		return invalidPrivateCommentCursor(operation)
	}
	if err := ValidatePrivateContentID(
		cursor.CommentID,
		"comment_id",
		operation,
	); err != nil {
		return invalidPrivateCommentCursor(operation)
	}
	return nil
}

func privateCommentCursorScopeHash(viewerPTID string, postID string) string {
	digest := sha256.Sum256([]byte(
		"peers-touch:social:private-comment-cursor:v1\x00" +
			viewerPTID + "\x00" + postID,
	))
	return hex.EncodeToString(digest[:])
}

func invalidPrivateCommentCursor(operation string) error {
	return NewPrivateContentError(
		PrivateContentInvalidArgument,
		operation,
		"cursor",
		fmt.Sprintf(
			"must be a canonical version-%d private Comment cursor",
			privateCommentCursorVersion,
		),
	)
}
