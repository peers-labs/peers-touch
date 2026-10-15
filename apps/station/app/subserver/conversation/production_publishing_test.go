package conversation

import (
	"bytes"
	"context"
	"io"
	"testing"
	"time"

	publishingapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/publishing"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

type publishingStreamingRequest struct {
	body []byte
}

func (r publishingStreamingRequest) Context() context.Context  { return context.Background() }
func (r publishingStreamingRequest) Header() map[string]string { return nil }
func (r publishingStreamingRequest) Method() server.Method     { return server.POST }
func (r publishingStreamingRequest) Path() string              { return "/message-ingress/id" }
func (r publishingStreamingRequest) Body() []byte {
	panic("streaming publication must not buffer Request.Body")
}
func (r publishingStreamingRequest) BodyStream() io.Reader {
	return bytes.NewReader(r.body)
}

func TestReadBoundedPublishingBodyUsesStreamingReader(t *testing.T) {
	body, err := readBoundedPublishingBody(publishingStreamingRequest{
		body: []byte(`{"content":{"text":{"text":"hello"}}}`),
	})
	if err != nil {
		t.Fatalf("read publication: %v", err)
	}
	if len(body) == 0 {
		t.Fatal("publication body is empty")
	}
}

func TestReadBoundedPublishingBodyRejectsOversize(t *testing.T) {
	_, err := readBoundedPublishingBody(publishingStreamingRequest{
		body: bytes.Repeat([]byte("x"), 64*1024+1),
	})
	if err == nil {
		t.Fatal("oversized publication body must be rejected")
	}
}

func TestProductionPublishingGrantProjectsLifecycleState(t *testing.T) {
	createdAt := time.Date(2026, time.October, 15, 3, 0, 0, 0, time.UTC)
	expiresAt := createdAt.Add(time.Hour)
	target := valueobject.ConversationID("conversation-service-direct")
	projected := productionPublishingGrant(entity.PublishingGrant{
		ID:              "publishing-1",
		Owner:           "ptid:owner",
		Sender:          "ptid:service",
		Name:            "Build publisher",
		SourceNamespace: "ci.build",
		DefaultTarget:   target,
		AllowedTargets:  []valueobject.ConversationID{target},
		SecretHint:      "•••• test",
		Disabled:        true,
		Revoked:         false,
		CreatedAt:       createdAt,
		ExpiresAt:       &expiresAt,
		RatePerMinute:   120,
	})

	if !projected.Disabled || projected.Revoked {
		t.Fatalf(
			"projected lifecycle disabled=%v revoked=%v, want true/false",
			projected.Disabled,
			projected.Revoked,
		)
	}
	if projected.DefaultTarget != string(target) ||
		len(projected.AllowedTargets) != 1 ||
		projected.AllowedTargets[0] != string(target) {
		t.Fatalf("projected targets = %+v", projected)
	}
	if projected.CreatedAt.AsTime() != createdAt ||
		projected.ExpiresAt.AsTime() != expiresAt {
		t.Fatalf("projected timestamps = %+v", projected)
	}
}

func TestProductionPublishingResponseMapsDomainOutcomeAndFailsClosed(t *testing.T) {
	result := &publishingapp.Response{
		CommandID:           "command-1",
		MessageID:           "message-1",
		ConversationID:      "conversation-1",
		ConversationEventID: "event-1",
		EventSequence:       7,
		Outcome:             publishingapp.OutcomeAccepted,
	}
	response, err := productionPublishingResponse(result)
	if err != nil {
		t.Fatalf("map accepted response: %v", err)
	}
	if response.Outcome !=
		chat.PublishMessageOutcome_PUBLISH_MESSAGE_OUTCOME_ACCEPTED ||
		response.CommandId != result.CommandID ||
		response.MessageId != string(result.MessageID) ||
		response.ConversationId != string(result.ConversationID) ||
		response.ConversationEventId != string(result.ConversationEventID) ||
		response.EventSequence != int64(result.EventSequence) {
		t.Fatalf("mapped response = %+v", response)
	}

	result.Outcome = publishingapp.OutcomeReplayed
	response, err = productionPublishingResponse(result)
	if err != nil {
		t.Fatalf("map replayed response: %v", err)
	}
	if response.Outcome !=
		chat.PublishMessageOutcome_PUBLISH_MESSAGE_OUTCOME_REPLAYED {
		t.Fatalf("replayed outcome = %v", response.Outcome)
	}

	if _, err := productionPublishingResponse(nil); err == nil {
		t.Fatal("nil committed result must fail closed")
	}
	result.Outcome = publishingapp.Outcome(255)
	if _, err := productionPublishingResponse(result); err == nil {
		t.Fatal("unknown publication outcome must fail closed")
	}
}
