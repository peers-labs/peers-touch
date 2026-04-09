package protocol

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
)

// --- Protocol v1 frame format ---
//
// Envelope (10 bytes):
//   [1B version][1B type][4B requestID][4B payloadLen]
//   + [payloadLen bytes payload]
//
// Frame types:
//   0x01 Request  — relay forwards an HTTP request into the stream
//   0x02 Response — station sends back the HTTP response
//   0x03 Ping     — keepalive probe (no payload)
//   0x04 Pong     — keepalive reply (no payload)

const (
	FrameVersion byte = 0x01

	TypeRequest  byte = 0x01
	TypeResponse byte = 0x02
	TypePing     byte = 0x03
	TypePong     byte = 0x04

	HeaderLen = 10 // version(1) + type(1) + requestID(4) + payloadLen(4)

	// Safety limits to prevent OOM on malicious/corrupt frames.
	MaxMethodLen  = 16
	MaxPathLen    = 8 * 1024          // 8 KB
	MaxHeadersLen = 256 * 1024        // 256 KB
	MaxBodyLen    = 32 * 1024 * 1024  // 32 MB
	MaxPayloadLen = 64 * 1024 * 1024  // 64 MB
)

// ---- Typed frame structs ----

type RequestFrame struct {
	RequestID uint32
	Method    string
	Path      string
	Headers   map[string]string
	Body      []byte
}

type ResponseFrame struct {
	RequestID  uint32
	StatusCode uint32
	Headers    map[string]string
	Body       []byte
}

type PingFrame struct {
	RequestID uint32
}

type PongFrame struct {
	RequestID uint32
}

// ---- Read / Write helpers ----

// ReadFrame reads exactly one frame from r and returns a typed struct.
// Caller should type-switch on *RequestFrame, *ResponseFrame, *PingFrame, *PongFrame.
func ReadFrame(r io.Reader) (interface{}, error) {
	var hdr [HeaderLen]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return nil, fmt.Errorf("read header: %w", err)
	}

	ver := hdr[0]
	if ver != FrameVersion {
		return nil, fmt.Errorf("unsupported frame version 0x%02x", ver)
	}

	typ := hdr[1]
	reqID := binary.BigEndian.Uint32(hdr[2:6])
	payloadLen := binary.BigEndian.Uint32(hdr[6:10])

	if payloadLen > MaxPayloadLen {
		return nil, fmt.Errorf("payload too large: %d > %d", payloadLen, MaxPayloadLen)
	}

	var payload []byte
	if payloadLen > 0 {
		payload = make([]byte, payloadLen)
		if _, err := io.ReadFull(r, payload); err != nil {
			return nil, fmt.Errorf("read payload: %w", err)
		}
	}

	switch typ {
	case TypeRequest:
		return parseRequestPayload(reqID, payload)
	case TypeResponse:
		return parseResponsePayload(reqID, payload)
	case TypePing:
		return &PingFrame{RequestID: reqID}, nil
	case TypePong:
		return &PongFrame{RequestID: reqID}, nil
	default:
		return nil, fmt.Errorf("unknown frame type 0x%02x", typ)
	}
}

// WriteRequestFrame serialises a full HTTP-over-stream request frame.
func WriteRequestFrame(w io.Writer, reqID uint32, method, path string, headers map[string]string, body []byte) error {
	payload, err := buildRequestPayload(method, path, headers, body)
	if err != nil {
		return err
	}
	return writeRaw(w, TypeRequest, reqID, payload)
}

// WriteResponseFrame serialises a full HTTP-over-stream response frame.
func WriteResponseFrame(w io.Writer, reqID uint32, statusCode uint32, headers map[string]string, body []byte) error {
	payload, err := buildResponsePayload(statusCode, headers, body)
	if err != nil {
		return err
	}
	return writeRaw(w, TypeResponse, reqID, payload)
}

func WritePing(w io.Writer, reqID uint32) error {
	return writeRaw(w, TypePing, reqID, nil)
}

func WritePong(w io.Writer, reqID uint32) error {
	return writeRaw(w, TypePong, reqID, nil)
}

// ---- Header marshal helpers ----

func MarshalHeaders(h map[string]string) ([]byte, error) {
	if len(h) == 0 {
		return nil, nil
	}
	return json.Marshal(h)
}

func UnmarshalHeaders(data []byte) (map[string]string, error) {
	if len(data) == 0 {
		return nil, nil
	}
	var h map[string]string
	err := json.Unmarshal(data, &h)
	return h, err
}

// ---- internal ----

func writeRaw(w io.Writer, typ byte, reqID uint32, payload []byte) error {
	var hdr [HeaderLen]byte
	hdr[0] = FrameVersion
	hdr[1] = typ
	binary.BigEndian.PutUint32(hdr[2:6], reqID)
	binary.BigEndian.PutUint32(hdr[6:10], uint32(len(payload)))

	if _, err := w.Write(hdr[:]); err != nil {
		return err
	}
	if len(payload) > 0 {
		if _, err := w.Write(payload); err != nil {
			return err
		}
	}
	return nil
}

// Request payload layout:
//   [4B methodLen][method][4B pathLen][path][4B headersLen][headers][4B bodyLen][body]
func buildRequestPayload(method, path string, headers map[string]string, body []byte) ([]byte, error) {
	methodB := []byte(method)
	pathB := []byte(path)
	headersB, err := MarshalHeaders(headers)
	if err != nil {
		return nil, fmt.Errorf("marshal headers: %w", err)
	}

	if len(methodB) > MaxMethodLen {
		return nil, fmt.Errorf("method too long: %d > %d", len(methodB), MaxMethodLen)
	}
	if len(pathB) > MaxPathLen {
		return nil, fmt.Errorf("path too long: %d > %d", len(pathB), MaxPathLen)
	}
	if len(headersB) > MaxHeadersLen {
		return nil, fmt.Errorf("headers too long: %d > %d", len(headersB), MaxHeadersLen)
	}
	if len(body) > MaxBodyLen {
		return nil, fmt.Errorf("body too long: %d > %d", len(body), MaxBodyLen)
	}

	total := 4 + len(methodB) + 4 + len(pathB) + 4 + len(headersB) + 4 + len(body)
	buf := make([]byte, 0, total)
	buf = appendLenPrefixed(buf, methodB)
	buf = appendLenPrefixed(buf, pathB)
	buf = appendLenPrefixed(buf, headersB)
	buf = appendLenPrefixed(buf, body)
	return buf, nil
}

func parseRequestPayload(reqID uint32, data []byte) (*RequestFrame, error) {
	methodB, data, err := readLenPrefixed(data, "method", MaxMethodLen)
	if err != nil {
		return nil, err
	}
	pathB, data, err := readLenPrefixed(data, "path", MaxPathLen)
	if err != nil {
		return nil, err
	}
	headersB, data, err := readLenPrefixed(data, "headers", MaxHeadersLen)
	if err != nil {
		return nil, err
	}
	body, _, err := readLenPrefixed(data, "body", MaxBodyLen)
	if err != nil {
		return nil, err
	}

	headers, err := UnmarshalHeaders(headersB)
	if err != nil {
		return nil, fmt.Errorf("unmarshal headers: %w", err)
	}

	return &RequestFrame{
		RequestID: reqID,
		Method:    string(methodB),
		Path:      string(pathB),
		Headers:   headers,
		Body:      body,
	}, nil
}

// Response payload layout:
//   [4B statusCode][4B headersLen][headers][4B bodyLen][body]
func buildResponsePayload(statusCode uint32, headers map[string]string, body []byte) ([]byte, error) {
	headersB, err := MarshalHeaders(headers)
	if err != nil {
		return nil, fmt.Errorf("marshal headers: %w", err)
	}

	if len(headersB) > MaxHeadersLen {
		return nil, fmt.Errorf("headers too long: %d > %d", len(headersB), MaxHeadersLen)
	}
	if len(body) > MaxBodyLen {
		return nil, fmt.Errorf("body too long: %d > %d", len(body), MaxBodyLen)
	}

	total := 4 + 4 + len(headersB) + 4 + len(body)
	buf := make([]byte, 0, total)
	buf = binary.BigEndian.AppendUint32(buf, statusCode)
	buf = appendLenPrefixed(buf, headersB)
	buf = appendLenPrefixed(buf, body)
	return buf, nil
}

func parseResponsePayload(reqID uint32, data []byte) (*ResponseFrame, error) {
	if len(data) < 4 {
		return nil, fmt.Errorf("response payload too short for status code")
	}
	statusCode := binary.BigEndian.Uint32(data[:4])
	data = data[4:]

	headersB, data, err := readLenPrefixed(data, "headers", MaxHeadersLen)
	if err != nil {
		return nil, err
	}
	body, _, err := readLenPrefixed(data, "body", MaxBodyLen)
	if err != nil {
		return nil, err
	}

	headers, err := UnmarshalHeaders(headersB)
	if err != nil {
		return nil, fmt.Errorf("unmarshal headers: %w", err)
	}

	return &ResponseFrame{
		RequestID:  reqID,
		StatusCode: statusCode,
		Headers:    headers,
		Body:       body,
	}, nil
}

func appendLenPrefixed(buf, data []byte) []byte {
	buf = binary.BigEndian.AppendUint32(buf, uint32(len(data)))
	return append(buf, data...)
}

func readLenPrefixed(data []byte, field string, maxLen int) (value, rest []byte, err error) {
	if len(data) < 4 {
		return nil, nil, fmt.Errorf("read %s length: short buffer", field)
	}
	n := binary.BigEndian.Uint32(data[:4])
	data = data[4:]
	if int(n) > maxLen {
		return nil, nil, fmt.Errorf("%s too long: %d > %d", field, n, maxLen)
	}
	if uint32(len(data)) < n {
		return nil, nil, fmt.Errorf("read %s: short payload", field)
	}
	return data[:n], data[n:], nil
}
