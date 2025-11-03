package station

import "github.com/peers-touch/peers-touch/station/frame/core/option"

type serverOptionsKey struct{}

var optionWrapper = option.NewWrapper[Options](serverOptionsKey{}, func(options *option.Options) *Options {
	return &Options{
		Options: options,
	}
})

type Options struct {
	*option.Options
}
