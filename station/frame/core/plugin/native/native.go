// Package native wires built-in plugins via blank imports and init side-effects.
package native

import (
	// plugin and submodule registration via init() side-effects
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/logger/logrus"
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/client"
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/node"
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/registry"
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server"
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/store"
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/bootstrap"
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/turn"
	_ "github.com/peers-labs/peers-touch/station/frame/core/plugin/server/hertz"
	_ "github.com/peers-labs/peers-touch/station/frame/touch/activitypub/identity"
)

func init() {
}
