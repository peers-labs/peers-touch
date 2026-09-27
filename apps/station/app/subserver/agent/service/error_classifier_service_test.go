package service

import (
	"net/http"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
)

func TestErrorClassifierRecognizesOllamaMissingModel(t *testing.T) {
	classified := NewErrorClassifierService().Classify(
		&ProviderHTTPError{
			StatusCode: http.StatusNotFound,
			Body:       `{"error":"model 'pt-missing-model-sample-001' not found"}`,
			Provider:   "ollama",
		},
		"ollama",
		"pt-missing-model-sample-001",
		0,
		0,
	)

	if classified.Reason != domain.FailoverReasonModelNotFound {
		t.Fatalf("reason = %q, want model_not_found", classified.Reason)
	}
}

func TestErrorClassifierKeepsGenericNotFoundUnknown(t *testing.T) {
	classified := NewErrorClassifierService().Classify(
		&ProviderHTTPError{
			StatusCode: http.StatusNotFound,
			Body:       `{"error":"route not found"}`,
			Provider:   "ollama",
		},
		"ollama",
		"qwen3:14b",
		0,
		0,
	)

	if classified.Reason != domain.FailoverReasonUnknown {
		t.Fatalf("reason = %q, want unknown", classified.Reason)
	}
}
