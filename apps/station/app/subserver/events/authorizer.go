package events

import "sync"

// SignalAuthorizer decides whether a signaling sender may route a
// CallSignal to a recipient. It is implemented by friend_chat — the
// owner of the social graph — and registered during friend_chat boot,
// so the events subserver can enforce authorization without importing
// friend_chat (which would create an events ↔ friend_chat import
// cycle). The dependency direction therefore stays one-way:
// friend_chat → events.
type SignalAuthorizer interface {
	// CanSignal reports whether senderActorID is permitted to route a
	// call signal to recipientActorID — i.e. the two actors share a
	// friend chat session and neither has blocked the other. This
	// mirrors the messaging authorization gate (see friend_chat
	// SendMessageByActor) so signaling cannot be used to probe or
	// spam non-friends.
	CanSignal(senderActorID, recipientActorID string) (bool, error)
}

var (
	signalAuthorizerMu sync.RWMutex
	signalAuthorizer   SignalAuthorizer
)

// RegisterSignalAuthorizer installs the social-graph authorizer used
// by POST /realtime/signal. friend_chat calls this during Start();
// passing nil (during Stop) clears it. The events subserver treats a
// nil authorizer as fail-closed — see handlePostSignal — because
// signal authorization is a security gate, not a delivery
// convenience.
func RegisterSignalAuthorizer(a SignalAuthorizer) {
	signalAuthorizerMu.Lock()
	defer signalAuthorizerMu.Unlock()
	signalAuthorizer = a
}

func getSignalAuthorizer() SignalAuthorizer {
	signalAuthorizerMu.RLock()
	defer signalAuthorizerMu.RUnlock()
	return signalAuthorizer
}
