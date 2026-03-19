package registry

import "errors"

var (
	// ErrNotFound is returned when a peer is not found
	ErrNotFound = errors.New("peer not found")

	// ErrPeerExists is returned when trying to register a peer that already exists
	ErrPeerExists = errors.New("peer already exists")

	// ErrInvalidPeer is returned when the peer data is invalid
	ErrInvalidPeer = errors.New("invalid peer data")

	// ErrRegistryClosed is returned when trying to use a closed registry
	ErrRegistryClosed = errors.New("registry is closed")

	// ErrTimeout is returned when an operation times out
	ErrTimeout = errors.New("operation timed out")

	// ErrInvalidOptions is returned when invalid options are provided
	ErrInvalidOptions = errors.New("invalid options provided")

	// ErrWatchFailed is returned when watching peers fails
	ErrWatchFailed = errors.New("failed to watch peers")

	// ErrNetwork is returned when there's a network-related error
	ErrNetwork = errors.New("network error")

	// ErrUnauthorized is returned when authentication/authorization fails
	ErrUnauthorized = errors.New("unauthorized access")
)

// IsNotFound checks if the error is a not found error
func IsNotFound(err error) bool {
	return errors.Is(err, ErrNotFound)
}

// IsPeerExists checks if the error is a peer exists error
func IsPeerExists(err error) bool {
	return errors.Is(err, ErrPeerExists)
}

// IsInvalidPeer checks if the error is an invalid peer error
func IsInvalidPeer(err error) bool {
	return errors.Is(err, ErrInvalidPeer)
}

// IsRegistryClosed checks if the error is a registry closed error
func IsRegistryClosed(err error) bool {
	return errors.Is(err, ErrRegistryClosed)
}

// IsTimeout checks if the error is a timeout error
func IsTimeout(err error) bool {
	return errors.Is(err, ErrTimeout)
}

// IsInvalidOptions checks if the error is an invalid options error
func IsInvalidOptions(err error) bool {
	return errors.Is(err, ErrInvalidOptions)
}

// IsWatchFailed checks if the error is a watch failed error
func IsWatchFailed(err error) bool {
	return errors.Is(err, ErrWatchFailed)
}

// IsNetwork checks if the error is a network error
func IsNetwork(err error) bool {
	return errors.Is(err, ErrNetwork)
}

// IsUnauthorized checks if the error is an unauthorized error
func IsUnauthorized(err error) bool {
	return errors.Is(err, ErrUnauthorized)
}
