package relayclient

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	federationcore "github.com/peers-labs/peers-touch/station/frame/core/federation"
	federationmodel "github.com/peers-labs/peers-touch/station/frame/core/federation/model"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/protocol"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

const (
	outerTunnelProtocolVersion = uint32(1)
	outerTunnelSubprotocol     = "peers-touch.tunnel.v1"
	outerTunnelHandshake       = 10 * time.Second
	maxOuterTunnelFrameBytes   = protocol.MaxTunnelDataLen + 1024
)

var errPeerTunnelOversize = errors.New("Relay peer tunnel byte limit exceeded")

func (f federationHandle) RoundTrip(
	ctx context.Context,
	targetStationPeerID string,
	request *http.Request,
) (*http.Response, error) {
	if f.sub == nil {
		return nil, nativefed.ErrRelayNotConnected
	}
	return f.sub.roundTripPeer(ctx, targetStationPeerID, request)
}

func (s *SubServer) roundTripPeer(
	ctx context.Context,
	targetStationPeerID string,
	request *http.Request,
) (*http.Response, error) {
	if request == nil || strings.TrimSpace(targetStationPeerID) == "" {
		return nil, errors.New("Relay peer tunnel request is invalid")
	}
	credential, ok := s.getCredential()
	if !ok || credential.Token == "" || credential.RelayPeerID == "" {
		return nil, nativefed.ErrRelayNotConnected
	}
	endpoint, err := relayTunnelURL(s.opts.RelayURL)
	if err != nil {
		return nil, err
	}
	header := http.Header{
		"Authorization": []string{"Bearer " + credential.Token},
	}
	dialer := websocket.Dialer{
		HandshakeTimeout:  outerTunnelHandshake,
		Subprotocols:      []string{outerTunnelSubprotocol},
		EnableCompression: false,
		TLSClientConfig: &tls.Config{
			MinVersion:         tls.VersionTLS13,
			InsecureSkipVerify: s.opts.TLSInsecureSkipVerify,
		},
	}
	socket, response, err := dialer.DialContext(ctx, endpoint, header)
	if err != nil {
		if response != nil {
			_ = response.Body.Close()
		}
		return nil, fmt.Errorf("open Relay WebSocket: %w", err)
	}
	if socket.Subprotocol() != outerTunnelSubprotocol {
		_ = socket.Close()
		return nil, errors.New("Relay WebSocket subprotocol downgrade")
	}

	nonce := make([]byte, 32)
	if _, err := rand.Read(nonce); err != nil {
		_ = socket.Close()
		return nil, fmt.Errorf("generate tunnel nonce: %w", err)
	}
	if err := writeClientOuterFrame(socket, &federationmodel.RelayTunnelFrame{
		ProtocolVersion: outerTunnelProtocolVersion,
		Payload: &federationmodel.RelayTunnelFrame_Open{
			Open: &federationmodel.RelayTunnelOpen{
				ClientNonce:         nonce,
				TargetStationPeerId: targetStationPeerID,
				Purpose:             federationmodel.RelayTunnelPurpose_RELAY_TUNNEL_PURPOSE_FEDERATION_PEER,
			},
		},
	}); err != nil {
		_ = socket.Close()
		return nil, err
	}
	_ = socket.SetReadDeadline(time.Now().Add(outerTunnelHandshake))
	openedFrame, err := readClientOuterFrame(socket)
	if err != nil || openedFrame.GetOpened() == nil {
		_ = socket.Close()
		return nil, errors.New("Relay did not open peer tunnel")
	}
	opened := openedFrame.GetOpened()
	if opened.GetTunnelId() == 0 ||
		opened.GetLimits() == nil ||
		len(opened.GetRelayNonce()) != 32 {
		_ = socket.Close()
		return nil, errors.New("Relay returned invalid tunnel limits")
	}
	attestation := &peerpb.StationRouteAttestation{}
	if err := proto.Unmarshal(opened.GetRouteAttestation(), attestation); err != nil {
		_ = socket.Close()
		return nil, errors.New("Relay returned invalid route attestation")
	}
	statement, err := domain.VerifyStationRouteAttestation(
		attestation,
		credential.RelayPeerID,
		time.Now().UTC(),
	)
	if err != nil ||
		statement.GetStationPeerId() != targetStationPeerID ||
		!bytes.Equal(
			statement.GetCapabilitiesDigest(),
			federationcore.PeerCapabilityManifestDigest(),
		) {
		_ = socket.Close()
		return nil, errors.New("peer tunnel route attestation verification failed")
	}

	rawTunnel := newWebSocketTunnelConn(socket, opened.GetTunnelId(), opened.GetLimits())
	innerTLS := tls.Client(rawTunnel, &tls.Config{
		MinVersion:         tls.VersionTLS13,
		MaxVersion:         tls.VersionTLS13,
		InsecureSkipVerify: true,
		NextProtos:         []string{"http/1.1"},
		VerifyConnection: func(state tls.ConnectionState) error {
			return verifyPinnedSPKI(
				state,
				statement.GetInnerTlsSpkiSha256(),
			)
		},
	})
	_ = innerTLS.SetDeadline(time.Now().Add(outerTunnelHandshake))
	if err := innerTLS.HandshakeContext(ctx); err != nil {
		_ = innerTLS.Close()
		return nil, fmt.Errorf("inner TLS handshake: %w", err)
	}
	_ = innerTLS.SetDeadline(time.Time{})

	var dialed atomic.Bool
	transport := &http.Transport{
		DisableKeepAlives: true,
		ForceAttemptHTTP2: false,
		DialContext: func(
			context.Context,
			string,
			string,
		) (net.Conn, error) {
			if dialed.Swap(true) {
				return nil, errors.New("peer tunnel supports one HTTP connection")
			}
			return innerTLS, nil
		},
	}
	outbound := request.Clone(ctx)
	outbound.URL = cloneURL(request.URL)
	outbound.URL.Scheme = "http"
	outbound.URL.Host = targetStationPeerID + ".station.invalid"
	outbound.RequestURI = ""
	response, err = transport.RoundTrip(outbound)
	if err != nil {
		transport.CloseIdleConnections()
		_ = innerTLS.Close()
		return nil, err
	}
	response.Body = &tunnelResponseBody{
		ReadCloser: response.Body,
		close: func() {
			transport.CloseIdleConnections()
			_ = innerTLS.Close()
		},
	}
	return response, nil
}

func relayTunnelURL(base string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(base))
	if err != nil || parsed.Host == "" || parsed.RawQuery != "" ||
		parsed.Fragment != "" {
		return "", errors.New("Relay origin is invalid")
	}
	switch strings.ToLower(parsed.Scheme) {
	case "https":
		parsed.Scheme = "wss"
	case "http":
		if host := net.ParseIP(parsed.Hostname()); host == nil ||
			!host.IsLoopback() {
			return "", errors.New("plaintext Relay tunnel is not loopback")
		}
		parsed.Scheme = "ws"
	default:
		return "", errors.New("Relay origin scheme is invalid")
	}
	parsed.Path = "/.well-known/peers-touch/tunnel"
	return parsed.String(), nil
}

func verifyPinnedSPKI(
	state tls.ConnectionState,
	expected []byte,
) error {
	if state.Version != tls.VersionTLS13 ||
		len(state.PeerCertificates) != 1 ||
		len(expected) != sha256.Size {
		return errors.New("inner TLS identity is invalid")
	}
	spki, err := x509.MarshalPKIXPublicKey(
		state.PeerCertificates[0].PublicKey,
	)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(spki)
	if !bytes.Equal(digest[:], expected) {
		return errors.New("inner TLS SPKI mismatch")
	}
	return nil
}

func cloneURL(input *url.URL) *url.URL {
	if input == nil {
		return &url.URL{Path: "/"}
	}
	copy := *input
	return &copy
}

type tunnelResponseBody struct {
	io.ReadCloser
	once  sync.Once
	close func()
}

func (b *tunnelResponseBody) Close() error {
	err := b.ReadCloser.Close()
	b.once.Do(b.close)
	return err
}

type webSocketTunnelConn struct {
	socket   *websocket.Conn
	tunnelID uint64
	limits   *federationmodel.RelayTunnelLimits

	readMu     sync.Mutex
	writeMu    sync.Mutex
	readBuffer []byte
	nextRead   uint64
	nextWrite  uint64
	readBytes  uint64
	writeBytes uint64
	closed     atomic.Bool
}

func newWebSocketTunnelConn(
	socket *websocket.Conn,
	tunnelID uint64,
	limits *federationmodel.RelayTunnelLimits,
) *webSocketTunnelConn {
	return &webSocketTunnelConn{
		socket:    socket,
		tunnelID:  tunnelID,
		limits:    limits,
		nextRead:  1,
		nextWrite: 1,
	}
}

func (c *webSocketTunnelConn) Read(buffer []byte) (int, error) {
	c.readMu.Lock()
	defer c.readMu.Unlock()
	for len(c.readBuffer) == 0 {
		frame, err := readClientOuterFrame(c.socket)
		if err != nil {
			return 0, err
		}
		if data := frame.GetData(); data != nil {
			if data.GetTunnelId() != c.tunnelID ||
				data.GetSequence() != c.nextRead ||
				len(data.GetCiphertext()) == 0 ||
				uint64(len(data.GetCiphertext())) > c.limits.GetMaxFrameBytes() {
				return 0, errors.New("invalid Relay tunnel data")
			}
			c.readBytes += uint64(len(data.GetCiphertext()))
			if c.readBytes > c.limits.GetMaxResponseBytes() ||
				c.readBytes+c.writeBytes > c.limits.GetMaxConnectionBytes() {
				return 0, errPeerTunnelOversize
			}
			c.nextRead++
			c.readBuffer = append([]byte(nil), data.GetCiphertext()...)
			continue
		}
		if closeFrame := frame.GetClose(); closeFrame != nil {
			if closeFrame.GetTunnelId() != c.tunnelID {
				return 0, errors.New("mismatched Relay tunnel close")
			}
			return 0, io.EOF
		}
		return 0, errors.New("unexpected Relay tunnel frame")
	}
	n := copy(buffer, c.readBuffer)
	c.readBuffer = c.readBuffer[n:]
	return n, nil
}

func (c *webSocketTunnelConn) Write(data []byte) (int, error) {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if c.closed.Load() {
		return 0, net.ErrClosed
	}
	written := 0
	for len(data) > 0 {
		size := min(len(data), int(c.limits.GetMaxFrameBytes()))
		if size <= 0 {
			return written, errPeerTunnelOversize
		}
		chunk := data[:size]
		c.writeBytes += uint64(len(chunk))
		if c.writeBytes > c.limits.GetMaxRequestBytes() ||
			c.readBytes+c.writeBytes > c.limits.GetMaxConnectionBytes() {
			return written, errPeerTunnelOversize
		}
		if err := writeClientOuterFrame(
			c.socket,
			&federationmodel.RelayTunnelFrame{
				ProtocolVersion: outerTunnelProtocolVersion,
				Payload: &federationmodel.RelayTunnelFrame_Data{
					Data: &federationmodel.RelayTunnelData{
						TunnelId:   c.tunnelID,
						Sequence:   c.nextWrite,
						Ciphertext: chunk,
					},
				},
			},
		); err != nil {
			return written, err
		}
		c.nextWrite++
		written += len(chunk)
		data = data[size:]
	}
	return written, nil
}

func (c *webSocketTunnelConn) Close() error {
	if c.closed.Swap(true) {
		return nil
	}
	c.writeMu.Lock()
	_ = writeClientOuterFrame(c.socket, &federationmodel.RelayTunnelFrame{
		ProtocolVersion: outerTunnelProtocolVersion,
		Payload: &federationmodel.RelayTunnelFrame_Cancel{
			Cancel: &federationmodel.RelayTunnelCancel{
				TunnelId: c.tunnelID,
				Reason:   federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_CANCELLED,
			},
		},
	})
	c.writeMu.Unlock()
	return c.socket.Close()
}

func (c *webSocketTunnelConn) LocalAddr() net.Addr {
	return c.socket.LocalAddr()
}

func (c *webSocketTunnelConn) RemoteAddr() net.Addr {
	return c.socket.RemoteAddr()
}

func (c *webSocketTunnelConn) SetDeadline(deadline time.Time) error {
	if err := c.socket.SetReadDeadline(deadline); err != nil {
		return err
	}
	return c.socket.SetWriteDeadline(deadline)
}

func (c *webSocketTunnelConn) SetReadDeadline(deadline time.Time) error {
	return c.socket.SetReadDeadline(deadline)
}

func (c *webSocketTunnelConn) SetWriteDeadline(deadline time.Time) error {
	return c.socket.SetWriteDeadline(deadline)
}

func readClientOuterFrame(
	socket *websocket.Conn,
) (*federationmodel.RelayTunnelFrame, error) {
	messageType, payload, err := socket.ReadMessage()
	if err != nil {
		return nil, err
	}
	if messageType != websocket.BinaryMessage ||
		len(payload) == 0 ||
		len(payload) > maxOuterTunnelFrameBytes {
		return nil, errors.New("Relay tunnel requires bounded binary frames")
	}
	frame := &federationmodel.RelayTunnelFrame{}
	if err := proto.Unmarshal(payload, frame); err != nil ||
		frame.GetProtocolVersion() != outerTunnelProtocolVersion ||
		len(frame.ProtoReflect().GetUnknown()) != 0 {
		return nil, errors.New("invalid Relay tunnel frame")
	}
	return frame, nil
}

func writeClientOuterFrame(
	socket *websocket.Conn,
	frame *federationmodel.RelayTunnelFrame,
) error {
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(frame)
	if err != nil {
		return err
	}
	if len(payload) > maxOuterTunnelFrameBytes {
		return errPeerTunnelOversize
	}
	return socket.WriteMessage(websocket.BinaryMessage, payload)
}
