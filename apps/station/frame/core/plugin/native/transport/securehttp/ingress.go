package securehttp

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/protocol"
	"golang.org/x/net/http2"
)

const (
	ProtocolID protocol.ID = "/peers-touch/station-http/1.0.0"

	canonicalAttachmentMetadataHeader = "X-Peers-Attachment-Metadata-Bin"

	DefaultHandshakeTimeout     = 10 * time.Second
	DefaultIdleTimeout          = 5 * time.Minute
	DefaultReadIdleTimeout      = 30 * time.Second
	DefaultPingTimeout          = 10 * time.Second
	DefaultMaxHeaderBytes       = 32 << 10
	DefaultConcurrentStreams    = uint32(32)
	defaultBackendHeaderTimeout = 3 * time.Minute
)

type IngressConfig struct {
	BackendURL           *url.URL
	Identity             *NodeTLSIdentity
	HandshakeTimeout     time.Duration
	IdleTimeout          time.Duration
	ReadIdleTimeout      time.Duration
	PingTimeout          time.Duration
	MaxHeaderBytes       int
	MaxConcurrentStreams uint32
}

// Ingress terminates node-key-bound TLS/HTTP2 on a borrowed libp2p Host and
// streams requests into the existing Hertz listener. It never owns or closes
// the Host and it never registers business handlers.
type Ingress struct {
	identity         *NodeTLSIdentity
	tlsConfig        *tls.Config
	http2Server      *http2.Server
	httpServerConfig *http.Server
	handler          http.Handler
	backendTransport *http.Transport
	handshakeTimeout time.Duration

	mu     sync.Mutex
	host   host.Host
	cancel context.CancelFunc
	runCtx context.Context
	active map[network.Stream]struct{}
	closed bool
}

func NewIngress(config IngressConfig) (*Ingress, error) {
	if err := validateLoopbackBackend(config.BackendURL); err != nil {
		return nil, err
	}
	tlsConfig, err := config.Identity.serverTLSConfig()
	if err != nil {
		return nil, err
	}
	handshakeTimeout := durationOrDefault(
		config.HandshakeTimeout,
		DefaultHandshakeTimeout,
	)
	idleTimeout := durationOrDefault(config.IdleTimeout, DefaultIdleTimeout)
	readIdleTimeout := durationOrDefault(
		config.ReadIdleTimeout,
		DefaultReadIdleTimeout,
	)
	pingTimeout := durationOrDefault(config.PingTimeout, DefaultPingTimeout)
	maxHeaderBytes := config.MaxHeaderBytes
	if maxHeaderBytes <= 0 {
		maxHeaderBytes = DefaultMaxHeaderBytes
	}
	maxConcurrentStreams := config.MaxConcurrentStreams
	if maxConcurrentStreams == 0 {
		maxConcurrentStreams = DefaultConcurrentStreams
	}
	backendURL := *config.BackendURL
	proxy, backendTransport := newStreamingLoopbackProxy(&backendURL)
	return &Ingress{
		identity:  config.Identity,
		tlsConfig: tlsConfig,
		http2Server: &http2.Server{
			MaxConcurrentStreams: maxConcurrentStreams,
			IdleTimeout:          idleTimeout,
			ReadIdleTimeout:      readIdleTimeout,
			PingTimeout:          pingTimeout,
			WriteByteTimeout:     pingTimeout,
		},
		httpServerConfig: &http.Server{
			Handler:        proxy,
			MaxHeaderBytes: maxHeaderBytes,
		},
		handler:          proxy,
		backendTransport: backendTransport,
		handshakeTimeout: handshakeTimeout,
		active:           make(map[network.Stream]struct{}),
	}, nil
}

func (i *Ingress) AttachHost(value host.Host) error {
	if i == nil || value == nil {
		return fmt.Errorf("secure HTTP ingress requires a borrowed Host")
	}
	if value.ID() != i.identity.PeerID() {
		return fmt.Errorf(
			"secure HTTP node identity %s does not match Host %s",
			i.identity.PeerID(),
			value.ID(),
		)
	}

	i.mu.Lock()
	defer i.mu.Unlock()
	if i.closed {
		return fmt.Errorf("secure HTTP ingress is closed")
	}
	if i.host != nil {
		return fmt.Errorf("secure HTTP ingress already has a Host")
	}
	i.runCtx, i.cancel = context.WithCancel(context.Background())
	i.host = value
	value.SetStreamHandler(ProtocolID, i.handleStream)
	return nil
}

func (i *Ingress) Start(context.Context) error {
	if i == nil {
		return fmt.Errorf("secure HTTP ingress is not initialized")
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.closed {
		return fmt.Errorf("secure HTTP ingress is closed")
	}
	if i.host == nil {
		return fmt.Errorf("secure HTTP ingress has no borrowed Host")
	}
	return nil
}

func (i *Ingress) Close() error {
	if i == nil {
		return nil
	}
	i.mu.Lock()
	if i.closed {
		i.mu.Unlock()
		return nil
	}
	i.closed = true
	valueHost := i.host
	i.host = nil
	cancel := i.cancel
	i.cancel = nil
	streams := make([]network.Stream, 0, len(i.active))
	for stream := range i.active {
		streams = append(streams, stream)
	}
	i.mu.Unlock()

	if valueHost != nil {
		valueHost.RemoveStreamHandler(ProtocolID)
	}
	if cancel != nil {
		cancel()
	}
	if i.backendTransport != nil {
		i.backendTransport.CloseIdleConnections()
	}
	for _, stream := range streams {
		_ = stream.ResetWithError(network.StreamShutdown)
	}
	return nil
}

func (i *Ingress) handleStream(stream network.Stream) {
	i.mu.Lock()
	if i.closed || i.host == nil || i.runCtx == nil {
		i.mu.Unlock()
		_ = stream.ResetWithError(network.StreamShutdown)
		return
	}
	if stream.Conn().LocalPeer() != i.identity.PeerID() {
		i.mu.Unlock()
		_ = stream.ResetWithError(network.StreamProtocolViolation)
		return
	}
	i.active[stream] = struct{}{}
	runCtx := i.runCtx
	i.mu.Unlock()
	defer func() {
		i.mu.Lock()
		delete(i.active, stream)
		i.mu.Unlock()
	}()

	tlsConnection := tls.Server(
		&streamConn{Stream: stream},
		i.tlsConfig.Clone(),
	)
	_ = tlsConnection.SetDeadline(time.Now().Add(i.handshakeTimeout))
	handshakeCtx, cancel := context.WithTimeout(runCtx, i.handshakeTimeout)
	err := tlsConnection.HandshakeContext(handshakeCtx)
	cancel()
	if err != nil {
		_ = stream.ResetWithError(network.StreamProtocolViolation)
		return
	}
	state := tlsConnection.ConnectionState()
	if state.Version != tls.VersionTLS13 ||
		state.NegotiatedProtocol != http2.NextProtoTLS {
		_ = stream.ResetWithError(network.StreamProtocolViolation)
		return
	}
	_ = tlsConnection.SetDeadline(time.Time{})
	i.http2Server.ServeConn(tlsConnection, &http2.ServeConnOpts{
		Context:    runCtx,
		BaseConfig: i.httpServerConfig,
		Handler:    i.handler,
	})
	_ = tlsConnection.Close()
}

func newStreamingLoopbackProxy(
	target *url.URL,
) (*httputil.ReverseProxy, *http.Transport) {
	backendTransport := &http.Transport{
		Proxy:                 nil,
		DialContext:           (&net.Dialer{}).DialContext,
		ForceAttemptHTTP2:     false,
		DisableCompression:    true,
		MaxIdleConns:          32,
		MaxIdleConnsPerHost:   32,
		IdleConnTimeout:       DefaultIdleTimeout,
		ResponseHeaderTimeout: defaultBackendHeaderTimeout,
	}
	return &httputil.ReverseProxy{
		Rewrite: func(request *httputil.ProxyRequest) {
			request.SetURL(target)
			request.Out.Host = request.In.Host
			stripUntrustedPeerHeaders(request.Out.Header)
		},
		Transport:     backendTransport,
		FlushInterval: -1,
		ErrorHandler: func(
			writer http.ResponseWriter,
			_ *http.Request,
			_ error,
		) {
			http.Error(
				writer,
				http.StatusText(http.StatusBadGateway),
				http.StatusBadGateway,
			)
		},
	}, backendTransport
}

func stripUntrustedPeerHeaders(headers http.Header) {
	for name := range headers {
		canonical := http.CanonicalHeaderKey(name)
		if canonical == canonicalAttachmentMetadataHeader {
			continue
		}
		if canonical == "Forwarded" ||
			canonical == "Via" ||
			canonical == "X-Real-Ip" ||
			strings.HasPrefix(canonical, "X-Forwarded-") ||
			strings.HasPrefix(canonical, "X-Peers-") ||
			strings.HasPrefix(canonical, "X-Libp2p-") ||
			strings.HasPrefix(canonical, "X-P2p-") {
			headers.Del(name)
		}
	}
}

func validateLoopbackBackend(target *url.URL) error {
	if target == nil {
		return fmt.Errorf("secure HTTP ingress requires a loopback backend")
	}
	if target.Scheme != "http" ||
		target.User != nil ||
		target.RawQuery != "" ||
		target.Fragment != "" ||
		(target.Path != "" && target.Path != "/") {
		return fmt.Errorf("secure HTTP backend must be an HTTP loopback origin")
	}
	hostname := target.Hostname()
	ip := net.ParseIP(hostname)
	if ip == nil || !ip.IsLoopback() || target.Port() == "" {
		return fmt.Errorf("secure HTTP backend must use a loopback IP and port")
	}
	return nil
}

func durationOrDefault(value time.Duration, fallback time.Duration) time.Duration {
	if value <= 0 {
		return fallback
	}
	return value
}
