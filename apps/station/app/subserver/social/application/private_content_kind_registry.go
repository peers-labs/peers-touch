package application

import (
	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
)

// privateKindBinding maps one E2EE private moment kind to its public PostType
// and the stored kind discriminator. Adding or removing a content kind edits
// this table only; the projection/read mapping functions stay kernel-stable.
type privateKindBinding struct {
	kind     privatecontentpb.PrivateMomentKind
	stored   string
	postType actormodel.PostType
}

// privateKindRegistry is the immutable dispatch table for private moment
// content kinds. Order is irrelevant; lookups are by kind and stored string.
var privateKindRegistry = []privateKindBinding{
	{privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_TEXT, privateContentPostKindText, actormodel.PostType_TEXT},
	{privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_IMAGE, privateContentPostKindImage, actormodel.PostType_IMAGE},
	{privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_VIDEO, privateContentPostKindVideo, actormodel.PostType_VIDEO},
	{privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_LINK, privateContentPostKindLink, actormodel.PostType_LINK},
	{privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_POLL, privateContentPostKindPoll, actormodel.PostType_POLL},
	{privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_REPOST, privateContentPostKindRepost, actormodel.PostType_REPOST},
	{privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_LOCATION, privateContentPostKindLocation, actormodel.PostType_LOCATION},
}

func privateBindingForKind(kind privatecontentpb.PrivateMomentKind) (privateKindBinding, bool) {
	for _, b := range privateKindRegistry {
		if b.kind == kind {
			return b, true
		}
	}
	return privateKindBinding{}, false
}

func privateBindingForStored(kind string) (privateKindBinding, bool) {
	for _, b := range privateKindRegistry {
		if b.stored == kind {
			return b, true
		}
	}
	return privateKindBinding{}, false
}

// privateMomentProjection maps an E2EE kind to its stored discriminator and
// public PostType. Unknown kinds retain the legacy TEXT fallback (empty stored
// kind), matching the previous switch default.
func privateMomentProjection(kind privatecontentpb.PrivateMomentKind) (string, actormodel.PostType) {
	if b, ok := privateBindingForKind(kind); ok {
		return b.stored, b.postType
	}
	return "", actormodel.PostType_TEXT
}

// privateStoredPostType resolves the public PostType for a stored kind.
// Unknown kinds retain the legacy integrity-failure error rather than a
// silent fallback.
func privateStoredPostType(kind string) (actormodel.PostType, error) {
	if b, ok := privateBindingForStored(kind); ok {
		return b.postType, nil
	}
	return actormodel.PostType_TEXT,
		socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			"social.private_content.read_moment",
			"post.kind",
			"is unsupported",
		)
}
