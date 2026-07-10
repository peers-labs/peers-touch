package officialapplets

import (
	"context"
	"strings"
	"testing"

	agentservice "github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type atelierTestRequest struct {
	body []byte
}

func (r atelierTestRequest) Context() context.Context  { return context.Background() }
func (r atelierTestRequest) Header() map[string]string { return nil }
func (r atelierTestRequest) Method() server.Method     { return server.POST }
func (r atelierTestRequest) Path() string              { return atelierV1Prefix + "/messages" }
func (r atelierTestRequest) Body() []byte              { return r.body }

func TestDecodeAtelierMessageJSONRejectsExecutionShapedFields(t *testing.T) {
	for _, body := range []string{
		`{"taskId":"task-1","text":"hello","run":{"kind":"model","model":"gpt-4"}}`,
		`{"taskId":"task-1","text":"hello","attachments":[{"host_storage_ref":"host-storage://task-1/input/file"}]}`,
		`{"taskId":"task-1","text":"hello","inputSnapshot":{"attachments":[]}}`,
		`{"taskId":"task-1","text":"hello","input_snapshot":{"attachments":[]}}`,
	} {
		var input agentservice.SendAtelierMessageRequest
		err := decodeAtelierMessageJSON(atelierTestRequest{body: []byte(body)}, &input)
		if err == nil {
			t.Fatalf("expected forbidden message field rejection for %s", body)
		}
		if !strings.Contains(err.Error(), "must not include") {
			t.Fatalf("expected explicit forbidden field error, got %v", err)
		}
	}
}

func TestDecodeAtelierMessageJSONAcceptsTextOnlyPayload(t *testing.T) {
	var input agentservice.SendAtelierMessageRequest
	if err := decodeAtelierMessageJSON(atelierTestRequest{body: []byte(`{"taskId":"task-1","text":"hello"}`)}, &input); err != nil {
		t.Fatalf("decode text-only message: %v", err)
	}
	if input.TaskID != "task-1" || input.Text != "hello" {
		t.Fatalf("unexpected decoded input: %+v", input)
	}
}

func TestDecodeAtelierFeedbackSubmitJSONRejectsExecutionShapedFields(t *testing.T) {
	for _, body := range []string{
		`{"taskId":"task-1","blockId":"block-1","signal":"positive","run":{"kind":"model"}}`,
		`{"taskId":"task-1","blockId":"block-1","signal":"positive","execute":true}`,
		`{"taskId":"task-1","blockId":"block-1","signal":"positive","provider":{"id":"openai"}}`,
		`{"taskId":"task-1","blockId":"block-1","signal":"positive","attachments":[{"ref":"host-storage://task-1/file"}]}`,
		`{"taskId":"task-1","blockId":"block-1","signal":"positive","memory":"persist this directly"}`,
		`{"taskId":"task-1","blockId":"block-1","signal":"positive","memoryContent":"persist this directly"}`,
		`{"taskId":"task-1","blockId":"block-1","signal":"positive","memory_content":"persist this directly"}`,
		`{"taskId":"task-1","blockId":"block-1","signal":"regenerate","rerun":{"taskId":"task-2"}}`,
		`{"taskId":"task-1","blockId":"block-1","signal":"regenerate","rerunTaskId":"task-2"}`,
		`{"taskId":"task-1","blockId":"block-1","signal":"positive","inputSnapshot":{"attachments":[]}}`,
		`{"taskId":"task-1","blockId":"block-1","signal":"positive","input_snapshot":{"attachments":[]}}`,
	} {
		var input agentservice.SubmitAtelierFeedbackRequest
		err := decodeAtelierFeedbackSubmitJSON(atelierTestRequest{body: []byte(body)}, &input)
		if err == nil {
			t.Fatalf("expected forbidden feedback field rejection for %s", body)
		}
		if !strings.Contains(err.Error(), "must not include") {
			t.Fatalf("expected explicit forbidden field error, got %v", err)
		}
	}
}

func TestDecodeAtelierFeedbackSubmitJSONAcceptsSignalPayload(t *testing.T) {
	var input agentservice.SubmitAtelierFeedbackRequest
	if err := decodeAtelierFeedbackSubmitJSON(atelierTestRequest{body: []byte(`{"taskId":"task-1","blockId":"block-1","signal":"positive","comment":"keep this pattern"}`)}, &input); err != nil {
		t.Fatalf("decode feedback submit: %v", err)
	}
	if input.TaskID != "task-1" || input.BlockID != "block-1" || input.Signal != "positive" || input.Comment != "keep this pattern" {
		t.Fatalf("unexpected decoded input: %+v", input)
	}
}

func TestDecodeAtelierMemoryConfirmationJSONRejectsExecutionShapedFields(t *testing.T) {
	for _, body := range []string{
		`{"taskId":"task-1","feedbackId":"feedback-1","run":{"kind":"model"}}`,
		`{"taskId":"task-1","feedbackId":"feedback-1","execute":true}`,
		`{"taskId":"task-1","feedbackId":"feedback-1","provider":{"id":"openai"}}`,
		`{"taskId":"task-1","feedbackId":"feedback-1","attachments":[{"ref":"host-storage://task-1/file"}]}`,
		`{"taskId":"task-1","feedbackId":"feedback-1","memory":"persist this directly"}`,
		`{"taskId":"task-1","feedbackId":"feedback-1","memoryContent":"persist this directly"}`,
		`{"taskId":"task-1","feedbackId":"feedback-1","memory_content":"persist this directly"}`,
		`{"taskId":"task-1","feedbackId":"feedback-1","content":"persist this directly"}`,
		`{"taskId":"task-1","feedbackId":"feedback-1","target":"global"}`,
		`{"taskId":"task-1","feedbackId":"feedback-1","layer":"system"}`,
		`{"taskId":"task-1","feedbackId":"feedback-1","inputSnapshot":{"attachments":[]}}`,
		`{"taskId":"task-1","feedbackId":"feedback-1","input_snapshot":{"attachments":[]}}`,
	} {
		var input agentservice.ConfirmAtelierMemoryCandidateRequest
		err := decodeAtelierMemoryConfirmationJSON(atelierTestRequest{body: []byte(body)}, &input)
		if err == nil {
			t.Fatalf("expected forbidden memory confirmation field rejection for %s", body)
		}
		if !strings.Contains(err.Error(), "must not include") {
			t.Fatalf("expected explicit forbidden field error, got %v", err)
		}
	}
}

func TestDecodeAtelierMemoryConfirmationJSONAcceptsReferencePayload(t *testing.T) {
	var input agentservice.ConfirmAtelierMemoryCandidateRequest
	if err := decodeAtelierMemoryConfirmationJSON(atelierTestRequest{body: []byte(`{"taskId":"task-1","feedbackId":"feedback-1"}`)}, &input); err != nil {
		t.Fatalf("decode memory confirmation: %v", err)
	}
	if input.TaskID != "task-1" || input.FeedbackID != "feedback-1" {
		t.Fatalf("unexpected decoded input: %+v", input)
	}
}

func TestDecodeAtelierRerunConfirmationJSONRejectsExecutionShapedFields(t *testing.T) {
	for _, body := range []string{
		`{"taskId":"task-1","feedbackId":"feedback-1","run":{"kind":"model"}}`,
		`{"taskId":"task-1","feedbackId":"feedback-1","execute":true}`,
		`{"taskId":"task-1","feedbackId":"feedback-1","provider":{"id":"openai"}}`,
		`{"taskId":"task-1","feedbackId":"feedback-1","attachments":[{"ref":"host-storage://task-1/file"}]}`,
		`{"taskId":"task-1","feedbackId":"feedback-1","rerun":{"taskId":"task-2"}}`,
		`{"taskId":"task-1","feedbackId":"feedback-1","rerunTaskId":"task-2"}`,
		`{"taskId":"task-1","feedbackId":"feedback-1","goal":"run this instead"}`,
		`{"taskId":"task-1","feedbackId":"feedback-1","model":"gpt-4"}`,
		`{"taskId":"task-1","feedbackId":"feedback-1","inputSnapshot":{"attachments":[]}}`,
		`{"taskId":"task-1","feedbackId":"feedback-1","input_snapshot":{"attachments":[]}}`,
	} {
		var input agentservice.ConfirmAtelierRerunRequest
		err := decodeAtelierRerunConfirmationJSON(atelierTestRequest{body: []byte(body)}, &input)
		if err == nil {
			t.Fatalf("expected forbidden rerun confirmation field rejection for %s", body)
		}
		if !strings.Contains(err.Error(), "must not include") {
			t.Fatalf("expected explicit forbidden field error, got %v", err)
		}
	}
}

func TestDecodeAtelierRerunConfirmationJSONAcceptsReferencePayload(t *testing.T) {
	var input agentservice.ConfirmAtelierRerunRequest
	if err := decodeAtelierRerunConfirmationJSON(atelierTestRequest{body: []byte(`{"taskId":"task-1","feedbackId":"feedback-1"}`)}, &input); err != nil {
		t.Fatalf("decode rerun confirmation: %v", err)
	}
	if input.TaskID != "task-1" || input.FeedbackID != "feedback-1" {
		t.Fatalf("unexpected decoded input: %+v", input)
	}
}
