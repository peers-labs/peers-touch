package registry

import "time"

// region Options

// Option is a function that can be used to configure a Registry
type Option func(*Options)

type Options struct{}

type RegisterOption func(*RegisterOptions)

type RegisterOptions struct {
	TTL time.Duration
}

type DeregisterOption func(*DeregisterOptions)

type DeregisterOptions struct {
}

// endregion
