package codec

import (
	"errors"
	"io"
)

var (
	ErrInvalidMessage = errors.New("invalid message")
)

type CodecContentType string

var (
	// supported

	CodecContentTypeJSON     CodecContentType = "application/json"
	CodecContentTypeProtobuf CodecContentType = "application/protobuf"

	// unsupported

	CodecContentTypeJSONRPC     CodecContentType = "application/json-rpc"
	CodecContentTypeOctetStream CodecContentType = "application/octet-stream"
)

var (
	// Codecs maps CodecContentType to Codec
	// one CodecContentType can only map to one Codec.
	// multiple CodecContentTypes can map to the same Codec.
	Codecs = make(map[CodecContentType]NewCodec)
)

type NewCodec func(io.ReadWriteCloser) Codec

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
