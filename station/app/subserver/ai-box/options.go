package aibox

import "github.com/peers-touch/peers-touch/station/frame/core/option"

type serverOptionsKey struct{}

var optionWrapper = option.NewWrapper[Options](serverOptionsKey{}, func(options *option.Options) *Options {
	return &Options{
		Options: options,
		DBName:  "ai_box",
	}
})

type Options struct {
	*option.Options

	DBName string
}

func WithDBName(dbName string) option.Option {
	return optionWrapper.Wrap(func(o *Options) {
		o.DBName = dbName
	})
}
