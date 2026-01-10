package activitypub

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/touch/crypto"
	ap "github.com/peers-labs/peers-touch/station/frame/vendors/activitypub"
)

// This file contains deprecated ActivityPub functions that return errors
// directing users to use the new Social API instead.
// These stub implementations exist only to maintain backward compatibility
// during the migration period and will be removed in a future version.

func GenerateRSAKeyPair(bits int) (string, string, error) {
	return crypto.GenerateRSAKeyPair(bits)
}

func GetActorData(c context.Context, username string, baseURL string) (*ap.Person, error) {
	return nil, fmt.Errorf("deprecated: use Social API /api/v1/social/actors/:username instead")
}

func FetchOutbox(c context.Context, user string, baseURL string, page bool, viewerID uint64) (interface{}, error) {
	return nil, fmt.Errorf("deprecated: use Social API /api/v1/social/timeline instead")
}

func FetchFollowers(c context.Context, user string, baseURL string, page bool) (interface{}, error) {
	return nil, fmt.Errorf("deprecated: use Social API instead")
}

func FetchLiked(c context.Context, user string, baseURL string, page bool) (interface{}, error) {
	return nil, fmt.Errorf("deprecated: use Social API instead")
}

func FetchSharedInbox(c context.Context, baseURL string, page bool) (interface{}, error) {
	return nil, fmt.Errorf("deprecated: use Social API instead")
}

func FetchObjectReplies(c context.Context, objectID string, baseURL string, page bool, afterID uint64, limit int) (interface{}, error) {
	return nil, fmt.Errorf("deprecated: use Social API /api/v1/social/posts/:id/comments instead")
}

func VerifyHTTPSignature(c context.Context, method string, path string, headers map[string]string, body []byte) error {
	return fmt.Errorf("deprecated: ActivityPub signature verification is no longer supported")
}

func PersistInboxActivity(c context.Context, user string, activity *ap.Activity, baseURL string, body []byte) error {
	return fmt.Errorf("deprecated: use Social API instead")
}

func ApplyFollowInbox(c context.Context, username string, activity *ap.Activity, baseURL string) error {
	return fmt.Errorf("deprecated: use Social API /api/v1/social/actors/:id/follow instead")
}

func ApplyUndoInbox(c context.Context, user string, activity *ap.Activity, baseURL string) error {
	return fmt.Errorf("deprecated: use Social API instead")
}

func IsValidationError(err error) bool {
	return false
}

func Create(c context.Context, actor string, baseURL string, in interface{}) (string, string, error) {
	return "", "", fmt.Errorf("deprecated: use Social API /api/v1/social/posts instead")
}

func GetNodeInfo(c context.Context, baseURL string) (interface{}, error) {
	return nil, fmt.Errorf("deprecated: NodeInfo is no longer supported")
}
