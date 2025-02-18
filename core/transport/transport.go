package transport

// Transport is an interface used for peers to communicate.
type Transport interface {
	Init(...Option) error
	Options() Options
	Connect(addr string, opts ...DialOption) (Conn, error)
	Disconnect() error
	Listen(addr string, opts ...ListenOption) (Listener, error)
	String() string
}

type Conn interface{}

type Listener interface{}

type Message struct {
	Header map[string]string
	Body   []byte
}

type Socket interface {
	Recv(*Message) error
	Send(*Message) error
	Close() error
	Local() string
	Remote() string
}
