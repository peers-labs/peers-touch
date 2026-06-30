package agent

import "github.com/peers-labs/peers-touch/station/frame/core/option"

type serverOptionsKey struct{}

var optionWrapper = option.NewWrapper[Options](serverOptionsKey{}, func(options *option.Options) *Options {
	return &Options{
		Options: options,
		DBName:  "agent",
		Path:    "/sub-agent",
	}
})

type Options struct {
	*option.Options

	DBName string
	Path   string
}

func WithDBName(dbName string) option.Option {
	return optionWrapper.Wrap(func(o *Options) {
		o.DBName = dbName
	})
}

func WithPath(path string) option.Option {
	return optionWrapper.Wrap(func(o *Options) {
		if path != "" {
			o.Path = path
		}
	})
}
