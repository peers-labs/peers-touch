package githubrepository

import "errors"

var (
	ErrConflict         = errors.New("github_repository_conflict")
	ErrUnavailable      = errors.New("github_repository_unavailable")
	ErrCorrupt          = errors.New("github_repository_corrupt")
	ErrResponseTooLarge = errors.New("github_repository_response_too_large")
)
