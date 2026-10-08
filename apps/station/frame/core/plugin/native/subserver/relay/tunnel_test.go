package relay

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"

	federationmodel "github.com/peers-labs/peers-touch/station/frame/core/federation/model"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/protocol"
)

func TestTunnelAdmissionEnforcesAndReleasesAllDimensions(t *testing.T) {
	admission := newTunnelAdmission(2, 1, 1)
	release, ok := admission.acquire("source-a", "route-a")
	if !ok {
		t.Fatal("first tunnel was rejected")
	}
	if _, ok := admission.acquire("source-a", "route-b"); ok {
		t.Fatal("per-source limit was bypassed")
	}
	if _, ok := admission.acquire("source-b", "route-a"); ok {
		t.Fatal("per-route limit was bypassed")
	}
	secondRelease, ok := admission.acquire("source-b", "route-b")
	if !ok {
		t.Fatal("independent second tunnel was rejected")
	}
	if _, ok := admission.acquire("source-c", "route-c"); ok {
		t.Fatal("global limit was bypassed")
	}

	release()
	release()
	thirdRelease, ok := admission.acquire("source-a", "route-a")
	if !ok {
		t.Fatal("released admission was not reusable")
	}
	thirdRelease()
	secondRelease()
}

func TestTunnelRateLimiterResetsOnlyAtWindowBoundary(t *testing.T) {
	limiter := newTunnelRateLimiter(10)
	if !limiter.allow(100, 6) || limiter.allow(100, 5) {
		t.Fatal("rate limiter did not enforce the active window")
	}
	if !limiter.allow(101, 10) {
		t.Fatal("rate limiter did not reset at the next window")
	}
	if limiter.allow(101, -1) {
		t.Fatal("rate limiter accepted a negative byte count")
	}
}

func TestTunnelSourceKeyIgnoresEphemeralPort(t *testing.T) {
	first := tunnelSourceKey(&net.TCPAddr{
		IP:   net.ParseIP("192.0.2.10"),
		Port: 41000,
	})
	second := tunnelSourceKey(&net.TCPAddr{
		IP:   net.ParseIP("192.0.2.10"),
		Port: 42000,
	})
	if first != "192.0.2.10" || second != first {
		t.Fatalf("source keys differ across ports: %q != %q", first, second)
	}
	ipv6 := tunnelSourceKey(testTunnelAddr("[2001:db8::1]:43000"))
	if ipv6 != "2001:db8::1" {
		t.Fatalf("IPv6 source key = %q", ipv6)
	}
}

func TestTunnelSourceKeyTrustsForwardedAddressOnlyFromLoopbackProxy(t *testing.T) {
	t.Parallel()

	proxied := tunnelSourceKeyFromForwarded(
		&net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 41000},
		"192.0.2.10, 127.0.0.1",
	)
	if proxied != "192.0.2.10" {
		t.Fatalf("proxied source key = %q", proxied)
	}
	direct := tunnelSourceKeyFromForwarded(
		&net.TCPAddr{IP: net.ParseIP("198.51.100.20"), Port: 42000},
		"192.0.2.10",
	)
	if direct != "198.51.100.20" {
		t.Fatalf("direct source key trusted spoofed forwarding header: %q", direct)
	}
}

func TestStreamEntryRateLimiterAggregatesConcurrentTunnels(t *testing.T) {
	relayConn, stationConn := net.Pipe()
	defer relayConn.Close()
	defer stationConn.Close()

	entry := newStreamEntry(
		context.Background(),
		"station-target",
		1,
		time.Now().Add(time.Hour),
		relayConn,
		2,
		1024,
		10,
		nil,
	)
	if !entry.rateLimiter.allow(100, 6) {
		t.Fatal("first tunnel was rejected")
	}
	if entry.rateLimiter.allow(100, 5) {
		t.Fatal("second tunnel bypassed the shared Station budget")
	}
	if !entry.rateLimiter.allow(101, 10) {
		t.Fatal("shared Station budget did not reset")
	}
}

func TestStreamTunnelMultiplexesAndReleasesCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	relayConn, stationConn := net.Pipe()
	defer stationConn.Close()

	entry := newStreamEntry(
		ctx,
		"station-target",
		7,
		time.Now().Add(time.Hour),
		relayConn,
		2,
		1024,
		1024,
		nil,
	)
	entry.start()
	stationResult := make(chan error, 1)
	go func() {
		frame, err := protocol.ReadFrame(stationConn)
		if err != nil {
			stationResult <- err
			return
		}
		open, ok := frame.(*protocol.TunnelOpenFrame)
		if !ok ||
			open.TunnelID != 9 ||
			open.RouteID != "route-1" ||
			open.RouteGeneration != 7 ||
			open.CallerStationPeerID != "station-source" {
			stationResult <- ErrTunnelProtocol
			return
		}
		if err := protocol.WriteTunnelOpened(stationConn, open.TunnelID); err != nil {
			stationResult <- err
			return
		}
		frame, err = protocol.ReadFrame(stationConn)
		if err != nil {
			stationResult <- err
			return
		}
		data, ok := frame.(*protocol.TunnelDataFrame)
		if !ok || data.Sequence != 1 || string(data.Data) != "request" {
			stationResult <- ErrTunnelProtocol
			return
		}
		if err := protocol.WriteTunnelData(
			stationConn,
			open.TunnelID,
			1,
			[]byte("response"),
		); err != nil {
			stationResult <- err
			return
		}
		frame, err = protocol.ReadFrame(stationConn)
		if err != nil {
			stationResult <- err
			return
		}
		terminal, ok := frame.(*protocol.TunnelCancelFrame)
		if !ok ||
			terminal.Reason !=
				federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_CANCELLED {
			stationResult <- ErrTunnelProtocol
			return
		}
		stationResult <- nil
	}()

	tunnel, err := entry.OpenTunnel(
		ctx,
		9,
		"route-1",
		7,
		"station-source",
		federationmodel.RelayTunnelPurpose_RELAY_TUNNEL_PURPOSE_FEDERATION_PEER,
		time.Second,
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := tunnel.Send([]byte("request")); err != nil {
		t.Fatal(err)
	}
	response, err := tunnel.Receive(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if string(response) != "response" {
		t.Fatalf("response = %q", response)
	}
	tunnel.Cancel(
		federationmodel.RelayTunnelCloseReason_RELAY_TUNNEL_CLOSE_REASON_CANCELLED,
	)
	if entry.tunnel(9) != nil {
		t.Fatal("cancelled tunnel remained registered")
	}
	if err := <-stationResult; err != nil {
		t.Fatal(err)
	}
	entry.Close()
	entry.Wait()
}

func TestStreamTunnelRejectsOversizeSequenceAndQueueGrowth(t *testing.T) {
	tunnel := newStreamTunnel(nil, 1, 4)
	if err := tunnel.acceptData(&protocol.TunnelDataFrame{
		TunnelID: 1,
		Sequence: 1,
		Data:     []byte("12345"),
	}); !errors.Is(err, ErrTunnelOversize) {
		t.Fatalf("oversize error = %v", err)
	}

	tunnel = newStreamTunnel(nil, 1, tunnelQueueDepth+1)
	for sequence := uint64(1); sequence <= tunnelQueueDepth; sequence++ {
		if err := tunnel.acceptData(&protocol.TunnelDataFrame{
			TunnelID: 1,
			Sequence: sequence,
			Data:     []byte{byte(sequence)},
		}); err != nil {
			t.Fatalf("fill queue sequence %d: %v", sequence, err)
		}
	}
	if err := tunnel.acceptData(&protocol.TunnelDataFrame{
		TunnelID: 1,
		Sequence: tunnelQueueDepth + 1,
		Data:     []byte("x"),
	}); !errors.Is(err, ErrTunnelOverloaded) {
		t.Fatalf("queue overflow error = %v", err)
	}
	tunnel.finish()
	if err := tunnel.acceptData(&protocol.TunnelDataFrame{
		TunnelID: 1,
		Sequence: tunnelQueueDepth + 2,
		Data:     []byte("x"),
	}); !errors.Is(err, ErrTunnelProtocol) {
		t.Fatalf("late data error = %v", err)
	}
}

func TestStreamTunnelDrainsBufferedDataBeforeTerminalState(t *testing.T) {
	tunnel := newStreamTunnel(nil, 1, 16)
	if err := tunnel.acceptData(&protocol.TunnelDataFrame{
		TunnelID: 1,
		Sequence: 1,
		Data:     []byte("final"),
	}); err != nil {
		t.Fatal(err)
	}
	tunnel.finish()
	data, err := tunnel.Receive(context.Background())
	if err != nil || string(data) != "final" {
		t.Fatalf("buffered terminal data=%q err=%v", data, err)
	}
	if _, err := tunnel.Receive(context.Background()); !errors.Is(
		err,
		ErrStreamDisconnected,
	) {
		t.Fatalf("terminal receive error = %v", err)
	}
}

func TestHealthyLongLivedStreamSurvivesAgeCleanup(t *testing.T) {
	ctx := context.Background()
	relayConn, stationConn := net.Pipe()
	defer stationConn.Close()

	manager := NewStreamManager(nil, 1)
	entry, err := manager.AddValidated(
		ctx,
		"station-long-lived",
		3,
		time.Now().Add(time.Hour),
		relayConn,
		streamLimits{
			maxConcurrent:      1,
			maxDirectionBytes:  512,
			rateBytesPerSecond: 321,
		},
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	entry.lastPong.Store(time.Now())
	if removed := manager.CleanupStale(
		ctx,
		time.Now().Add(-time.Minute),
	); removed != 0 {
		t.Fatalf("healthy long-lived streams removed = %d", removed)
	}
	if manager.Count() != 1 {
		t.Fatalf("active streams = %d, want 1", manager.Count())
	}
	if cap(entry.semaphore) != 1 ||
		entry.maxDirectionBytes != 512 ||
		entry.rateBytesPerSecond != 321 {
		t.Fatalf(
			"mount tunnel limits were not retained: concurrent=%d bytes=%d rate=%d",
			cap(entry.semaphore),
			entry.maxDirectionBytes,
			entry.rateBytesPerSecond,
		)
	}
	limits := (&relayHandler{}).tunnelLimits(entry)
	if limits.GetMaxRequestBytes() != 512 ||
		limits.GetMaxResponseBytes() != 512 ||
		limits.GetMaxConnectionBytes() != 1024 ||
		limits.GetRateBytesPerSecond() != 321 {
		t.Fatalf("advertised tunnel limits = %+v", limits)
	}
	manager.DrainAndClose(ctx, time.Second)
}

type testTunnelAddr string

func (a testTunnelAddr) Network() string {
	return "tcp"
}

func (a testTunnelAddr) String() string {
	return string(a)
}
