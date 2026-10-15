package federation

import (
	"context"
	"errors"
	"net/http"
	"sync/atomic"
)

var (
	ErrRelayNotConnected = errors.New("standard Relay route is unavailable")
)

type RelayAccess interface {
	Available() bool
	RelayOrigin() string
	RoundTrip(
		context.Context,
		string,
		*http.Request,
	) (*http.Response, error)
}

type relayAccessHolder struct {
	access RelayAccess
}

var activeRelayAccess atomic.Value

func RegisterRelayAccess(access RelayAccess) {
	activeRelayAccess.Store(relayAccessHolder{access: access})
}

func ClearRelayAccess() {
	activeRelayAccess.Store(relayAccessHolder{})
}

func RelayAccessSnapshot() RelayAccess {
	value := activeRelayAccess.Load()
	if value == nil {
		return nil
	}
	holder, ok := value.(relayAccessHolder)
	if !ok {
		return nil
	}
	return holder.access
}
