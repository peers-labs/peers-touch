package identity

import (
	"github.com/peers-labs/peers-touch/station/frame/core/identity/adapter"
	apAdapter "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/identity/provider/activitypub"
)

// Init initializes the identity module in touch layer
func Init(domain string) {
	// Register the ActivityPub adapter
	adapter.Register(apAdapter.NewAdapter(domain))
}
