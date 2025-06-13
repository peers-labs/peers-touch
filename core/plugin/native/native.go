package native

import (
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/logger/logrus"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/registry/native"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/server/hertz"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/server/native"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/service/native"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/store/native"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/subserver/bootstrap"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/subserver/turn"
)

func init() {
}
