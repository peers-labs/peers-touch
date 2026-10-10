package protocol

import (
	"encoding/binary"
	"fmt"
	"io"

	federationmodel "github.com/peers-labs/peers-touch/station/frame/core/federation/model"
)

// The mount stream has one reader and one serialized writer on each side.
// Request/response HTTP metadata is intentionally absent: tunnel data is
// opaque inner-TLS ciphertext.
const (
	FrameVersion byte = 0x02

	TypePing         byte = 0x03
	TypePong         byte = 0x04
	TypeBroadcast    byte = 0x05
	TypeTunnelOpen   byte = 0x06
	TypeTunnelOpened byte = 0x07
	TypeTunnelData   byte = 0x08
	TypeTunnelCancel byte = 0x09
	TypeTunnelClose  byte = 0x0a

	HeaderLen = 10

	MaxRouteIDLen        = 128
	MaxPeerIDLen         = 128
	MaxTunnelDataLen     = 64 * 1024
	MaxPayloadLen        = MaxTunnelDataLen + 256
	MaxBroadcastTopicLen = 128
	MaxBroadcastBodyLen  = 64 * 1024
)

type PingFrame struct {
	RequestID uint32
}

type PongFrame struct {
	RequestID uint32
}

type BroadcastFrame struct {
	Topic        string
	OriginPeerID string
	Body         []byte
}

type TunnelOpenFrame struct {
	TunnelID            uint32
	RouteID             string
	RouteGeneration     uint64
	CallerStationPeerID string
	Purpose             federationmodel.RelayTunnelPurpose
}

type TunnelOpenedFrame struct {
	TunnelID uint32
}

type TunnelDataFrame struct {
	TunnelID uint32
	Sequence uint64
	Data     []byte
}

type TunnelCancelFrame struct {
	TunnelID uint32
	Reason   federationmodel.RelayTunnelCloseReason
}

type TunnelCloseFrame struct {
	TunnelID uint32
	Reason   federationmodel.RelayTunnelCloseReason
}

func ReadFrame(r io.Reader) (any, error) {
	var header [HeaderLen]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return nil, fmt.Errorf("read header: %w", err)
	}
	if header[0] != FrameVersion {
		return nil, fmt.Errorf("unsupported frame version 0x%02x", header[0])
	}
	frameType := header[1]
	streamID := binary.BigEndian.Uint32(header[2:6])
	payloadLen := binary.BigEndian.Uint32(header[6:10])
	if payloadLen > MaxPayloadLen {
		return nil, fmt.Errorf("payload too large: %d > %d", payloadLen, MaxPayloadLen)
	}
	payload := make([]byte, payloadLen)
	if _, err := io.ReadFull(r, payload); err != nil {
		return nil, fmt.Errorf("read payload: %w", err)
	}

	switch frameType {
	case TypePing:
		if len(payload) != 0 {
			return nil, fmt.Errorf("ping payload must be empty")
		}
		return &PingFrame{RequestID: streamID}, nil
	case TypePong:
		if len(payload) != 0 {
			return nil, fmt.Errorf("pong payload must be empty")
		}
		return &PongFrame{RequestID: streamID}, nil
	case TypeBroadcast:
		return parseBroadcastPayload(payload)
	case TypeTunnelOpen:
		return parseTunnelOpen(streamID, payload)
	case TypeTunnelOpened:
		if len(payload) != 0 {
			return nil, fmt.Errorf("tunnel opened payload must be empty")
		}
		return &TunnelOpenedFrame{TunnelID: streamID}, nil
	case TypeTunnelData:
		return parseTunnelData(streamID, payload)
	case TypeTunnelCancel:
		return parseTunnelCancel(streamID, payload)
	case TypeTunnelClose:
		return parseTunnelClose(streamID, payload)
	default:
		return nil, fmt.Errorf("unknown frame type 0x%02x", frameType)
	}
}

func WritePing(w io.Writer, requestID uint32) error {
	return writeRaw(w, TypePing, requestID, nil)
}

func WritePong(w io.Writer, requestID uint32) error {
	return writeRaw(w, TypePong, requestID, nil)
}

func WriteBroadcastFrame(
	w io.Writer,
	topic string,
	originPeerID string,
	body []byte,
) error {
	payload, err := buildBroadcastPayload(topic, originPeerID, body)
	if err != nil {
		return err
	}
	return writeRaw(w, TypeBroadcast, 0, payload)
}

func WriteTunnelOpen(w io.Writer, frame *TunnelOpenFrame) error {
	if frame == nil || frame.TunnelID == 0 {
		return fmt.Errorf("tunnel open requires a tunnel id")
	}
	routeID := []byte(frame.RouteID)
	caller := []byte(frame.CallerStationPeerID)
	if len(routeID) == 0 || len(routeID) > MaxRouteIDLen {
		return fmt.Errorf("route id length is invalid")
	}
	if len(caller) > MaxPeerIDLen {
		return fmt.Errorf("caller peer id too long")
	}
	if frame.RouteGeneration == 0 ||
		frame.Purpose == federationmodel.RelayTunnelPurpose_RELAY_TUNNEL_PURPOSE_UNSPECIFIED {
		return fmt.Errorf("tunnel open metadata is invalid")
	}
	payload := make([]byte, 0, 2+len(routeID)+8+2+len(caller)+1)
	payload = appendU16Prefixed(payload, routeID)
	payload = binary.BigEndian.AppendUint64(payload, frame.RouteGeneration)
	payload = appendU16Prefixed(payload, caller)
	payload = append(payload, byte(frame.Purpose))
	return writeRaw(w, TypeTunnelOpen, frame.TunnelID, payload)
}

func WriteTunnelOpened(w io.Writer, tunnelID uint32) error {
	if tunnelID == 0 {
		return fmt.Errorf("tunnel opened requires a tunnel id")
	}
	return writeRaw(w, TypeTunnelOpened, tunnelID, nil)
}

func WriteTunnelData(
	w io.Writer,
	tunnelID uint32,
	sequence uint64,
	data []byte,
) error {
	if tunnelID == 0 || sequence == 0 {
		return fmt.Errorf("tunnel data metadata is invalid")
	}
	if len(data) == 0 || len(data) > MaxTunnelDataLen {
		return fmt.Errorf(
			"tunnel data length is invalid: %d (max %d)",
			len(data),
			MaxTunnelDataLen,
		)
	}
	payload := make([]byte, 0, 8+len(data))
	payload = binary.BigEndian.AppendUint64(payload, sequence)
	payload = append(payload, data...)
	return writeRaw(w, TypeTunnelData, tunnelID, payload)
}

func WriteTunnelCancel(
	w io.Writer,
	tunnelID uint32,
	reason federationmodel.RelayTunnelCloseReason,
) error {
	return writeTunnelTerminal(w, TypeTunnelCancel, tunnelID, reason)
}

func WriteTunnelClose(
	w io.Writer,
	tunnelID uint32,
	reason federationmodel.RelayTunnelCloseReason,
) error {
	return writeTunnelTerminal(w, TypeTunnelClose, tunnelID, reason)
}

func writeTunnelTerminal(
	w io.Writer,
	frameType byte,
	tunnelID uint32,
	reason federationmodel.RelayTunnelCloseReason,
) error {
	if tunnelID == 0 ||
		reason == federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_UNSPECIFIED {
		return fmt.Errorf("tunnel terminal metadata is invalid")
	}
	return writeRaw(w, frameType, tunnelID, []byte{byte(reason)})
}

func parseTunnelOpen(tunnelID uint32, payload []byte) (*TunnelOpenFrame, error) {
	routeID, rest, err := readU16Prefixed(payload, "route_id", MaxRouteIDLen)
	if err != nil || len(routeID) == 0 {
		return nil, fmt.Errorf("invalid tunnel route: %w", err)
	}
	if len(rest) < 8 {
		return nil, fmt.Errorf("tunnel open missing route generation")
	}
	generation := binary.BigEndian.Uint64(rest[:8])
	caller, rest, err := readU16Prefixed(rest[8:], "caller_peer_id", MaxPeerIDLen)
	if err != nil {
		return nil, err
	}
	if len(rest) != 1 || generation == 0 {
		return nil, fmt.Errorf("invalid tunnel open payload")
	}
	purpose := federationmodel.RelayTunnelPurpose(rest[0])
	if purpose == federationmodel.RelayTunnelPurpose_RELAY_TUNNEL_PURPOSE_UNSPECIFIED {
		return nil, fmt.Errorf("invalid tunnel purpose")
	}
	return &TunnelOpenFrame{
		TunnelID:            tunnelID,
		RouteID:             string(routeID),
		RouteGeneration:     generation,
		CallerStationPeerID: string(caller),
		Purpose:             purpose,
	}, nil
}

func parseTunnelData(tunnelID uint32, payload []byte) (*TunnelDataFrame, error) {
	if len(payload) <= 8 || len(payload)-8 > MaxTunnelDataLen {
		return nil, fmt.Errorf("invalid tunnel data length")
	}
	sequence := binary.BigEndian.Uint64(payload[:8])
	if sequence == 0 {
		return nil, fmt.Errorf("invalid tunnel data sequence")
	}
	return &TunnelDataFrame{
		TunnelID: tunnelID,
		Sequence: sequence,
		Data:     append([]byte(nil), payload[8:]...),
	}, nil
}

func parseTunnelCancel(
	tunnelID uint32,
	payload []byte,
) (*TunnelCancelFrame, error) {
	reason, err := parseTunnelReason(payload)
	if err != nil {
		return nil, err
	}
	return &TunnelCancelFrame{TunnelID: tunnelID, Reason: reason}, nil
}

func parseTunnelClose(
	tunnelID uint32,
	payload []byte,
) (*TunnelCloseFrame, error) {
	reason, err := parseTunnelReason(payload)
	if err != nil {
		return nil, err
	}
	return &TunnelCloseFrame{TunnelID: tunnelID, Reason: reason}, nil
}

func parseTunnelReason(
	payload []byte,
) (federationmodel.RelayTunnelCloseReason, error) {
	if len(payload) != 1 {
		return 0, fmt.Errorf("invalid tunnel terminal payload")
	}
	reason := federationmodel.RelayTunnelCloseReason(payload[0])
	if reason == federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_UNSPECIFIED {
		return 0, fmt.Errorf("invalid tunnel terminal reason")
	}
	return reason, nil
}

func writeRaw(w io.Writer, frameType byte, streamID uint32, payload []byte) error {
	if len(payload) > MaxPayloadLen {
		return fmt.Errorf("payload too large: %d > %d", len(payload), MaxPayloadLen)
	}
	var header [HeaderLen]byte
	header[0] = FrameVersion
	header[1] = frameType
	binary.BigEndian.PutUint32(header[2:6], streamID)
	binary.BigEndian.PutUint32(header[6:10], uint32(len(payload)))
	if _, err := w.Write(header[:]); err != nil {
		return err
	}
	if len(payload) == 0 {
		return nil
	}
	_, err := w.Write(payload)
	return err
}

func buildBroadcastPayload(topic, originPeerID string, body []byte) ([]byte, error) {
	topicBytes := []byte(topic)
	originBytes := []byte(originPeerID)
	if len(topicBytes) == 0 || len(topicBytes) > MaxBroadcastTopicLen {
		return nil, fmt.Errorf("broadcast topic length is invalid")
	}
	if len(originBytes) > MaxPeerIDLen {
		return nil, fmt.Errorf("broadcast origin too long")
	}
	if len(body) > MaxBroadcastBodyLen {
		return nil, fmt.Errorf("broadcast body too long")
	}
	payload := make([]byte, 0, 2+len(topicBytes)+2+len(originBytes)+4+len(body))
	payload = appendU16Prefixed(payload, topicBytes)
	payload = appendU16Prefixed(payload, originBytes)
	payload = binary.BigEndian.AppendUint32(payload, uint32(len(body)))
	payload = append(payload, body...)
	return payload, nil
}

func parseBroadcastPayload(payload []byte) (*BroadcastFrame, error) {
	topic, rest, err := readU16Prefixed(payload, "topic", MaxBroadcastTopicLen)
	if err != nil || len(topic) == 0 {
		return nil, fmt.Errorf("invalid broadcast topic: %w", err)
	}
	origin, rest, err := readU16Prefixed(rest, "origin_peer_id", MaxPeerIDLen)
	if err != nil {
		return nil, err
	}
	if len(rest) < 4 {
		return nil, fmt.Errorf("read broadcast body length: short buffer")
	}
	bodyLen := binary.BigEndian.Uint32(rest[:4])
	rest = rest[4:]
	if bodyLen > MaxBroadcastBodyLen || int(bodyLen) != len(rest) {
		return nil, fmt.Errorf("invalid broadcast body length")
	}
	return &BroadcastFrame{
		Topic:        string(topic),
		OriginPeerID: string(origin),
		Body:         append([]byte(nil), rest...),
	}, nil
}

func appendU16Prefixed(dst, value []byte) []byte {
	dst = binary.BigEndian.AppendUint16(dst, uint16(len(value)))
	return append(dst, value...)
}

func readU16Prefixed(
	payload []byte,
	field string,
	maxLen int,
) (value []byte, rest []byte, err error) {
	if len(payload) < 2 {
		return nil, nil, fmt.Errorf("read %s length: short buffer", field)
	}
	length := int(binary.BigEndian.Uint16(payload[:2]))
	payload = payload[2:]
	if length > maxLen || len(payload) < length {
		return nil, nil, fmt.Errorf("invalid %s length", field)
	}
	return payload[:length], payload[length:], nil
}
