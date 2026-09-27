package domain

import (
	"testing"
	"time"
)

func TestPrivateCommentCursorRoundTripAndScope(t *testing.T) {
	cursor := PrivateCommentCursor{
		CreatedAt: time.Date(2026, 9, 17, 1, 2, 3, 400, time.UTC),
		CommentID: "01K55XG0000000000000000001",
	}
	encoded, err := EncodePrivateCommentCursor(
		"ptid:viewer",
		"01K55XG0000000000000000000",
		cursor,
	)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodePrivateCommentCursor(
		"ptid:viewer",
		"01K55XG0000000000000000000",
		encoded,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !decoded.CreatedAt.Equal(cursor.CreatedAt) ||
		decoded.CommentID != cursor.CommentID {
		t.Fatalf("decoded cursor = %+v, want %+v", decoded, cursor)
	}
	for _, testCase := range []struct {
		name   string
		viewer string
		postID string
	}{
		{
			name:   "other viewer",
			viewer: "ptid:other",
			postID: "01K55XG0000000000000000000",
		},
		{
			name:   "other Post",
			viewer: "ptid:viewer",
			postID: "01K55XG0000000000000000002",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := DecodePrivateCommentCursor(
				testCase.viewer,
				testCase.postID,
				encoded,
			); !IsPrivateContentCode(
				err,
				PrivateContentInvalidArgument,
			) {
				t.Fatalf("cross-scope cursor error = %v", err)
			}
		})
	}
}
