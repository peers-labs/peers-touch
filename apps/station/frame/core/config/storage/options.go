package storage

type Options struct {
	Dir string `json:"dir"`
}

type Option func(o *Options)

func Dir(dir string) Option {
	return func(o *Options) {
		o.Dir = dir
	}
}
