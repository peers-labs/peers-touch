package server

import (
	"errors"
	"net/http"
	"testing"
)

func TestHandlerError(t *testing.T) {
	t.Run("Error without cause", func(t *testing.T) {
		err := NewHandlerError(http.StatusBadRequest, "invalid input")
		
		if err.Code != http.StatusBadRequest {
			t.Errorf("Code = %d, want %d", err.Code, http.StatusBadRequest)
		}
		
		if err.Message != "invalid input" {
			t.Errorf("Message = %q, want %q", err.Message, "invalid input")
		}
		
		if err.Error() != "invalid input" {
			t.Errorf("Error() = %q, want %q", err.Error(), "invalid input")
		}
		
		if err.Unwrap() != nil {
			t.Errorf("Unwrap() = %v, want nil", err.Unwrap())
		}
	})

	t.Run("Error with cause", func(t *testing.T) {
		cause := errors.New("underlying error")
		err := NewHandlerErrorWithCause(http.StatusInternalServerError, "processing failed", cause)
		
		if err.Code != http.StatusInternalServerError {
			t.Errorf("Code = %d, want %d", err.Code, http.StatusInternalServerError)
		}
		
		if err.Err != cause {
			t.Errorf("Err = %v, want %v", err.Err, cause)
		}
		
		if !errors.Is(err, cause) {
			t.Error("errors.Is() should match the cause")
		}
	})
}

func TestErrorConstructors(t *testing.T) {
	tests := []struct {
		name         string
		constructor  func(string) *HandlerError
		wantCode     int
	}{
		{"BadRequest", BadRequest, http.StatusBadRequest},
		{"Unauthorized", Unauthorized, http.StatusUnauthorized},
		{"Forbidden", Forbidden, http.StatusForbidden},
		{"NotFound", NotFound, http.StatusNotFound},
		{"InternalError", InternalError, http.StatusInternalServerError},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.constructor("test message")
			
			if err.Code != tt.wantCode {
				t.Errorf("%s() Code = %d, want %d", tt.name, err.Code, tt.wantCode)
			}
			
			if err.Message != "test message" {
				t.Errorf("%s() Message = %q, want %q", tt.name, err.Message, "test message")
			}
		})
	}
}

func TestErrorConstructorsWithCause(t *testing.T) {
	cause := errors.New("cause")
	
	t.Run("BadRequestWithCause", func(t *testing.T) {
		err := BadRequestWithCause("test", cause)
		if err.Code != http.StatusBadRequest || err.Err != cause {
			t.Errorf("BadRequestWithCause() = %+v, want code=400 with cause", err)
		}
	})
	
	t.Run("InternalErrorWithCause", func(t *testing.T) {
		err := InternalErrorWithCause("test", cause)
		if err.Code != http.StatusInternalServerError || err.Err != cause {
			t.Errorf("InternalErrorWithCause() = %+v, want code=500 with cause", err)
		}
	})
}
