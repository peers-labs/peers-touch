package service

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
)

// Errors produced via the generic errcode.New carry no localized ErrorPayload,
// but their typed code and message must still reach terminal turn persistence
// instead of collapsing to the outer stage string.
func TestApplyTypedTurnErrorFallsBackToGenericBizError(t *testing.T) {
	cause := errcode.New(
		errcode.AgentVersionConflict,
		http.StatusConflict,
		"conversation runtime binding conflicts with the admitted runtime tuple",
		nil,
	)

	var event TurnEvent
	applyTypedTurnError(&event, cause)
	if event.ErrorType != string(errcode.AgentVersionConflict) {
		t.Fatalf("error type = %q, want %q", event.ErrorType, errcode.AgentVersionConflict)
	}
	if event.Error != "conversation runtime binding conflicts with the admitted runtime tuple" {
		t.Fatalf("error message = %q", event.Error)
	}

	raw, err := typedTurnErrorJSON(cause)
	if err != nil {
		t.Fatalf("typed error json: %v", err)
	}
	var payload struct {
		Error     string `json:"error"`
		ErrorType string `json:"error_type"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.ErrorType != string(errcode.AgentVersionConflict) {
		t.Fatalf("payload error_type = %q", payload.ErrorType)
	}

	// A non-BizError stays untyped, matching prior behavior.
	plain := TurnEvent{}
	applyTypedTurnError(&plain, errors.New("db unavailable"))
	if plain.ErrorType != "" || plain.Error != "" {
		t.Fatalf("plain error produced typed fields: %+v", plain)
	}
	if raw, err := typedTurnErrorJSON(errors.New("db unavailable")); err != nil || raw != nil {
		t.Fatalf("plain error payload = %s, err = %v", raw, err)
	}
}
