package transport

import (
	"context"
	"crypto/tls"
	"time"

	"github.com/peers-touch/peers-touch/station/frame/core/codec"
	"github.com/peers-touch/peers-touch/station/frame/core/logger"
	"github.com/peers-touch/peers-touch/station/frame/core/option"
)

type Options struct {
	*option.Options

	// Codec is the codec interface to use where headers are not supported
	// by the transport and the entire payload must be encoded
	Codec codec.Marshaler
	// Other options for implementations of the interface
	// can be stored in a context
	Context context.Context
	// Logger is the underline logger
	Logger logger.Logger
	// TLSConfig to secure the connection. The assumption is that this
	// is mTLS keypair
	TLSConfig *tls.Config
	// Addrs is the list of intermediary addresses to connect to
	Addrs []string
	// Timeout sets the timeout for Send/Recv
	Timeout time.Duration
	// BuffSizeH2 is the HTTP2 buffer size
	BuffSizeH2 int
	// Secure tells the transport to secure the connection.
	// In the case TLSConfig is not specified best effort self-signed
	// certs should be used
	Secure bool
}

type DialOptions struct {
	Context context.Context
	Timeout time.Duration
}

type ListenOptions struct{}

type ListenOption func(l *Listener)

type DialOption func(*DialOptions)
