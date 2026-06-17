package domain

import "errors"

var (
	ErrOwnerRequired     = errors.New("note owner is required")
	ErrNoteIDRequired    = errors.New("note id is required")
	ErrNoteNotFound      = errors.New("note not found")
	ErrEmptyContent      = errors.New("note title or content is required")
	ErrNoUpdateFields    = errors.New("note update has no fields")
	ErrPermissionDenied  = errors.New("note permission denied")
	ErrInvalidPageToken  = errors.New("note page token is invalid")
	ErrUnsupportedOrder  = errors.New("note order_by is unsupported")
	ErrSearchQueryEmpty  = errors.New("note search query is required")
	ErrDeletedNoteUpdate = errors.New("deleted note cannot be updated")
)
