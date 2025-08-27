package native

import (
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/logger/logrus"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/native/client"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/native/registry"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/native/service"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/native/store"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/native/subserver/bootstrap"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/native/subserver/turn"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/server/hertz"
)

func init() {
}
