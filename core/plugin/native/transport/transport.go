package native

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/protocol"
	"github.com/libp2p/go-libp2p/p2p/host/autorelay"
	"github.com/multiformats/go-multiaddr"
	"github.com/peers-touch/peers-touch-go/core/option"
	"github.com/peers-touch/peers-touch-go/core/transport"
)

const (
	DefaultProtocolID = "/peers-touch/transport/1.0.0"
)

var (
	_ transport.Transport = &libp2pTransport{}
	_ transport.Client    = &libp2pClient{}
	_ transport.Listener  = &libp2pListener{}
	_ transport.Socket    = &libp2pSocket{}
)

type libp2pTransport struct {
	host        host.Host
	opts        transport.Options
	protocolID  protocol.ID
	initialized bool
}

type libp2pSocket struct {
	stream network.Stream
	local  string
	remote string
}

type libp2pListener struct {
	host       host.Host
	protocolID protocol.ID
	addr       string
	closed     chan struct{}
}

type libp2pClient struct {
	host       host.Host
	protocolID protocol.ID
	remotePeer peer.ID
	remoteAddr multiaddr.Multiaddr
	stream     network.Stream
}

// NewTransport creates a new libp2p transport
func NewTransport(opts ...option.Option) transport.Transport {
	t := &libp2pTransport{
		protocolID:  DefaultProtocolID,
		initialized: false,
	}

	for _, o := range opts {
		t.opts.Apply(o)
	}

	return t
}

func (t *libp2pTransport) Init(opts ...option.Option) error {
	for _, o := range opts {
		t.opts.Apply(o)
	}

	// Create libp2p host with proper configuration
	libp2pOpts := []libp2p.Option{
		libp2p.EnableNATService(),
		libp2p.EnableHolePunching(),
	}

	// Add relay configuration (EnableAutoRelay is deprecated)
	libp2pOpts = append(libp2pOpts, libp2p.EnableAutoRelay(
		autorelay.WithStaticRelays(nil), // You can provide static relays here
	))

	// Convert string addresses to multiaddr.Multiaddr
	if len(t.opts.Addrs) > 0 {
		var listenAddrs []multiaddr.Multiaddr
		for _, addr := range t.opts.Addrs {
			maddr, err := multiaddr.NewMultiaddr(addr)
			if err != nil {
				return fmt.Errorf("invalid listen address %s: %w", addr, err)
			}
			listenAddrs = append(listenAddrs, maddr)
		}
		libp2pOpts = append(libp2pOpts, libp2p.ListenAddrs(listenAddrs...))
	}

	// Add security options - fix security configuration
	if t.opts.Secure {
		// Use default security (no need to specify as string)
		libp2pOpts = append(libp2pOpts, libp2p.DefaultSecurity)
	} else {
		// Insecure security for testing
		libp2pOpts = append(libp2pOpts, libp2p.NoSecurity)
	}

	// Enable ping node for connectivity checking
	libp2pOpts = append(libp2pOpts, libp2p.Ping(true))

	// Create the host
	h, err := libp2p.New(libp2pOpts...)
	if err != nil {
		return fmt.Errorf("failed to create libp2p host: %w", err)
	}

	t.host = h
	t.initialized = true
	return nil
}

func (t *libp2pTransport) Options() transport.Options {
	return t.opts
}

func (t *libp2pTransport) Dial(addr string, opts ...transport.DialOption) (transport.Client, error) {
	if !t.initialized || t.host == nil {
		return nil, fmt.Errorf("transport not initialized")
	}

	// Parse multiaddr
	maddr, err := multiaddr.NewMultiaddr(addr)
	if err != nil {
		return nil, fmt.Errorf("invalid multiaddr: %w", err)
	}

	// Extract peer ID
	peerID, err := peer.IDFromP2PAddr(maddr)
	if err != nil {
		return nil, fmt.Errorf("invalid peer ID: %w", err)
	}

	// Apply dial options
	dialOpts := &transport.DialOptions{}
	for _, o := range opts {
		o(dialOpts)
	}

	// Determine timeout (default to 30 seconds if not specified)
	timeout := dialOpts.Timeout
	if timeout == 0 {
		timeout = 30 * time.Second
	}

	// Create context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	// Connect to peer
	addrInfo := peer.AddrInfo{
		ID:    peerID,
		Addrs: []multiaddr.Multiaddr{maddr},
	}

	if err := t.host.Connect(ctx, addrInfo); err != nil {
		return nil, fmt.Errorf("failed to connect to peer: %w", err)
	}

	// Open stream
	stream, err := t.host.NewStream(ctx, peerID, t.protocolID)
	if err != nil {
		return nil, fmt.Errorf("failed to open stream: %w", err)
	}

	return &libp2pClient{
		host:       t.host,
		protocolID: t.protocolID,
		remotePeer: peerID,
		remoteAddr: maddr,
		stream:     stream,
	}, nil
}

func (t *libp2pTransport) Listen(addr string, opts ...transport.ListenOption) (transport.Listener, error) {
	if !t.initialized || t.host == nil {
		return nil, fmt.Errorf("transport not initialized")
	}

	// Parse multiaddr for listening
	maddr, err := multiaddr.NewMultiaddr(addr)
	if err != nil {
		return nil, fmt.Errorf("invalid multiaddr: %w", err)
	}

	// Ensure the host is listening on this address
	found := false
	for _, laddr := range t.host.Addrs() {
		if laddr.Equal(maddr) {
			found = true
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("host not listening on address: %s", addr)
	}

	return &libp2pListener{
		host:       t.host,
		protocolID: t.protocolID,
		addr:       addr,
		closed:     make(chan struct{}),
	}, nil
}

func (t *libp2pTransport) Close() error {
	if t.host != nil {
		return t.host.Close()
	}
	return nil
}

func (t *libp2pTransport) String() string {
	return "libp2p"
}

func (c *libp2pClient) Recv(msg *transport.Message) error {
	if c.stream == nil {
		return fmt.Errorf("stream closed")
	}

	return readMessage(c.stream, msg)
}

func (c *libp2pClient) Send(msg *transport.Message) error {
	if c.stream == nil {
		return fmt.Errorf("stream closed")
	}

	return writeMessage(c.stream, msg)
}

func (c *libp2pClient) Close() error {
	if c.stream != nil {
		return c.stream.Close()
	}
	return nil
}

func (c *libp2pClient) Local() string {
	return c.host.ID().String()
}

func (c *libp2pClient) Remote() string {
	return c.remotePeer.String()
}

func (l *libp2pListener) Addr() string {
	return l.addr
}

func (l *libp2pListener) Close() error {
	// Remove stream handler and signal closure
	l.host.RemoveStreamHandler(l.protocolID)
	if l.closed != nil {
		close(l.closed)
	}
	return nil
}

func (l *libp2pListener) Accept(fn func(transport.Socket)) error {
	// Set the actual stream handler
	l.host.SetStreamHandler(l.protocolID, func(stream network.Stream) {
		socket := &libp2pSocket{
			stream: stream,
			local:  stream.Conn().LocalMultiaddr().String(),
			remote: stream.Conn().RemoteMultiaddr().String(),
		}
		fn(socket)
	})

	// Keep the listener running
	<-l.closed
	return nil
}

func (s *libp2pSocket) Recv(msg *transport.Message) error {
	return readMessage(s.stream, msg)
}

func (s *libp2pSocket) Send(msg *transport.Message) error {
	return writeMessage(s.stream, msg)
}

func (s *libp2pSocket) Close() error {
	return s.stream.Close()
}

func (s *libp2pSocket) Local() string {
	return s.local
}

func (s *libp2pSocket) Remote() string {
	return s.remote
}

// Helper functions for message serialization
func readMessage(stream io.Reader, msg *transport.Message) error {
	// Read header length
	var headerLen uint32
	if err := readUint32(stream, &headerLen); err != nil {
		return fmt.Errorf("failed to read header length: %w", err)
	}

	// Read header
	headerBuf := make([]byte, headerLen)
	if _, err := io.ReadFull(stream, headerBuf); err != nil {
		return fmt.Errorf("failed to read header: %w", err)
	}

	// Parse header
	msg.Header = make(map[string]string)
	if err := json.Unmarshal(headerBuf, &msg.Header); err != nil {
		return fmt.Errorf("failed to parse header: %w", err)
	}

	// Read body length
	var bodyLen uint32
	if err := readUint32(stream, &bodyLen); err != nil {
		return fmt.Errorf("failed to read body length: %w", err)
	}

	// Read body
	if bodyLen > 0 {
		msg.Body = make([]byte, bodyLen)
		if _, err := io.ReadFull(stream, msg.Body); err != nil {
			return fmt.Errorf("failed to read body: %w", err)
		}
	} else {
		msg.Body = []byte{}
	}

	return nil
}

func writeMessage(stream io.Writer, msg *transport.Message) error {
	// Serialize header
	headerBuf, err := json.Marshal(msg.Header)
	if err != nil {
		return fmt.Errorf("failed to serialize header: %w", err)
	}

	// Write header length
	if err := writeUint32(stream, uint32(len(headerBuf))); err != nil {
		return fmt.Errorf("failed to write header length: %w", err)
	}

	// Write header
	if _, err := stream.Write(headerBuf); err != nil {
		return fmt.Errorf("failed to write header: %w", err)
	}

	// Write body length
	if err := writeUint32(stream, uint32(len(msg.Body))); err != nil {
		return fmt.Errorf("failed to write body length: %w", err)
	}

	// Write body
	if len(msg.Body) > 0 {
		if _, err := stream.Write(msg.Body); err != nil {
			return fmt.Errorf("failed to write body: %w", err)
		}
	}

	return nil
}

func readUint32(r io.Reader, v *uint32) error {
	var buf [4]byte
	if _, err := io.ReadFull(r, buf[:]); err != nil {
		return err
	}
	*v = uint32(buf[0])<<24 | uint32(buf[1])<<16 | uint32(buf[2])<<8 | uint32(buf[3])
	return nil
}

func writeUint32(w io.Writer, v uint32) error {
	var buf [4]byte
	buf[0] = byte(v >> 24)
	buf[1] = byte(v >> 16)
	buf[2] = byte(v >> 8)
	buf[3] = byte(v)
	_, err := w.Write(buf[:])
	return err
}
