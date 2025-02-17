package codec

type MessageType int

type Message struct {
	Header   map[string]string
	Id       string
	Target   string
	Method   string
	Endpoint string
	Error    string

	Body []byte
	Type MessageType
}

type Reader interface {
	ReadHeader(*Message, MessageType) error
	ReadBody(interface{}) error
}

type Writer interface {
	Write(*Message, interface{}) error
}

type Codec interface {
	Reader
	Writer
	Close() error
	String() string
}
