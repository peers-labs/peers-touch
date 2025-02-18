package server

// region server options

// Option is a function that can be used to configure a server
type Option func(*Options)

// Options is the server options
type Options struct {
	Address string // Server address
	Timeout int    // Server timeout
}

// WithAddress sets the server address
func WithAddress(address string) Option {
	return func(o *Options) {
		o.Address = address
	}
}

// WithTimeout sets the server timeout
func WithTimeout(timeout int) Option {
	return func(o *Options) {
		o.Timeout = timeout
	}
}

// endregion
