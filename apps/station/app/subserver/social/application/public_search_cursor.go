package application

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"time"

	searchpb "github.com/peers-labs/peers-touch/station/app/model/search"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"google.golang.org/protobuf/proto"
)

type publicSearchCursor struct {
	Binding     string                              `json:"binding"`
	Observation string                              `json:"observation"`
	ExpiresAt   int64                               `json:"expires_at"`
	After       infrastructure.PublicSearchPosition `json:"after"`
}

func newPublicSearchCursorCipher() (cipher.AEAD, error) {
	key := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func publicSearchBinding(viewer string, request *searchpb.QueryIntent) string {
	intent := proto.Clone(request).(*searchpb.QueryIntent)
	intent.Cursor, intent.Refresh = "", false
	data, _ := proto.MarshalOptions{Deterministic: true}.Marshal(intent)
	return publicSearchHash([]byte(viewer), data)
}

func publicSearchHash(parts ...[]byte) string {
	h := sha256.New()
	for _, part := range parts {
		h.Write(part)
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

func (s *PublicSearchService) decodeCursor(token, binding string) (publicSearchCursor, error) {
	var cursor publicSearchCursor
	if len(token) > 2048 {
		return cursor, publicSearchError(searchpb.SearchErrorCode_SEARCH_ERROR_CODE_CURSOR_EXPIRED)
	}
	data, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(data) < s.cursorCipher.NonceSize()+s.cursorCipher.Overhead() {
		return cursor, publicSearchError(searchpb.SearchErrorCode_SEARCH_ERROR_CODE_CURSOR_EXPIRED)
	}
	nonce, ciphertext := data[:s.cursorCipher.NonceSize()], data[s.cursorCipher.NonceSize():]
	payload, err := s.cursorCipher.Open(nil, nonce, ciphertext, []byte(PublicSearchSourceID))
	if err != nil || json.Unmarshal(payload, &cursor) != nil ||
		cursor.Binding != binding || cursor.ExpiresAt <= time.Now().UnixMilli() ||
		cursor.After.ID == 0 {
		return cursor, publicSearchError(searchpb.SearchErrorCode_SEARCH_ERROR_CODE_CURSOR_EXPIRED)
	}
	return cursor, nil
}

func (s *PublicSearchService) encodeCursor(cursor publicSearchCursor) (string, error) {
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, s.cursorCipher.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	data := s.cursorCipher.Seal(nonce, nonce, payload, []byte(PublicSearchSourceID))
	return base64.RawURLEncoding.EncodeToString(data), nil
}
