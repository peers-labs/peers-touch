package relay

import (
	"context"
	"crypto/rand"
	"errors"
	"io"
	"net"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	federationmodel "github.com/peers-labs/peers-touch/station/frame/core/federation/model"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/application"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/protocol"
	"google.golang.org/protobuf/proto"
)

const (
	relayTunnelProtocolVersion = uint32(1)
	maxOuterTunnelFrameBytes   = protocol.MaxTunnelDataLen + 1024
	tunnelHandshakeTimeout     = 10 * time.Second
	tunnelIdleTimeout          = 60 * time.Second
	tunnelRateBytesPerSecond   = int64(8 << 20)
)

type tunnelCaller struct {
	sourceKey string
	mount     *domain.MountIdentity
}

func (h *relayHandler) handleTunnel(
	ctx context.Context,
	request *app.RequestContext,
) {
	caller, err := h.tunnelCaller(ctx, request)
	if err != nil {
		request.AbortWithStatus(401)
		return
	}
	if err := upgradeTunnelWebSocket(
		request,
		func(socket *serverWebSocket) {
			h.serveTunnel(context.Background(), socket, caller)
		},
	); err != nil {
		logger.Warnf(ctx, "[relay] tunnel upgrade rejected: %v", err)
	}
}

func (h *relayHandler) tunnelCaller(
	ctx context.Context,
	request *app.RequestContext,
) (tunnelCaller, error) {
	caller := tunnelCaller{sourceKey: tunnelRequestSourceKey(request)}
	authorization := strings.TrimSpace(
		string(request.Request.Header.Peek("Authorization")),
	)
	if authorization == "" {
		return caller, nil
	}
	token, ok := bearerToken(authorization)
	if !ok {
		return tunnelCaller{}, application.ErrCredentialInvalid
	}
	identity, err := h.sub.svc.AuthenticateMountCredential(
		ctx,
		token,
		domain.ScopePeerTunnel,
	)
	if err != nil {
		return tunnelCaller{}, err
	}
	caller.mount = &identity
	caller.sourceKey = identity.StationPeerID
	return caller, nil
}

func (h *relayHandler) serveTunnel(
	ctx context.Context,
	socket *serverWebSocket,
	caller tunnelCaller,
) {
	_ = socket.SetReadDeadline(time.Now().Add(tunnelHandshakeTimeout))
	frame, err := readOuterTunnelFrame(socket)
	if err != nil || frame.GetOpen() == nil {
		_ = socket.WriteClose(1002, "TunnelOpen required")
		return
	}
	open := frame.GetOpen()
	if len(open.GetClientNonce()) != 32 {
		_ = writeOuterClose(
			socket,
			0,
			federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_PROTOCOL_ERROR,
		)
		return
	}

	route, err := h.authorizeTunnel(ctx, caller, open)
	if err != nil {
		_ = writeOuterClose(
			socket,
			0,
			federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_REVOKED,
		)
		return
	}
	entry, ok := h.sub.streams.GetEntry(route.StationPeerID)
	if !ok || entry.generation != route.RouteGeneration {
		_ = writeOuterClose(
			socket,
			0,
			federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_UNAVAILABLE,
		)
		return
	}
	if !entry.AcquireSemaphore() {
		_ = writeOuterClose(
			socket,
			0,
			federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_OVERLOADED,
		)
		return
	}
	defer entry.ReleaseSemaphore()
	release, ok := h.sub.tunnels.acquire(caller.sourceKey, route.RouteID)
	if !ok {
		_ = writeOuterClose(
			socket,
			0,
			federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_OVERLOADED,
		)
		return
	}
	defer release()

	h.sub.streams.TrackInflight()
	defer h.sub.streams.UntrackInflight()
	metActiveTunnels.Inc()
	defer metActiveTunnels.Dec()

	tunnelID := h.sub.streams.NextTunnelID()
	tunnel, err := entry.OpenTunnel(
		ctx,
		tunnelID,
		route.RouteID,
		route.RouteGeneration,
		callerStationPeerID(caller),
		open.GetPurpose(),
		tunnelHandshakeTimeout,
	)
	if err != nil {
		_ = writeOuterClose(
			socket,
			uint64(tunnelID),
			closeReasonForError(err),
		)
		return
	}
	defer tunnel.Cancel(
		federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_CANCELLED,
	)

	limits := h.tunnelLimits(entry)
	relayNonce := make([]byte, 32)
	if _, err := rand.Read(relayNonce); err != nil {
		_ = writeOuterClose(
			socket,
			uint64(tunnelID),
			federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_UNAVAILABLE,
		)
		return
	}
	if err := writeOuterTunnelFrame(socket, &federationmodel.RelayTunnelFrame{
		ProtocolVersion: relayTunnelProtocolVersion,
		Payload: &federationmodel.RelayTunnelFrame_Opened{
			Opened: &federationmodel.RelayTunnelOpened{
				TunnelId: uint64(tunnelID),
				Limits:   limits,
				RouteAttestation: append(
					[]byte(nil),
					route.AttestationBytes...,
				),
				RelayNonce: relayNonce,
			},
		},
	}); err != nil {
		return
	}
	_ = socket.SetReadDeadline(time.Now().Add(tunnelIdleTimeout))

	rate := entry.rateLimiter
	readResult := make(chan error, 1)
	go func() {
		readResult <- h.forwardWebSocketToStation(
			ctx,
			socket,
			tunnel,
			uint64(tunnelID),
			limits,
			rate,
		)
	}()
	type receiveResult struct {
		data []byte
		err  error
	}
	stationResult := make(chan receiveResult, 1)
	go func() {
		for {
			data, receiveErr := tunnel.Receive(ctx)
			select {
			case stationResult <- receiveResult{data: data, err: receiveErr}:
			case <-tunnel.done:
				return
			case <-ctx.Done():
				return
			}
			if receiveErr != nil {
				return
			}
		}
	}()

	var sequence uint64 = 1
	for {
		select {
		case err := <-readResult:
			reason := closeReasonForError(err)
			tunnel.Cancel(reason)
			_ = writeOuterClose(socket, uint64(tunnelID), reason)
			return
		case result := <-stationResult:
			if result.err != nil {
				reason := closeReasonForError(result.err)
				_ = writeOuterClose(socket, uint64(tunnelID), reason)
				return
			}
			if !rate.allow(time.Now().Unix(), int64(len(result.data))) {
				_ = writeOuterClose(
					socket,
					uint64(tunnelID),
					federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_OVERLOADED,
				)
				return
			}
			if err := writeOuterTunnelFrame(socket, &federationmodel.RelayTunnelFrame{
				ProtocolVersion: relayTunnelProtocolVersion,
				Payload: &federationmodel.RelayTunnelFrame_Data{
					Data: &federationmodel.RelayTunnelData{
						TunnelId:   uint64(tunnelID),
						Sequence:   sequence,
						Ciphertext: result.data,
					},
				},
			}); err != nil {
				return
			}
			sequence++
			_ = socket.SetReadDeadline(time.Now().Add(tunnelIdleTimeout))
		case <-ctx.Done():
			return
		}
	}
}

func (h *relayHandler) authorizeTunnel(
	ctx context.Context,
	caller tunnelCaller,
	open *federationmodel.RelayTunnelOpen,
) (domain.RouteRecord, error) {
	switch open.GetPurpose() {
	case federationmodel.RelayTunnelPurpose_RELAY_TUNNEL_PURPOSE_CLIENT_ACCESS:
		if caller.mount != nil ||
			strings.TrimSpace(open.GetRouteId()) == "" ||
			open.GetRouteGeneration() == 0 ||
			strings.TrimSpace(open.GetTargetStationPeerId()) != "" {
			return domain.RouteRecord{}, application.ErrTunnelUnauthorized
		}
		if len(open.GetConnectionGrant()) > 0 {
			return h.sub.svc.AuthorizeClientTunnel(
				ctx,
				open.GetConnectionGrant(),
				open.GetRouteId(),
				open.GetRouteGeneration(),
			)
		}
		return h.sub.svc.AuthorizePublicTunnel(
			ctx,
			open.GetRouteId(),
			open.GetRouteGeneration(),
		)
	case federationmodel.RelayTunnelPurpose_RELAY_TUNNEL_PURPOSE_FEDERATION_PEER:
		if caller.mount == nil || len(open.GetConnectionGrant()) != 0 {
			return domain.RouteRecord{}, application.ErrTunnelUnauthorized
		}
		return h.sub.svc.AuthorizePeerTunnel(
			ctx,
			*caller.mount,
			open.GetTargetStationPeerId(),
			open.GetRouteId(),
			open.GetRouteGeneration(),
		)
	default:
		return domain.RouteRecord{}, application.ErrTunnelUnauthorized
	}
}

func (h *relayHandler) forwardWebSocketToStation(
	ctx context.Context,
	socket *serverWebSocket,
	tunnel *streamTunnel,
	tunnelID uint64,
	limits *federationmodel.RelayTunnelLimits,
	rate *tunnelRateLimiter,
) error {
	var sequence uint64 = 1
	var total uint64
	for {
		_ = socket.SetReadDeadline(time.Now().Add(tunnelIdleTimeout))
		frame, err := readOuterTunnelFrame(socket)
		if err != nil {
			return err
		}
		if data := frame.GetData(); data != nil {
			if data.GetTunnelId() != tunnelID ||
				data.GetSequence() != sequence ||
				len(data.GetCiphertext()) == 0 ||
				uint64(len(data.GetCiphertext())) > limits.GetMaxFrameBytes() {
				return ErrTunnelProtocol
			}
			total += uint64(len(data.GetCiphertext()))
			if total > limits.GetMaxRequestBytes() ||
				total > limits.GetMaxConnectionBytes() {
				return ErrTunnelOversize
			}
			if !rate.allow(time.Now().Unix(), int64(len(data.GetCiphertext()))) {
				return ErrTunnelOverloaded
			}
			if err := tunnel.Send(data.GetCiphertext()); err != nil {
				return err
			}
			sequence++
			continue
		}
		if cancel := frame.GetCancel(); cancel != nil {
			if cancel.GetTunnelId() != tunnelID {
				return ErrTunnelProtocol
			}
			return context.Canceled
		}
		if closeFrame := frame.GetClose(); closeFrame != nil {
			if closeFrame.GetTunnelId() != tunnelID {
				return ErrTunnelProtocol
			}
			return io.EOF
		}
		return ErrTunnelProtocol
	}
}

func (h *relayHandler) tunnelLimits(
	entry *streamEntry,
) *federationmodel.RelayTunnelLimits {
	directionLimit := uint64(entry.maxDirectionBytes)
	frameLimit := min(uint64(protocol.MaxTunnelDataLen), directionLimit)
	return &federationmodel.RelayTunnelLimits{
		MaxFrameBytes:      frameLimit,
		MaxRequestBytes:    directionLimit,
		MaxResponseBytes:   directionLimit,
		MaxConnectionBytes: directionLimit * 2,
		IdleTimeoutSeconds: uint32(tunnelIdleTimeout / time.Second),
		RateBytesPerSecond: uint32(entry.rateBytesPerSecond),
	}
}

func callerStationPeerID(caller tunnelCaller) string {
	if caller.mount == nil {
		return ""
	}
	return caller.mount.StationPeerID
}

func tunnelRequestSourceKey(request *app.RequestContext) string {
	return tunnelSourceKeyFromForwarded(
		request.RemoteAddr(),
		string(request.Request.Header.Peek("X-Forwarded-For")),
	)
}

func tunnelSourceKeyFromForwarded(remoteAddress net.Addr, forwarded string) string {
	if remoteAddress == nil || !isLoopbackAddress(remoteAddress.String()) {
		return tunnelSourceKey(remoteAddress)
	}
	if separator := strings.IndexByte(forwarded, ','); separator >= 0 {
		forwarded = forwarded[:separator]
	}
	if forwardedIP := net.ParseIP(strings.TrimSpace(forwarded)); forwardedIP != nil {
		return forwardedIP.String()
	}
	return tunnelSourceKey(remoteAddress)
}

func tunnelSourceKey(address net.Addr) string {
	if address == nil {
		return "unknown"
	}
	if tcpAddress, ok := address.(*net.TCPAddr); ok {
		if len(tcpAddress.IP) == 0 {
			return "unknown"
		}
		return tcpAddress.IP.String()
	}
	raw := strings.TrimSpace(address.String())
	host, _, err := net.SplitHostPort(raw)
	if err == nil {
		if ip := net.ParseIP(host); ip != nil {
			return ip.String()
		}
		return strings.ToLower(host)
	}
	if ip := net.ParseIP(raw); ip != nil {
		return ip.String()
	}
	if raw == "" {
		return "unknown"
	}
	return strings.ToLower(raw)
}

func readOuterTunnelFrame(
	socket *serverWebSocket,
) (*federationmodel.RelayTunnelFrame, error) {
	payload, err := socket.ReadBinary()
	if err != nil {
		return nil, err
	}
	if len(payload) == 0 || len(payload) > maxOuterTunnelFrameBytes {
		return nil, ErrTunnelOversize
	}
	frame := &federationmodel.RelayTunnelFrame{}
	if err := proto.Unmarshal(payload, frame); err != nil ||
		frame.GetProtocolVersion() != relayTunnelProtocolVersion ||
		len(frame.ProtoReflect().GetUnknown()) != 0 {
		return nil, ErrTunnelProtocol
	}
	return frame, nil
}

func writeOuterTunnelFrame(
	socket *serverWebSocket,
	frame *federationmodel.RelayTunnelFrame,
) error {
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(frame)
	if err != nil {
		return err
	}
	if len(payload) > maxOuterTunnelFrameBytes {
		return ErrTunnelOversize
	}
	return socket.WriteBinary(payload)
}

func writeOuterClose(
	socket *serverWebSocket,
	tunnelID uint64,
	reason federationmodel.RelayTunnelCloseReason,
) error {
	err := writeOuterTunnelFrame(socket, &federationmodel.RelayTunnelFrame{
		ProtocolVersion: relayTunnelProtocolVersion,
		Payload: &federationmodel.RelayTunnelFrame_Close{
			Close: &federationmodel.RelayTunnelClose{
				TunnelId: tunnelID,
				Reason:   reason,
			},
		},
	})
	_ = socket.WriteClose(1000, reason.String())
	return err
}

func closeReasonForError(
	err error,
) federationmodel.RelayTunnelCloseReason {
	switch {
	case err == nil, errors.Is(err, io.EOF):
		return federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_NORMAL
	case errors.Is(err, context.Canceled):
		return federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_CANCELLED
	case errors.Is(err, context.DeadlineExceeded):
		return federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_TIMEOUT
	case errors.Is(err, ErrTunnelOverloaded):
		return federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_OVERLOADED
	case errors.Is(err, ErrTunnelOversize):
		return federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_OVERSIZE
	case errors.Is(err, ErrTunnelProtocol):
		return federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_PROTOCOL_ERROR
	default:
		return federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_UNAVAILABLE
	}
}
