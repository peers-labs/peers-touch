package domain

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"math"
	"strings"
	"time"

	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
)

const (
	PrivateContentPollNotPoll           PrivateContentErrorCode = "SOCIAL_PRIVATE_NOT_A_POLL"
	PrivateContentPollInvalidSelection  PrivateContentErrorCode = "SOCIAL_PRIVATE_POLL_INVALID_SELECTION"
	PrivateContentPollDefinitionChanged PrivateContentErrorCode = "SOCIAL_PRIVATE_POLL_DEFINITION_CHANGED"
	PrivateContentPollClosed            PrivateContentErrorCode = "SOCIAL_PRIVATE_POLL_CLOSED"
)

// Signed opaque choices remain canonical. No receiver sorts or deduplicates
// another Actor's submitted intent.
func ValidateVotePrivatePollRequest(request *privatecontentpb.VotePrivatePollRequest, operation string) error {
	if request == nil || len(request.ProtoReflect().GetUnknown()) != 0 ||
		request.GetCommandId() == "" || request.GetCommandId() != strings.TrimSpace(request.GetCommandId()) ||
		len(request.GetCommandId()) > 255 ||
		request.GetActorSigningKeyId() == "" ||
		request.GetActorSigningKeyId() != strings.TrimSpace(request.GetActorSigningKeyId()) ||
		len(request.GetActorDeviceSignature()) != ed25519.SignatureSize ||
		len(request.GetOptionSetSha256()) != sha256.Size {
		return NewPrivateContentError(PrivateContentInvalidArgument, operation, "request", "is incomplete")
	}
	if err := ValidatePrivateContentID(request.GetPostId(), "post_id", operation); err != nil {
		return err
	}
	options := request.GetOpaqueOptionIds()
	if len(options) == 0 || len(options) > MaximumPrivatePollOptions {
		return NewPrivateContentError(PrivateContentPollInvalidSelection, operation, "opaque_option_ids", "quantity is invalid")
	}
	for index, option := range options {
		if len(option) != sha256.Size || (index > 0 && bytes.Compare(options[index-1], option) >= 0) {
			return NewPrivateContentError(PrivateContentPollInvalidSelection, operation, "opaque_option_ids", "must be ordered unique 32-byte values")
		}
	}
	_, err := CanonicalProtoBytes(request)
	return err
}

func VotePrivatePollRequestHash(request *privatecontentpb.VotePrivatePollRequest, operation string) ([]byte, error) {
	if err := ValidateVotePrivatePollRequest(request, operation); err != nil {
		return nil, err
	}
	input := &privatecontentpb.VotePrivatePollHashInput{
		FormatVersion: PrivateContentFormatVersion,
		CommandId:     request.GetCommandId(), PostId: request.GetPostId(),
		OpaqueOptionIds: request.GetOpaqueOptionIds(), OptionSetSha256: request.GetOptionSetSha256(),
		ActorSigningKeyId: request.GetActorSigningKeyId(),
	}
	wire, err := CanonicalProtoBytes(input)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(wire)
	return digest[:], nil
}

// Call under the source parent's lock, after original resource/viewer
// authorization. Source acceptance time owns cutoff, never device time.
func ValidatePrivatePollVote(request *privatecontentpb.VotePrivatePollRequest, authority *privatecontentpb.PrivatePollAuthority, at time.Time, operation string) error {
	if err := ValidateVotePrivatePollRequest(request, operation); err != nil {
		return err
	}
	if authority == nil {
		return NewPrivateContentError(PrivateContentPollNotPoll, operation, "parent", "has no poll authority")
	}
	if err := ValidatePrivatePollAuthority(authority, request.GetPostId(), operation); err != nil {
		return err
	}
	if !bytes.Equal(request.GetOptionSetSha256(), authority.GetOptionSetSha256()) {
		return NewPrivateContentError(PrivateContentPollDefinitionChanged, operation, "option_set_sha256", "does not bind the original definition")
	}
	if len(request.GetOpaqueOptionIds()) < int(authority.GetMinChoices()) ||
		len(request.GetOpaqueOptionIds()) > int(authority.GetMaxChoices()) {
		return NewPrivateContentError(PrivateContentPollInvalidSelection, operation, "opaque_option_ids", "quantity is outside the original bounds")
	}
	cursor := 0
	for _, option := range request.GetOpaqueOptionIds() {
		for cursor < len(authority.GetOpaqueOptionIds()) && bytes.Compare(authority.GetOpaqueOptionIds()[cursor], option) < 0 {
			cursor++
		}
		if cursor == len(authority.GetOpaqueOptionIds()) || !bytes.Equal(authority.GetOpaqueOptionIds()[cursor], option) {
			return NewPrivateContentError(PrivateContentPollInvalidSelection, operation, "opaque_option_ids", "contains an option outside the original definition")
		}
		cursor++
	}
	if at.IsZero() {
		return NewPrivateContentError(PrivateContentInvalidArgument, operation, "admitted_at", "is missing")
	}
	if !at.Before(authority.GetExpiresAt().AsTime()) {
		return NewPrivateContentError(PrivateContentPollClosed, operation, "expires_at", "poll is closed")
	}
	return nil
}

// Results expose opaque IDs only, with one authorized viewer's own selection.
// Counts must be realizable under the immutable original choice bounds.
func ValidatePrivatePollProjection(projection *privatecontentpb.PrivatePollProjection, authority *privatecontentpb.PrivatePollAuthority, operation string) error {
	if projection == nil || authority == nil ||
		len(projection.ProtoReflect().GetUnknown()) != 0 ||
		projection.GetPostId() != authority.GetResource().GetContentId() ||
		!bytes.Equal(projection.GetOptionSetSha256(), authority.GetOptionSetSha256()) ||
		len(projection.GetOptions()) != len(authority.GetOpaqueOptionIds()) ||
		projection.GetProjectionRevision() > math.MaxInt64 ||
		(projection.GetProjectionRevision() == 0 && (projection.GetVoterCount() != 0 ||
			projection.GetCommandId() != "" || projection.GetVoteActorPtid() != "")) ||
		(projection.GetProjectionRevision() > 0 && (projection.GetCommandId() == "" ||
			projection.GetCommandId() != strings.TrimSpace(projection.GetCommandId()) ||
			projection.GetVoteActorPtid() == "" ||
			projection.GetVoteActorPtid() != strings.TrimSpace(projection.GetVoteActorPtid()))) {
		return NewPrivateContentError(PrivateContentIntegrityFailed, operation, "poll_projection", "does not bind the original authority")
	}
	if err := ValidatePrivatePollAuthority(authority, projection.GetPostId(), operation); err != nil {
		return err
	}
	var total, selected uint64
	for index, option := range projection.GetOptions() {
		if option == nil || len(option.ProtoReflect().GetUnknown()) != 0 ||
			!bytes.Equal(option.GetOpaqueOptionId(), authority.GetOpaqueOptionIds()[index]) ||
			option.GetVoteCount() > projection.GetVoterCount() ||
			math.MaxUint64-total < option.GetVoteCount() ||
			(option.GetSelectedByViewer() && option.GetVoteCount() == 0) {
			return NewPrivateContentError(PrivateContentIntegrityFailed, operation, "poll_projection", "has invalid option counts")
		}
		total += option.GetVoteCount()
		if option.GetSelectedByViewer() {
			selected++
		}
	}
	voters := projection.GetVoterCount()
	if voters > math.MaxUint64/uint64(authority.GetMaxChoices()) ||
		total < voters*uint64(authority.GetMinChoices()) || total > voters*uint64(authority.GetMaxChoices()) ||
		(selected != 0 && (selected < uint64(authority.GetMinChoices()) || selected > uint64(authority.GetMaxChoices()))) {
		return NewPrivateContentError(PrivateContentIntegrityFailed, operation, "poll_projection", "has invalid selection totals")
	}
	return nil
}
