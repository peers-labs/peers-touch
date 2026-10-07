package relay

import (
	"errors"
	"io"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
)

func TestTunnelWebSocketUpgradeRejectsDowngradeAndCompression(t *testing.T) {
	newRequest := func() *app.RequestContext {
		request := app.NewContext(0)
		request.Request.Header.SetMethod(http.MethodGet)
		request.Request.Header.Set("Connection", "Upgrade")
		request.Request.Header.Set("Upgrade", "websocket")
		request.Request.Header.Set("Sec-WebSocket-Version", "13")
		request.Request.Header.Set("Host", "relay.example")
		return request
	}

	missingProtocol := newRequest()
	if err := upgradeTunnelWebSocket(
		missingProtocol,
		func(*serverWebSocket) {},
	); err == nil || missingProtocol.Response.StatusCode() != http.StatusBadRequest {
		t.Fatal("missing tunnel subprotocol was accepted")
	}

	compressed := newRequest()
	compressed.Request.Header.Set(
		"Sec-WebSocket-Protocol",
		tunnelWebSocketProtocol,
	)
	compressed.Request.Header.Set(
		"Sec-WebSocket-Extensions",
		"permessage-deflate",
	)
	if err := upgradeTunnelWebSocket(
		compressed,
		func(*serverWebSocket) {},
	); err == nil || compressed.Response.StatusCode() != http.StatusBadRequest {
		t.Fatal("WebSocket compression was accepted")
	}

	crossOrigin := newRequest()
	crossOrigin.Request.Header.Set(
		"Sec-WebSocket-Protocol",
		tunnelWebSocketProtocol,
	)
	crossOrigin.Request.Header.Set("Origin", "https://attacker.example")
	if err := upgradeTunnelWebSocket(
		crossOrigin,
		func(*serverWebSocket) {},
	); err == nil || crossOrigin.Response.StatusCode() != http.StatusForbidden {
		t.Fatal("cross-origin WebSocket request was accepted")
	}
}

func TestServerWebSocketAcceptsOnlyFinalMaskedBinaryFrames(t *testing.T) {
	t.Run("binary", func(t *testing.T) {
		serverConn, clientConn := net.Pipe()
		defer serverConn.Close()
		defer clientConn.Close()
		socket := &serverWebSocket{
			conn:      serverConn,
			readLimit: 1024,
		}
		writeDone := make(chan error, 1)
		go func() {
			writeDone <- writeTestClientFrame(
				clientConn,
				0x80|webSocketBinary,
				[]byte("ciphertext"),
				true,
			)
		}()
		payload, err := socket.ReadBinary()
		if err != nil {
			t.Fatal(err)
		}
		if string(payload) != "ciphertext" {
			t.Fatalf("payload = %q", payload)
		}
		if err := <-writeDone; err != nil {
			t.Fatal(err)
		}
	})

	for _, test := range []struct {
		name   string
		first  byte
		masked bool
	}{
		{name: "fragmented", first: webSocketBinary, masked: true},
		{name: "reserved bits", first: 0x80 | 0x40 | webSocketBinary, masked: true},
		{name: "unmasked", first: 0x80 | webSocketBinary, masked: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			serverConn, clientConn := net.Pipe()
			defer serverConn.Close()
			defer clientConn.Close()
			socket := &serverWebSocket{
				conn:      serverConn,
				readLimit: 1024,
			}
			writeDone := make(chan error, 1)
			go func() {
				second := byte(0)
				if test.masked {
					second = 0x80
				}
				_, err := clientConn.Write([]byte{test.first, second})
				writeDone <- err
			}()
			if _, err := socket.ReadBinary(); err == nil {
				t.Fatal("invalid WebSocket frame was accepted")
			}
			if err := <-writeDone; err != nil &&
				!errors.Is(err, net.ErrClosed) {
				t.Fatal(err)
			}
		})
	}
}

func TestServerWebSocketRejectsTextFrames(t *testing.T) {
	serverConn, clientConn := net.Pipe()
	defer serverConn.Close()
	defer clientConn.Close()
	socket := &serverWebSocket{
		conn:      serverConn,
		readLimit: 1024,
	}
	clientDone := make(chan error, 1)
	go func() {
		if err := writeTestClientFrame(
			clientConn,
			0x80|webSocketText,
			[]byte("plaintext"),
			true,
		); err != nil {
			clientDone <- err
			return
		}
		_ = clientConn.SetReadDeadline(time.Now().Add(time.Second))
		var header [2]byte
		if _, err := io.ReadFull(clientConn, header[:]); err != nil {
			clientDone <- err
			return
		}
		if header[0]&0x0f != webSocketClose {
			clientDone <- errors.New("server did not return a close frame")
			return
		}
		length := int(header[1] & 0x7f)
		payload := make([]byte, length)
		_, err := io.ReadFull(clientConn, payload)
		clientDone <- err
	}()
	if _, err := socket.ReadBinary(); err == nil {
		t.Fatal("text WebSocket frame was accepted")
	}
	if err := <-clientDone; err != nil {
		t.Fatal(err)
	}
}

func writeTestClientFrame(
	conn net.Conn,
	first byte,
	payload []byte,
	masked bool,
) error {
	if len(payload) >= 126 {
		return errors.New("test helper only supports short frames")
	}
	second := byte(len(payload))
	packet := []byte{first, second}
	if !masked {
		packet = append(packet, payload...)
		_, err := conn.Write(packet)
		return err
	}
	packet[1] |= 0x80
	mask := [4]byte{0x11, 0x22, 0x33, 0x44}
	packet = append(packet, mask[:]...)
	for index, value := range payload {
		packet = append(packet, value^mask[index%len(mask)])
	}
	_, err := conn.Write(packet)
	return err
}
