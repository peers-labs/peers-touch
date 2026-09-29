package main

import (
	"context"
	"errors"
	"testing"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
)

func TestRotateRecordsRun(t *testing.T) {
	store := &rotationStore{
		results: []entity.RotationResult{
			{Scanned: 5, Rotated: 2, Unchanged: 3},
			{Scanned: 5, Rotated: 2, Unchanged: 3},
			{Scanned: 5, Rotated: 1, Unchanged: 4},
		},
	}
	result, err := runRotation(context.Background(), store, 2)
	if err != nil {
		t.Fatal(err)
	}
	if store.calls != 3 ||
		result.Scanned != 5 ||
		result.Rotated != 5 ||
		result.Unchanged != 4 ||
		result.Failed != 0 {
		t.Fatalf("unexpected aggregate rotation result: %#v calls=%d", result, store.calls)
	}
}

func TestRotateRecordsRunReturnsFailure(t *testing.T) {
	store := &rotationStore{
		results: []entity.RotationResult{{Scanned: 2, Failed: 1}},
		err:     errors.New("oauth_key_unavailable"),
	}
	result, err := runRotation(context.Background(), store, 10)
	if err == nil || result.Failed != 1 || store.calls != 1 {
		t.Fatalf("expected one failed rotation pass: result=%#v err=%v", result, err)
	}
}

type rotationStore struct {
	results []entity.RotationResult
	err     error
	calls   int
}

func (s *rotationStore) RotateEncryption(context.Context, int) (entity.RotationResult, error) {
	index := s.calls
	s.calls++
	if index >= len(s.results) {
		return entity.RotationResult{}, errors.New("unexpected_rotation_call")
	}
	return s.results[index], s.err
}
