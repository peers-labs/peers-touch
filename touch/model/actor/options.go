package actor

import "github.com/dirty-bro-tech/peers-touch-go/core/option"

type actorOptionKey struct{}

var (
	wrapper = option.NewWrapper[Options](actorOptionKey{}, func(options *option.Options) *Options {
		return &Options{
			Options: options,
		}
	})
)

type Options struct {
	*option.Options
}
