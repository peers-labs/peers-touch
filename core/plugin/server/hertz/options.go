package hertz

import (
	"context"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

func WithSome(value interface{}) server.Option {
	return func(o *server.Options) {
		o.Context = context.WithValue(o.Context, "WithSome", value)
	}
}
