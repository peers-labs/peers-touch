package launcher

import "github.com/peers-labs/peers-touch/station/frame/core/option"

type launcherOptions struct {
	DBName string
}

var launcherWrapper = option.NewWrapper("launcher", func(o *option.Options) *launcherOptions {
	return &launcherOptions{}
})

func WithDBName(name string) option.Option {
	return launcherWrapper.Wrap(func(o *launcherOptions) {
		o.DBName = name
	})
}

func getOptions(opts ...option.Option) *launcherOptions {
	o := option.GetOptions(opts...)
	if o.Ctx().Value("launcher") == nil {
		return &launcherOptions{}
	}
	return o.Ctx().Value("launcher").(*launcherOptions)
}
