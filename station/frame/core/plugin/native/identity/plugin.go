package identity

import (
	"github.com/peers-labs/peers-touch/station/frame/core/identity/adapter"
	nativeAdapter "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/identity/adapter"
)

func init() {
	// Register the libp2p adapter
	adapter.Register(nativeAdapter.NewLibp2pAdapter())
}
