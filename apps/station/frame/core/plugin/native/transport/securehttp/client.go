package securehttp

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"golang.org/x/net/http2"
)

type ClientConfig struct {
	Host             host.Host
	TargetPeerID     peer.ID
	ExpectedSPKI     [sha256.Size]byte
	HandshakeTimeout time.Duration
	ReadIdleTimeout  time.Duration
	PingTimeout      time.Duration
	MaxHeaderBytes   uint32
}

// Client is an HTTP/2 transport bound to one verified Station node route. It
// borrows its Host and leaves route selection and Host lifecycle to its owner.
type Client struct {
	host             host.Host
	targetPeerID     peer.ID
	tlsConfig        *tls.Config
	handshakeTimeout time.Duration
	transport        *http2.Transport
}

func NewClient(config ClientConfig) (*Client, error) {
	if config.Host == nil || config.TargetPeerID == "" {
		return nil, fmt.Errorf("secure HTTP client requires Host and target PeerID")
	}
	tlsConfig, err := pinnedClientTLSConfig(
		config.TargetPeerID,
		config.ExpectedSPKI,
	)
	if err != nil {
		return nil, err
	}
	handshakeTimeout := durationOrDefault(
		config.HandshakeTimeout,
		DefaultHandshakeTimeout,
	)
	readIdleTimeout := durationOrDefault(
		config.ReadIdleTimeout,
		DefaultReadIdleTimeout,
	)
	pingTimeout := durationOrDefault(config.PingTimeout, DefaultPingTimeout)
	maxHeaderBytes := config.MaxHeaderBytes
	if maxHeaderBytes == 0 {
		maxHeaderBytes = DefaultMaxHeaderBytes
	}
	client := &Client{
		host:             config.Host,
		targetPeerID:     config.TargetPeerID,
		tlsConfig:        tlsConfig,
		handshakeTimeout: handshakeTimeout,
	}
	client.transport = &http2.Transport{
		AllowHTTP:                  true,
		DisableCompression:         true,
		MaxHeaderListSize:          maxHeaderBytes,
		StrictMaxConcurrentStreams: true,
		IdleConnTimeout:            DefaultIdleTimeout,
		ReadIdleTimeout:            readIdleTimeout,
		PingTimeout:                pingTimeout,
		WriteByteTimeout:           pingTimeout,
		TLSClientConfig:            tlsConfig,
		DialTLSContext:             client.dialTLS,
	}
	return client, nil
}

func (c *Client) RoundTrip(request *http.Request) (*http.Response, error) {
	if c == nil || c.transport == nil {
		return nil, fmt.Errorf("secure HTTP client is not initialized")
	}
	return c.transport.RoundTrip(request)
}

func (c *Client) CloseIdleConnections() {
	if c != nil && c.transport != nil {
		c.transport.CloseIdleConnections()
	}
}

func (c *Client) dialTLS(
	ctx context.Context,
	_ string,
	_ string,
	_ *tls.Config,
) (net.Conn, error) {
	stream, err := c.host.NewStream(
		network.WithAllowLimitedConn(ctx, "station-http"),
		c.targetPeerID,
		ProtocolID,
	)
	if err != nil {
		return nil, fmt.Errorf(
			"open secure HTTP stream to %s: %w",
			c.targetPeerID,
			err,
		)
	}
	if stream.Conn().RemotePeer() != c.targetPeerID {
		_ = stream.Reset()
		return nil, fmt.Errorf("secure HTTP stream reached an unexpected PeerID")
	}
	tlsConnection := tls.Client(
		&streamConn{Stream: stream},
		c.tlsConfig.Clone(),
	)
	deadline := time.Now().Add(c.handshakeTimeout)
	if contextDeadline, ok := ctx.Deadline(); ok &&
		contextDeadline.Before(deadline) {
		deadline = contextDeadline
	}
	_ = tlsConnection.SetDeadline(deadline)
	if err := tlsConnection.HandshakeContext(ctx); err != nil {
		_ = stream.Reset()
		return nil, fmt.Errorf("authenticate secure HTTP node: %w", err)
	}
	_ = tlsConnection.SetDeadline(time.Time{})
	return tlsConnection, nil
}

var _ http.RoundTripper = (*Client)(nil)
