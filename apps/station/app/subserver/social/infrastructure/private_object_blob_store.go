package infrastructure

import (
	"context"
	"fmt"
	"io"

	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
)

type PrivateObjectBlobStore struct {
	backend storage.Backend
}

func NewPrivateObjectBlobStore(
	backend storage.Backend,
) (*PrivateObjectBlobStore, error) {
	if backend == nil {
		return nil, fmt.Errorf(
			"%w: private object storage backend is required",
			ErrPrivateContentInvalid,
		)
	}
	return &PrivateObjectBlobStore{backend: backend}, nil
}

func (s *PrivateObjectBlobStore) Save(
	ctx context.Context,
	storageKey string,
	reader io.Reader,
) error {
	if storageKey == "" || reader == nil {
		return fmt.Errorf(
			"%w: storage key and reader are required",
			ErrPrivateContentInvalid,
		)
	}
	if _, err := s.backend.Save(ctx, storageKey, reader); err != nil {
		return fmt.Errorf("social private object save blob: %w", err)
	}
	return nil
}

func (s *PrivateObjectBlobStore) Open(
	ctx context.Context,
	storageKey string,
	start int64,
	end int64,
) (io.ReadCloser, int64, error) {
	var requestedRange *storage.Range
	if start >= 0 {
		requestedRange = &storage.Range{Start: start, End: end}
	}
	reader, totalSize, _, err := s.backend.Open(
		ctx,
		storageKey,
		requestedRange,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("social private object open blob: %w", err)
	}
	return reader, totalSize, nil
}

func (s *PrivateObjectBlobStore) Stat(
	ctx context.Context,
	storageKey string,
) (int64, error) {
	info, err := s.backend.Stat(ctx, storageKey)
	if err != nil {
		return 0, fmt.Errorf("social private object stat blob: %w", err)
	}
	return info.Size, nil
}

func (s *PrivateObjectBlobStore) Delete(
	ctx context.Context,
	storageKey string,
) error {
	if err := s.backend.Delete(ctx, storageKey); err != nil {
		return fmt.Errorf("social private object delete blob: %w", err)
	}
	return nil
}
