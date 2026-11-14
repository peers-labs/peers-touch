package domain

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
)

func TestFeedPollCanonicalSelectionAndDeadline(t *testing.T) {
	created := int64(1_700_000_000_000)
	request := &model.CreatePollPostRequest{Question: "Which route?", Options: []string{"Direct", "Relay"}, DurationHours: 1}
	definition, err := FeedPollDefinitionFor(request, created)
	if err != nil || definition.MinChoices != 1 || definition.MaxChoices != 1 ||
		definition.ExpiresAtUnixMs != created+3_600_000 {
		t.Fatal(definition, err)
	}
	hash, _ := FeedPollDefinitionHash(definition)
	ballot := &model.FeedPollBallotMutation{TargetPostRef: "oss://station-a/post/101", DefinitionHash: hash, OptionIndices: []int32{0}}
	for _, options := range [][]int32{nil, {0, 0}, {1, 0}, {-1}, {10}} {
		ballot.OptionIndices = options
		if ValidateFeedPollBallot(ballot) == nil {
			t.Fatal("noncanonical selection accepted", options)
		}
	}
	for _, options := range [][]int32{{0, 1}, {2}} {
		ballot.OptionIndices = options
		result, err := DecideFeedPollBallot(ballot, definition, created)
		if err != nil || result != model.FeedPollAdmissionResult_FEED_POLL_ADMISSION_RESULT_INVALID_SELECTION {
			t.Fatal(result, err)
		}
	}
	ballot.OptionIndices = []int32{0}
	for _, at := range []int64{definition.ExpiresAtUnixMs - 1, definition.ExpiresAtUnixMs} {
		result, err := DecideFeedPollBallot(ballot, definition, at)
		closed := result == model.FeedPollAdmissionResult_FEED_POLL_ADMISSION_RESULT_CLOSED
		if err != nil || closed != (at == definition.ExpiresAtUnixMs) {
			t.Fatal(result, err)
		}
	}
	request.MultipleChoice, request.MinChoices, request.MaxChoices = true, 2, 2
	definition, err = FeedPollDefinitionFor(request, created)
	if err != nil {
		t.Fatal(err)
	}
	ballot.DefinitionHash, _ = FeedPollDefinitionHash(definition)
	if result, _ := DecideFeedPollBallot(ballot, definition, created); result != model.FeedPollAdmissionResult_FEED_POLL_ADMISSION_RESULT_INVALID_SELECTION {
		t.Fatal("minimum choices ignored")
	}
	ballot.OptionIndices = []int32{0, 1}
	if result, err := DecideFeedPollBallot(ballot, definition, created); err != nil ||
		result != model.FeedPollAdmissionResult_FEED_POLL_ADMISSION_RESULT_ACCEPTED {
		t.Fatal(result, err)
	}
}

func TestFeedPollEditRetainsOriginalDefinition(t *testing.T) {
	original := &model.CreatePostRequest{Content: &model.CreatePostRequest_Poll{Poll: &model.CreatePollPostRequest{
		Text: "Original", Question: "Which route?", Options: []string{"Direct", "Relay"}, DurationHours: 1,
	}}}
	updated := proto.Clone(original).(*model.CreatePostRequest)
	updated.GetPoll().Text = "Edited"
	if err := ValidateFeedPollPostUpdate(original, updated, 1_700_000_000_000); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*model.CreatePostRequest){
		func(r *model.CreatePostRequest) { r.GetPoll().Question = "Changed" },
		func(r *model.CreatePostRequest) { r.GetPoll().Options[0] = "Changed" },
		func(r *model.CreatePostRequest) { r.GetPoll().DurationHours = 2 },
		func(r *model.CreatePostRequest) { r.GetPoll().MultipleChoice = true },
		func(r *model.CreatePostRequest) {
			r.Content = &model.CreatePostRequest_Text{Text: &model.CreateTextPostRequest{Text: "Replacement"}}
		},
	} {
		changed := proto.Clone(updated).(*model.CreatePostRequest)
		mutate(changed)
		if ValidateFeedPollPostUpdate(original, changed, 1_700_000_000_000) == nil {
			t.Fatal("definition replacement accepted")
		}
	}
}

func TestFeedPollAdmissionBindsIndependentStationDecision(t *testing.T) {
	bundle, _, _ := feedVector(t)
	event := proto.Clone(bundle.Events[0]).(*model.FeedEvent)
	created := event.Statement.CreatedAtUnixMs
	definition, err := FeedPollDefinitionFor(&model.CreatePollPostRequest{
		Question: "Which route?", Options: []string{"Direct", "Relay"}, DurationHours: 1,
	}, created)
	if err != nil {
		t.Fatal(err)
	}
	definitionHash, _ := FeedPollDefinitionHash(definition)
	ballot := &model.FeedPollBallotMutation{TargetPostRef: "oss://station-a/post/101",
		DefinitionHash: definitionHash, OptionIndices: []int32{0}}
	event.Statement.Kind = model.FeedEventKind_FEED_EVENT_KIND_POLL_BALLOT_SET
	event.Payload, _ = signedlog.Canonical(&model.FeedPayload{Mutation: &model.FeedPayload_PollBallot{PollBallot: ballot}})
	payloadHash := sha256.Sum256(event.Payload)
	event.Statement.PayloadHash = payloadHash[:]
	wire, _ := signedlog.SigningBytes(FeedEventDomain, event.Statement)
	event.DeviceSignature = ed25519.Sign(ed25519.NewKeyFromSeed(bytes.Repeat([]byte{2}, 32)), wire)
	if err := VerifyFeedEvent(event, bundle.WriterGrant); err != nil {
		t.Fatal(err)
	}
	eventHash, _ := FeedEventHash(event)
	stationKey := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{7}, 32))
	admission := &model.FeedPollAdmission{Statement: &model.FeedPollAdmissionStatement{
		FormatVersion: 1, HomeStationPeerId: "station-a", TargetPostRef: ballot.TargetPostRef,
		EventHash: eventHash, DefinitionHash: definitionHash, AcceptedAtUnixMs: definition.ExpiresAtUnixMs,
		Result: model.FeedPollAdmissionResult_FEED_POLL_ADMISSION_RESULT_CLOSED, SigningKeyId: "station-key",
	}}
	wire, _ = FeedPollAdmissionSigningBytes(admission.Statement)
	admission.StationSignature = ed25519.Sign(stationKey, wire)
	if err := ValidateFeedPollAdmission(admission, event, definition); err != nil {
		t.Fatal(err)
	}
	if err := signedlog.Verify(FeedPollAdmissionDomain, admission.Statement,
		stationKey.Public().(ed25519.PublicKey), admission.StationSignature); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*model.FeedPollAdmissionStatement){
		func(s *model.FeedPollAdmissionStatement) { s.HomeStationPeerId = "station-b" },
		func(s *model.FeedPollAdmissionStatement) { s.TargetPostRef = "oss://station-a/post/102" },
		func(s *model.FeedPollAdmissionStatement) { s.EventHash[0] ^= 1 },
		func(s *model.FeedPollAdmissionStatement) { s.DefinitionHash[0] ^= 1 },
		func(s *model.FeedPollAdmissionStatement) { s.AcceptedAtUnixMs = created },
		func(s *model.FeedPollAdmissionStatement) {
			s.Result = model.FeedPollAdmissionResult_FEED_POLL_ADMISSION_RESULT_ACCEPTED
		},
	} {
		changed := proto.Clone(admission).(*model.FeedPollAdmission)
		mutate(changed.Statement)
		if ValidateFeedPollAdmission(changed, event, definition) == nil {
			t.Fatal("changed admission binding accepted")
		}
		if signedlog.Verify(FeedPollAdmissionDomain, changed.Statement,
			stationKey.Public().(ed25519.PublicKey), changed.StationSignature) == nil {
			t.Fatal("changed signature accepted")
		}
	}
}
