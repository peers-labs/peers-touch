package client

// region Options

// Option is a function that can be used to configure a Client
type Option func(*Options)

type Options struct {
}

// endregion

// region CallOptions

// CallOption is a function that can be used to configure a CallOptions
type CallOption func(*CallOptions)

type CallOptions struct{}

// endregion
