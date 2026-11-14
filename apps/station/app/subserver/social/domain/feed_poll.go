package domain

import (
	"bytes"
	"crypto/sha256"
	"math"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

const (
	FeedPollDefinitionDomain = "peers-touch/social-feed/poll-definition/v1\x00"
	FeedPollAdmissionDomain  = "peers-touch/social-feed/poll-admission/v1\x00"
	maxPollLifetimeMs        = int64(30 * 24 * time.Hour / time.Millisecond)
)

// Shape validation never measures an edit's duration from its later timestamp.
func ValidateFeedPollRequest(r *model.CreatePollPostRequest) error {
	if r == nil || r.ExpiresAtUnixMs < 0 ||
		(r.ExpiresAtUnixMs == 0 && (r.DurationHours < 1 || r.DurationHours > 720)) ||
		(r.ExpiresAtUnixMs > 0 && r.DurationHours != 0) {
		return ErrFeedInvalid
	}
	min, max := feedPollChoices(r)
	if r.MultipleChoice != (max > 1) {
		return ErrFeedInvalid
	}
	return ValidateFeedPollDefinition(&model.FeedPollDefinition{
		Question: r.Question, Options: r.Options, MinChoices: min,
		MaxChoices: max, ExpiresAtUnixMs: 1,
	})
}

func feedPollChoices(r *model.CreatePollPostRequest) (uint32, uint32) {
	min, max := r.MinChoices, r.MaxChoices
	if min == 0 {
		min = 1
	}
	if max == 0 {
		max = 1
		if r.MultipleChoice {
			max = uint32(len(r.Options))
		}
	}
	return min, max
}

// Every portable interaction binds the same stable parent-thread reference.
func FeedInteractionTarget(payload *model.FeedPayload) (string, error) {
	if payload == nil {
		return "", ErrFeedInvalid
	}
	var target string
	switch mutation := payload.Mutation.(type) {
	case *model.FeedPayload_Reaction:
		target = mutation.Reaction.GetTargetPostRef()
	case *model.FeedPayload_Comment:
		target = mutation.Comment.GetTargetPostRef()
	case *model.FeedPayload_PollBallot:
		target = mutation.PollBallot.GetTargetPostRef()
	default:
		return "", ErrFeedInvalid
	}
	if _, _, err := FeedTargetPost(target); err != nil {
		return "", err
	}
	return target, nil
}

func FeedPollDefinitionFor(r *model.CreatePollPostRequest, createdAt int64) (*model.FeedPollDefinition, error) {
	if ValidateFeedPollRequest(r) != nil || createdAt <= 0 || createdAt > math.MaxInt64-maxPollLifetimeMs {
		return nil, ErrFeedInvalid
	}
	expires := r.ExpiresAtUnixMs
	if expires == 0 {
		expires = createdAt + int64(r.DurationHours)*3_600_000
	}
	min, max := feedPollChoices(r)
	definition := &model.FeedPollDefinition{
		Question: r.Question, Options: append([]string(nil), r.Options...),
		MinChoices: min, MaxChoices: max, ExpiresAtUnixMs: expires,
	}
	if expires <= createdAt || expires-createdAt > maxPollLifetimeMs ||
		ValidateFeedPollDefinition(definition) != nil {
		return nil, ErrFeedInvalid
	}
	return definition, nil
}

func ValidateFeedPollDefinition(d *model.FeedPollDefinition) error {
	if d == nil || len(d.Question) > 1000 || strings.TrimSpace(d.Question) == "" ||
		d.Question != strings.TrimSpace(d.Question) || len(d.Options) < 2 || len(d.Options) > 10 ||
		d.MinChoices < 1 || d.MaxChoices < d.MinChoices || int(d.MaxChoices) > len(d.Options) ||
		d.ExpiresAtUnixMs <= 0 {
		return ErrFeedInvalid
	}
	distinct := make(map[string]struct{}, len(d.Options))
	for _, option := range d.Options {
		if option == "" || option != strings.TrimSpace(option) || len(option) > 500 {
			return ErrFeedInvalid
		}
		if _, exists := distinct[option]; exists {
			return ErrFeedInvalid
		}
		distinct[option] = struct{}{}
	}
	return nil
}

func FeedPollDefinitionHash(d *model.FeedPollDefinition) ([]byte, error) {
	if err := ValidateFeedPollDefinition(d); err != nil {
		return nil, err
	}
	return signedlog.Hash(FeedPollDefinitionDomain, d)
}

func ValidateFeedPollPostUpdate(original, updated *model.CreatePostRequest, createdAt int64) error {
	if original == nil || updated == nil {
		return ErrFeedInvalid
	}
	oldPoll, newPoll := original.GetPoll(), updated.GetPoll()
	if oldPoll == nil && newPoll == nil {
		return nil
	}
	if oldPoll == nil || newPoll == nil {
		return ErrFeedInvalid
	}
	oldDefinition, err := FeedPollDefinitionFor(oldPoll, createdAt)
	if err != nil {
		return err
	}
	newDefinition, err := FeedPollDefinitionFor(newPoll, createdAt)
	if err != nil {
		return err
	}
	oldHash, err := FeedPollDefinitionHash(oldDefinition)
	if err != nil {
		return err
	}
	newHash, err := FeedPollDefinitionHash(newDefinition)
	if err != nil || !bytes.Equal(oldHash, newHash) {
		return ErrFeedInvalid
	}
	return nil
}

func ValidateFeedPollBallot(b *model.FeedPollBallotMutation) error {
	if b == nil || len(b.DefinitionHash) != sha256.Size ||
		len(b.OptionIndices) < 1 || len(b.OptionIndices) > 10 {
		return ErrFeedInvalid
	}
	if _, _, err := FeedTargetPost(b.TargetPostRef); err != nil {
		return err
	}
	previous := int32(-1)
	for _, option := range b.OptionIndices {
		if option < 0 || option >= 10 || option <= previous {
			return ErrFeedInvalid
		}
		previous = option
	}
	return nil
}

func DecideFeedPollBallot(b *model.FeedPollBallotMutation, d *model.FeedPollDefinition, at int64) (model.FeedPollAdmissionResult, error) {
	if ValidateFeedPollBallot(b) != nil || at <= 0 {
		return model.FeedPollAdmissionResult_FEED_POLL_ADMISSION_RESULT_UNSPECIFIED, ErrFeedInvalid
	}
	hash, err := FeedPollDefinitionHash(d)
	if err != nil {
		return model.FeedPollAdmissionResult_FEED_POLL_ADMISSION_RESULT_UNSPECIFIED, err
	}
	if !bytes.Equal(hash, b.DefinitionHash) {
		return model.FeedPollAdmissionResult_FEED_POLL_ADMISSION_RESULT_DEFINITION_CHANGED, nil
	}
	if len(b.OptionIndices) < int(d.MinChoices) || len(b.OptionIndices) > int(d.MaxChoices) ||
		int(b.OptionIndices[len(b.OptionIndices)-1]) >= len(d.Options) {
		return model.FeedPollAdmissionResult_FEED_POLL_ADMISSION_RESULT_INVALID_SELECTION, nil
	}
	if at >= d.ExpiresAtUnixMs {
		return model.FeedPollAdmissionResult_FEED_POLL_ADMISSION_RESULT_CLOSED, nil
	}
	return model.FeedPollAdmissionResult_FEED_POLL_ADMISSION_RESULT_ACCEPTED, nil
}

func FeedPollAdmissionSigningBytes(statement *model.FeedPollAdmissionStatement) ([]byte, error) {
	if statement == nil {
		return nil, ErrFeedInvalid
	}
	wire, err := signedlog.Canonical(statement)
	if err != nil {
		return nil, err
	}
	return append([]byte(FeedPollAdmissionDomain), wire...), nil
}

// Receivers use Home's signed admission time. Device timestamps do not prove
// receipt before the cutoff; this validates bindings separately from its key.
func ValidateFeedPollAdmission(admission *model.FeedPollAdmission, event *model.FeedEvent, d *model.FeedPollDefinition) error {
	if admission == nil || admission.Statement == nil || len(admission.StationSignature) != 64 ||
		event == nil || event.Statement == nil ||
		event.Statement.Kind != model.FeedEventKind_FEED_EVENT_KIND_POLL_BALLOT_SET {
		return ErrFeedInvalid
	}
	s := admission.Statement
	payload := &model.FeedPayload{}
	if signedlog.Decode(event.Payload, payload) != nil || ValidateFeedPollBallot(payload.GetPollBallot()) != nil {
		return ErrFeedInvalid
	}
	ballot := payload.GetPollBallot()
	home, _, err := FeedTargetPost(ballot.TargetPostRef)
	if err != nil {
		return err
	}
	eventHash, err := FeedEventHash(event)
	if err != nil {
		return err
	}
	definitionHash, err := FeedPollDefinitionHash(d)
	if err != nil {
		return err
	}
	if s.FormatVersion != 1 || s.HomeStationPeerId != home || s.TargetPostRef != ballot.TargetPostRef ||
		!feedIdentifier(s.SigningKeyId) || !bytes.Equal(s.EventHash, eventHash) ||
		!bytes.Equal(s.DefinitionHash, definitionHash) || s.AcceptedAtUnixMs <= 0 {
		return ErrFeedInvalid
	}
	if s.Result == model.FeedPollAdmissionResult_FEED_POLL_ADMISSION_RESULT_TARGET_UNAVAILABLE {
		return nil
	}
	expected, err := DecideFeedPollBallot(ballot, d, s.AcceptedAtUnixMs)
	if err != nil || s.Result != expected {
		return ErrFeedInvalid
	}
	return nil
}
