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
//   0x01 Request   — relay forwards an HTTP request into the stream
//   0x02 Response  — station sends back the HTTP response
//   0x03 Ping      — keepalive probe (no payload)
//   0x04 Pong      — keepalive reply (no payload)
//   0x05 Broadcast — pub/sub event (Tier C1)
//   0x06 Cancel    — relay cancels an in-flight request
//   0x07 Cancelled — station proves no response can follow
//
// Broadcast (Tier C1):
//   Bidirectional. station → relay carries "publish on topic"; relay
//   → station carries "broadcast received on topic", with the relay
//   stamping `origin_peer_id` into the payload so receivers cannot be
//   spoofed by a sibling station (the relay knows who you are from
//   the handshake).
//
//   Wire payload layout:
//     [2B topicLen][topic][2B originLen][origin_peer_id][4B bodyLen][body]
//
//   `topic` is a short ASCII string (e.g. "fed.invalidate.v1");
//   `origin_peer_id` is empty on the station→relay leg and stamped by
//   the relay before fan-out;
//   `body` is opaque to the relay — receivers know how to decode it
//   from the topic. Today: protobuf-serialised
//   peers_touch.model.federation.v1.FederationInvalidation.
//
//   RequestID is unused for Broadcast (we use 0 by convention) — pub/sub
//   has no request/response semantics.

const (
	FrameVersion byte = 0x01

	TypeRequest   byte = 0x01
	TypeResponse  byte = 0x02
	TypePing      byte = 0x03
	TypePong      byte = 0x04
	TypeBroadcast byte = 0x05
	TypeCancel    byte = 0x06
	TypeCancelled byte = 0x07

	HeaderLen = 10 // version(1) + type(1) + requestID(4) + payloadLen(4)

	// Safety limits to prevent OOM on malicious/corrupt frames.
	MaxMethodLen  = 16
	MaxPathLen    = 8 * 1024         // 8 KB
	MaxHeadersLen = 256 * 1024       // 256 KB
	MaxBodyLen    = 32 * 1024 * 1024 // 32 MB
	MaxPayloadLen = 64 * 1024 * 1024 // 64 MB

	// Broadcast-specific limits. Topics are short labels; bodies stay
	// well under the generic MaxBodyLen because invalidation payloads
	// are tiny protobufs (<256B). Keeping these tight makes amplification
	// abuse harder if a malicious station somehow gets a relay token.
	MaxBroadcastTopicLen = 128
	MaxBroadcastBodyLen  = 64 * 1024 // 64 KB
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

type CancelFrame struct {
	RequestID uint32
}

type CancelledFrame struct {
	RequestID uint32
}

// BroadcastFrame carries a pub/sub event over the relay-station stream.
//
// Direction-dependent fields:
//   - station → relay: `OriginPeerID` is empty; the relay fills it
//     from the handshake before fan-out.
//   - relay → station: `OriginPeerID` is the publishing station's peer
//     id, stamped by the relay. Receivers MUST cross-check this
//     against any cached state (e.g. fedcache.home_station_peer_id)
//     before acting on the event — the relay is trusted to identify
//     the speaker, but only the speaker's home station has authority
//     over its own actors.
type BroadcastFrame struct {
	Topic        string
	OriginPeerID string
	Body         []byte
}

// ---- Read / Write helpers ----

// Envelope is the fixed-width frame header. Separating it from payload parsing
// lets the Relay resolve a pending request's route cap before allocation.
type Envelope struct {
	Type       byte
	RequestID  uint32
	PayloadLen uint32
}

// ReadEnvelope reads and validates one frame envelope without reading or
// allocating its payload.
func ReadEnvelope(r io.Reader) (Envelope, error) {
	var hdr [HeaderLen]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return Envelope{}, fmt.Errorf("read header: %w", err)
	}

	ver := hdr[0]
	if ver != FrameVersion {
		return Envelope{}, fmt.Errorf("unsupported frame version 0x%02x", ver)
	}

	payloadLen := binary.BigEndian.Uint32(hdr[6:10])
	if payloadLen > MaxPayloadLen {
		return Envelope{}, fmt.Errorf("payload too large: %d > %d", payloadLen, MaxPayloadLen)
	}

	return Envelope{
		Type:       hdr[1],
		RequestID:  binary.BigEndian.Uint32(hdr[2:6]),
		PayloadLen: payloadLen,
	}, nil
}

// ReadFramePayload reads and parses the payload for an already-read envelope.
// maxPayloadLen may be narrower than MaxPayloadLen for route-specific frames.
func ReadFramePayload(r io.Reader, envelope Envelope, maxPayloadLen uint32) (interface{}, error) {
	if envelope.PayloadLen > maxPayloadLen {
		return nil, fmt.Errorf(
			"payload too large for request %d: %d > %d",
			envelope.RequestID,
			envelope.PayloadLen,
			maxPayloadLen,
		)
	}

	var payload []byte
	if envelope.PayloadLen > 0 {
		payload = make([]byte, envelope.PayloadLen)
		if _, err := io.ReadFull(r, payload); err != nil {
			return nil, fmt.Errorf("read payload: %w", err)
		}
	}

	switch envelope.Type {
	case TypeRequest:
		if envelope.RequestID == 0 {
			return nil, fmt.Errorf("request frame has zero request ID")
		}
		return parseRequestPayload(envelope.RequestID, payload)
	case TypeResponse:
		if envelope.RequestID == 0 {
			return nil, fmt.Errorf("response frame has zero request ID")
		}
		return parseResponsePayload(envelope.RequestID, payload)
	case TypePing:
		if len(payload) != 0 {
			return nil, fmt.Errorf("ping frame has payload")
		}
		return &PingFrame{RequestID: envelope.RequestID}, nil
	case TypePong:
		if len(payload) != 0 {
			return nil, fmt.Errorf("pong frame has payload")
		}
		return &PongFrame{RequestID: envelope.RequestID}, nil
	case TypeBroadcast:
		if envelope.RequestID != 0 {
			return nil, fmt.Errorf("broadcast frame has nonzero request ID")
		}
		return parseBroadcastPayload(payload)
	case TypeCancel:
		if envelope.RequestID == 0 || len(payload) != 0 {
			return nil, fmt.Errorf("cancel frame is invalid")
		}
		return &CancelFrame{RequestID: envelope.RequestID}, nil
	case TypeCancelled:
		if envelope.RequestID == 0 || len(payload) != 0 {
			return nil, fmt.Errorf("cancelled frame is invalid")
		}
		return &CancelledFrame{RequestID: envelope.RequestID}, nil
	default:
		return nil, fmt.Errorf("unknown frame type 0x%02x", envelope.Type)
	}
}

// ReadFrame reads exactly one frame using the general protocol payload limit.
func ReadFrame(r io.Reader) (interface{}, error) {
	envelope, err := ReadEnvelope(r)
	if err != nil {
		return nil, err
	}
	return ReadFramePayload(r, envelope, MaxPayloadLen)
}

// DiscardPayload consumes a known payload without allocating it as one slice.
func DiscardPayload(r io.Reader, payloadLen uint32) error {
	var scratch [32 * 1024]byte
	remaining := int64(payloadLen)
	for remaining > 0 {
		chunk := int64(len(scratch))
		if remaining < chunk {
			chunk = remaining
		}
		if _, err := io.ReadFull(r, scratch[:chunk]); err != nil {
			return fmt.Errorf("discard payload: %w", err)
		}
		remaining -= chunk
	}
	return nil
}

// WriteRequestFrame serialises a full HTTP-over-stream request frame.
func WriteRequestFrame(w io.Writer, reqID uint32, method, path string, headers map[string]string, body []byte) error {
	if reqID == 0 {
		return fmt.Errorf("request ID must be nonzero")
	}
	payload, err := buildRequestPayload(method, path, headers, body)
	if err != nil {
		return err
	}
	return writeRaw(w, TypeRequest, reqID, payload)
}

// WriteResponseFrame serialises a full HTTP-over-stream response frame.
func WriteResponseFrame(w io.Writer, reqID uint32, statusCode uint32, headers map[string]string, body []byte) error {
	if reqID == 0 {
		return fmt.Errorf("request ID must be nonzero")
	}
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

func WriteCancel(w io.Writer, reqID uint32) error {
	if reqID == 0 {
		return fmt.Errorf("request ID must be nonzero")
	}
	return writeRaw(w, TypeCancel, reqID, nil)
}

func WriteCancelled(w io.Writer, reqID uint32) error {
	if reqID == 0 {
		return fmt.Errorf("request ID must be nonzero")
	}
	return writeRaw(w, TypeCancelled, reqID, nil)
}

// WriteBroadcastFrame serialises a pub/sub event. RequestID is unused
// for Broadcast frames; we wire 0 by convention.
//
// The station→relay path leaves originPeerID empty; the relay
// rewrites it to the authenticated peer id before re-emitting. The
// relay→station path carries the relay-stamped value verbatim.
func WriteBroadcastFrame(w io.Writer, topic, originPeerID string, body []byte) error {
	payload, err := buildBroadcastPayload(topic, originPeerID, body)
	if err != nil {
		return err
	}
	return writeRaw(w, TypeBroadcast, 0, payload)
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
	if uint64(len(payload)) > uint64(MaxPayloadLen) {
		return fmt.Errorf("payload too large: %d > %d", len(payload), MaxPayloadLen)
	}
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
//
//	[4B methodLen][method][4B pathLen][path][4B headersLen][headers][4B bodyLen][body]
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
	body, rest, err := readLenPrefixed(data, "body", MaxBodyLen)
	if err != nil {
		return nil, err
	}
	if len(rest) != 0 {
		return nil, fmt.Errorf("request payload has %d trailing bytes", len(rest))
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
//
//	[4B statusCode][4B headersLen][headers][4B bodyLen][body]
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
	body, rest, err := readLenPrefixed(data, "body", MaxBodyLen)
	if err != nil {
		return nil, err
	}
	if len(rest) != 0 {
		return nil, fmt.Errorf("response payload has %d trailing bytes", len(rest))
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

// Broadcast payload layout (Tier C1):
//
//	[2B topicLen][topic][2B originLen][origin_peer_id][4B bodyLen][body]
//
// We use uint16 for topic + origin lengths because both are short
// labels (topics ≤ 128 bytes, peer IDs are base58 strings ≤ ~80
// bytes). Body uses uint32 so an out-of-spec receiver still parses
// the buffer correctly even when bodies grow with future event
// types.
func buildBroadcastPayload(topic, originPeerID string, body []byte) ([]byte, error) {
	topicB := []byte(topic)
	originB := []byte(originPeerID)

	if len(topicB) == 0 {
		return nil, fmt.Errorf("broadcast: empty topic")
	}
	if len(topicB) > MaxBroadcastTopicLen {
		return nil, fmt.Errorf("broadcast topic too long: %d > %d", len(topicB), MaxBroadcastTopicLen)
	}
	// Origin can be empty on the station→relay leg; cap on the upper
	// end mirrors the topic limit because peer IDs are smaller still.
	if len(originB) > MaxBroadcastTopicLen {
		return nil, fmt.Errorf("broadcast origin too long: %d > %d", len(originB), MaxBroadcastTopicLen)
	}
	if len(body) > MaxBroadcastBodyLen {
		return nil, fmt.Errorf("broadcast body too long: %d > %d", len(body), MaxBroadcastBodyLen)
	}

	total := 2 + len(topicB) + 2 + len(originB) + 4 + len(body)
	buf := make([]byte, 0, total)
	buf = binary.BigEndian.AppendUint16(buf, uint16(len(topicB)))
	buf = append(buf, topicB...)
	buf = binary.BigEndian.AppendUint16(buf, uint16(len(originB)))
	buf = append(buf, originB...)
	buf = binary.BigEndian.AppendUint32(buf, uint32(len(body)))
	buf = append(buf, body...)
	return buf, nil
}

func parseBroadcastPayload(data []byte) (*BroadcastFrame, error) {
	topic, data, err := readU16Prefixed(data, "topic", MaxBroadcastTopicLen)
	if err != nil {
		return nil, err
	}
	if len(topic) == 0 {
		return nil, fmt.Errorf("broadcast: empty topic")
	}
	originB, data, err := readU16Prefixed(data, "origin_peer_id", MaxBroadcastTopicLen)
	if err != nil {
		return nil, err
	}
	body, rest, err := readLenPrefixedSized(data, "body", MaxBroadcastBodyLen)
	if err != nil {
		return nil, err
	}
	if len(rest) != 0 {
		return nil, fmt.Errorf("broadcast payload has %d trailing bytes", len(rest))
	}
	return &BroadcastFrame{
		Topic:        string(topic),
		OriginPeerID: string(originB),
		Body:         body,
	}, nil
}

// readU16Prefixed pulls a uint16-length-prefixed value off the front
// of `data`. Used for the small label fields in the broadcast
// payload (topic, origin_peer_id) where the generic uint32 prefix
// would waste 2 bytes per field.
func readU16Prefixed(data []byte, field string, maxLen int) (value, rest []byte, err error) {
	if len(data) < 2 {
		return nil, nil, fmt.Errorf("read %s length: short buffer", field)
	}
	n := binary.BigEndian.Uint16(data[:2])
	data = data[2:]
	if int(n) > maxLen {
		return nil, nil, fmt.Errorf("%s too long: %d > %d", field, n, maxLen)
	}
	if len(data) < int(n) {
		return nil, nil, fmt.Errorf("read %s: short payload", field)
	}
	return data[:n], data[n:], nil
}

// readLenPrefixedSized is the uint32-length-prefixed reader with a
// custom max. Mirrors readLenPrefixed but with a different cap
// enforced — callers like broadcast want a tighter bound than the
// generic MaxBodyLen.
func readLenPrefixedSized(data []byte, field string, maxLen int) (value, rest []byte, err error) {
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
