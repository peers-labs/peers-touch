package server

type Server interface {
	Init(...Option) error
	Options() Options
	Handle(Handler) error
	NewHandler(interface{}, ...HandlerOption) Handler
	Start() error
	Stop() error
	Name() string
}

type Handler interface {
	Name() string
	Handler() interface{}
	Endpoints() []*registry.Endpoint
	Options() HandlerOptions
}
