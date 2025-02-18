package transport

type Options interface{}

type DialOptions struct{}

type ListenOptions struct{}

type Option func(*Options)

type ListenOption func(l *Listener)

type DialOption func(...DialOption)
