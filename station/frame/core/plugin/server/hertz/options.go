package hertz

func WithLogger(l log.Logger) option.Option {
	return func(o *option.Options) {
		o.AppendCtx(loggerKey{}, l)
	}
}
