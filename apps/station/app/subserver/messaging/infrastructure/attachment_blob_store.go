package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"io"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
)

type AttachmentBlobStore struct {
	backend storage.Backend
}

func NewAttachmentBlobStore(backend storage.Backend) (*AttachmentBlobStore, error) {
	if backend == nil {
		return nil, fmt.Errorf("messaging: attachment blob backend is required")
	}
	return &AttachmentBlobStore{backend: backend}, nil
}

func (s *AttachmentBlobStore) Save(
	ctx context.Context,
	storageKey string,
	reader io.Reader,
) error {
	_, err := s.backend.Save(ctx, storageKey, reader)
	return err
}

func (s *AttachmentBlobStore) Open(
	ctx context.Context,
	storageKey string,
	start int64,
	end int64,
) (io.ReadCloser, int64, error) {
	var requestedRange *storage.Range
	if start >= 0 {
		requestedRange = &storage.Range{Start: start, End: end}
	}
	reader, size, _, err := s.backend.Open(ctx, storageKey, requestedRange)
	if errors.Is(err, storage.ErrRangeNotSatisfiable) {
		return nil, 0, messaging.ErrAttachmentRange
	}
	return reader, size, err
}

func (s *AttachmentBlobStore) Delete(ctx context.Context, storageKey string) error {
	return s.backend.Delete(ctx, storageKey)
}
