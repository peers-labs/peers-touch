package attachment

import (
	"context"
	"errors"
	"io"

	attachmentapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/attachment"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
)

// BlobStore adapts generic opaque storage without delegating authorization to it.
type BlobStore struct {
	backend storage.Backend
}

func NewBlobStore(backend storage.Backend) (*BlobStore, error) {
	if backend == nil {
		return nil, attachmentapp.NewError(
			attachmentapp.ErrorCodeInvalidArgument,
			"attachment_blob_store.new",
			"backend",
			"is required",
		)
	}

	return &BlobStore{backend: backend}, nil
}

func (s *BlobStore) Save(
	ctx context.Context,
	storageKey string,
	reader io.Reader,
) error {
	if storageKey == "" || reader == nil {
		return attachmentapp.NewError(
			attachmentapp.ErrorCodeInvalidArgument,
			"attachment_blob_store.save",
			"object",
			"storage key and reader are required",
		)
	}
	if _, err := s.backend.Save(ctx, storageKey, reader); err != nil {
		return attachmentapp.WrapError(
			attachmentapp.ErrorCodePersistence,
			"attachment_blob_store.save",
			err,
		)
	}

	return nil
}

func (s *BlobStore) Open(
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
		return nil, 0, attachmentapp.NewError(
			attachmentapp.ErrorCodeRangeInvalid,
			"attachment_blob_store.open",
			"range",
			"is not satisfiable",
		)
	}
	if err != nil {
		return nil, 0, attachmentapp.WrapError(
			attachmentapp.ErrorCodePersistence,
			"attachment_blob_store.open",
			err,
		)
	}

	return reader, size, nil
}

func (s *BlobStore) Delete(ctx context.Context, storageKey string) error {
	if err := s.backend.Delete(ctx, storageKey); err != nil {
		return attachmentapp.WrapError(
			attachmentapp.ErrorCodePersistence,
			"attachment_blob_store.delete",
			err,
		)
	}

	return nil
}

var _ attachmentapp.BlobStore = (*BlobStore)(nil)
