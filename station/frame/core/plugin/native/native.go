package native

import (
	_ "github.com/peers-touch/peers-touch/station/frame/core/plugin/logger/logrus"
	_ "github.com/peers-touch/peers-touch/station/frame/core/plugin/native/client"
	_ "github.com/peers-touch/peers-touch/station/frame/core/plugin/native/node"
	_ "github.com/peers-touch/peers-touch/station/frame/core/plugin/native/registry"
	_ "github.com/peers-touch/peers-touch/station/frame/core/plugin/native/server"
	_ "github.com/peers-touch/peers-touch/station/frame/core/plugin/native/store"
	_ "github.com/peers-touch/peers-touch/station/frame/core/plugin/native/subserver/bootstrap"
	_ "github.com/peers-touch/peers-touch/station/frame/core/plugin/native/subserver/turn"
	_ "github.com/peers-touch/peers-touch/station/frame/core/plugin/server/hertz"
)

func init() {
}
