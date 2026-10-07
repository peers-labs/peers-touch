package relay

import (
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	hertznetwork "github.com/cloudwego/hertz/pkg/network"
	"github.com/cloudwego/hertz/pkg/protocol/consts"
)

const (
	tunnelWebSocketProtocol = "peers-touch.tunnel.v1"
	webSocketGUID           = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

	webSocketContinuation = byte(0x0)
	webSocketText         = byte(0x1)
	webSocketBinary       = byte(0x2)
	webSocketClose        = byte(0x8)
	webSocketPing         = byte(0x9)
	webSocketPong         = byte(0xa)
)

type serverWebSocket struct {
	conn      net.Conn
	writeMu   sync.Mutex
	readLimit int64
	lastPong  time.Time
}

func upgradeTunnelWebSocket(
	request *app.RequestContext,
	handler func(*serverWebSocket),
) error {
	if !request.IsGet() {
		request.AbortWithMsg(
			consts.StatusMessage(consts.StatusMethodNotAllowed),
			consts.StatusMethodNotAllowed,
		)
		return errors.New("WebSocket upgrade requires GET")
	}
	if !headerHasToken(request, "Connection", "upgrade") ||
		!headerHasToken(request, "Upgrade", "websocket") ||
		!headerHasToken(request, "Sec-WebSocket-Version", "13") {
		request.AbortWithMsg(
			consts.StatusMessage(consts.StatusBadRequest),
			consts.StatusBadRequest,
		)
		return errors.New("invalid WebSocket upgrade")
	}
	if len(request.Request.Header.Peek("Sec-WebSocket-Extensions")) != 0 {
		request.AbortWithMsg(
			"WebSocket compression is not supported",
			consts.StatusBadRequest,
		)
		return errors.New("WebSocket extensions are forbidden")
	}
	if !headerHasToken(
		request,
		"Sec-WebSocket-Protocol",
		tunnelWebSocketProtocol,
	) {
		request.AbortWithMsg(
			"required WebSocket subprotocol is missing",
			consts.StatusBadRequest,
		)
		return errors.New("WebSocket subprotocol mismatch")
	}
	if !sameOriginOrAbsent(request) {
		request.AbortWithMsg(
			consts.StatusMessage(consts.StatusForbidden),
			consts.StatusForbidden,
		)
		return errors.New("WebSocket origin rejected")
	}

	key := strings.TrimSpace(
		string(request.Request.Header.Peek("Sec-WebSocket-Key")),
	)
	decoded, err := base64.StdEncoding.DecodeString(key)
	if err != nil || len(decoded) != 16 {
		request.AbortWithMsg(
			consts.StatusMessage(consts.StatusBadRequest),
			consts.StatusBadRequest,
		)
		return errors.New("invalid WebSocket key")
	}
	acceptSum := sha1.Sum([]byte(key + webSocketGUID))
	request.SetStatusCode(consts.StatusSwitchingProtocols)
	request.Response.Header.Set("Upgrade", "websocket")
	request.Response.Header.Set("Connection", "Upgrade")
	request.Response.Header.Set(
		"Sec-WebSocket-Accept",
		base64.StdEncoding.EncodeToString(acceptSum[:]),
	)
	request.Response.Header.Set(
		"Sec-WebSocket-Protocol",
		tunnelWebSocketProtocol,
	)
	request.Hijack(func(conn hertznetwork.Conn) {
		ws := &serverWebSocket{
			conn:      conn,
			readLimit: int64(maxOuterTunnelFrameBytes),
			lastPong:  time.Now(),
		}
		handler(ws)
		_ = conn.Close()
	})
	return nil
}

func headerHasToken(
	request *app.RequestContext,
	name string,
	wanted string,
) bool {
	value := string(request.Request.Header.Peek(name))
	for _, token := range strings.Split(value, ",") {
		if strings.EqualFold(strings.TrimSpace(token), wanted) {
			return true
		}
	}
	return false
}

func sameOriginOrAbsent(request *app.RequestContext) bool {
	origin := strings.TrimSpace(string(request.Request.Header.Peek("Origin")))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return strings.EqualFold(
		parsed.Host,
		string(request.Request.Header.Peek("Host")),
	)
}

func (w *serverWebSocket) ReadBinary() ([]byte, error) {
	for {
		opcode, payload, err := w.readFrame()
		if err != nil {
			return nil, err
		}
		switch opcode {
		case webSocketBinary:
			return payload, nil
		case webSocketPing:
			if err := w.writeFrame(webSocketPong, payload); err != nil {
				return nil, err
			}
		case webSocketPong:
			w.lastPong = time.Now()
		case webSocketClose:
			return nil, io.EOF
		case webSocketText:
			_ = w.WriteClose(1003, "binary frames required")
			return nil, errors.New("text WebSocket frame rejected")
		default:
			_ = w.WriteClose(1002, "unsupported frame")
			return nil, fmt.Errorf("unsupported WebSocket opcode %d", opcode)
		}
	}
}

func (w *serverWebSocket) readFrame() (byte, []byte, error) {
	var header [2]byte
	if _, err := io.ReadFull(w.conn, header[:]); err != nil {
		return 0, nil, err
	}
	if header[0]&0x70 != 0 || header[0]&0x80 == 0 {
		return 0, nil, errors.New("fragmented or RSV WebSocket frame rejected")
	}
	opcode := header[0] & 0x0f
	if opcode == webSocketContinuation {
		return 0, nil, errors.New("continuation WebSocket frame rejected")
	}
	masked := header[1]&0x80 != 0
	if !masked {
		return 0, nil, errors.New("unmasked client WebSocket frame rejected")
	}
	length := uint64(header[1] & 0x7f)
	switch length {
	case 126:
		var extended [2]byte
		if _, err := io.ReadFull(w.conn, extended[:]); err != nil {
			return 0, nil, err
		}
		length = uint64(binary.BigEndian.Uint16(extended[:]))
	case 127:
		var extended [8]byte
		if _, err := io.ReadFull(w.conn, extended[:]); err != nil {
			return 0, nil, err
		}
		length = binary.BigEndian.Uint64(extended[:])
		if length&(uint64(1)<<63) != 0 {
			return 0, nil, errors.New("invalid WebSocket frame length")
		}
	}
	if opcode >= webSocketClose && length > 125 {
		return 0, nil, errors.New("oversized WebSocket control frame")
	}
	if length > uint64(w.readLimit) {
		_ = w.WriteClose(1009, "frame too large")
		return 0, nil, errors.New("WebSocket frame exceeds limit")
	}
	var mask [4]byte
	if _, err := io.ReadFull(w.conn, mask[:]); err != nil {
		return 0, nil, err
	}
	payload := make([]byte, int(length))
	if _, err := io.ReadFull(w.conn, payload); err != nil {
		return 0, nil, err
	}
	for index := range payload {
		payload[index] ^= mask[index%len(mask)]
	}
	return opcode, payload, nil
}

func (w *serverWebSocket) WriteBinary(payload []byte) error {
	return w.writeFrame(webSocketBinary, payload)
}

func (w *serverWebSocket) WritePing() error {
	return w.writeFrame(webSocketPing, nil)
}

func (w *serverWebSocket) WriteClose(code uint16, reason string) error {
	payload := binary.BigEndian.AppendUint16(nil, code)
	if len(reason) > 123 {
		reason = reason[:123]
	}
	payload = append(payload, reason...)
	return w.writeFrame(webSocketClose, payload)
}

func (w *serverWebSocket) writeFrame(opcode byte, payload []byte) error {
	w.writeMu.Lock()
	defer w.writeMu.Unlock()
	_ = w.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	defer w.conn.SetWriteDeadline(time.Time{})

	header := []byte{0x80 | opcode}
	switch {
	case len(payload) < 126:
		header = append(header, byte(len(payload)))
	case len(payload) <= 0xffff:
		header = append(header, 126)
		header = binary.BigEndian.AppendUint16(header, uint16(len(payload)))
	default:
		header = append(header, 127)
		header = binary.BigEndian.AppendUint64(header, uint64(len(payload)))
	}
	if _, err := w.conn.Write(header); err != nil {
		return err
	}
	if len(payload) == 0 {
		return nil
	}
	_, err := w.conn.Write(payload)
	return err
}

func (w *serverWebSocket) SetReadDeadline(deadline time.Time) error {
	return w.conn.SetReadDeadline(deadline)
}
