package relay

// stream_broadcast_test.go validates the StreamManager's fan-out
// behaviour for Tier C1 broadcast frames in isolation from the rest
// of the relay subserver. We exercise the public API surface that
// the Tier C1 wiring depends on:
//
//   1. Inbound Broadcast on stream A is fanned out to streams B and
//      C (but NOT echoed back to A).
//   2. The fan-out frame carries the publisher's authenticated peer
//      id, regardless of what the publisher claimed in the inbound
//      frame's origin field.
//   3. Off-policy topics (not in the allow-list) are silently dropped
//      with a warn log — no broadcast goes out.
//
// We use net.Pipe pairs so each "station" reads its own end of a
// purely in-memory full-duplex byte stream — no sockets, no goroutine
// race against the OS network stack.

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/protocol"
)

// fakeStation pairs a net.Pipe end "owned" by the station with the
// peerID we register for it on the relay side. The station goroutine
// reads frames off `stationConn` and exposes them via a channel.
type fakeStation struct {
	peerID      string
	stationConn net.Conn
	relayConn   net.Conn
	frames      chan *protocol.BroadcastFrame
}

func newFakeStation(t *testing.T, peerID string) *fakeStation {
	t.Helper()
	s, c := net.Pipe()
	fs := &fakeStation{
		peerID:      peerID,
		stationConn: s,
		relayConn:   c,
		frames:      make(chan *protocol.BroadcastFrame, 4),
	}
	go fs.readLoop()
	return fs
}

func (fs *fakeStation) readLoop() {
	defer close(fs.frames)
	for {
		f, err := protocol.ReadFrame(fs.stationConn)
		if err != nil {
			return
		}
		bf, ok := f.(*protocol.BroadcastFrame)
		if !ok {
			continue
		}
		fs.frames <- bf
	}
}

// publish writes a Broadcast frame on the station→relay leg. The
// `origin` field is set to a deliberately bogus value so we can prove
// the relay overwrites it with the authenticated peer id before
// fan-out.
func (fs *fakeStation) publish(t *testing.T, topic, claimedOrigin string, body []byte) {
	t.Helper()
	if err := protocol.WriteBroadcastFrame(fs.stationConn, topic, claimedOrigin, body); err != nil {
		t.Fatalf("publish: %v", err)
	}
}

// expectFrame waits for one frame on the station's read channel,
// failing the test on timeout. Used by the receiving stations.
func (fs *fakeStation) expectFrame(t *testing.T) *protocol.BroadcastFrame {
	t.Helper()
	select {
	case f, ok := <-fs.frames:
		if !ok {
			t.Fatal("station channel closed before a frame arrived")
		}
		return f
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for broadcast frame")
		return nil
	}
}

// expectNoFrame asserts no frame arrives within a short window. Used
// to confirm "publishers don't receive their own broadcast".
func (fs *fakeStation) expectNoFrame(t *testing.T, within time.Duration) {
	t.Helper()
	select {
	case f, ok := <-fs.frames:
		if ok {
			t.Fatalf("unexpected frame: topic=%s origin=%s body_len=%d",
				f.Topic, f.OriginPeerID, len(f.Body))
		}
	case <-time.After(within):
	}
}

func TestStreamManager_BroadcastFanOut(t *testing.T) {
	const topic = "fed.invalidate.v1"
	const body = "invalidation-bytes"

	a := newFakeStation(t, "peer-A")
	b := newFakeStation(t, "peer-B")
	c := newFakeStation(t, "peer-C")
	defer a.stationConn.Close()
	defer b.stationConn.Close()
	defer c.stationConn.Close()

	sm := NewStreamManager(nil, 4)
	sm.SetAllowedBroadcastTopics(topic)

	ctx := context.Background()
	expiresAt := time.Now().Add(time.Hour)
	sm.Add(ctx, a.peerID, 1, expiresAt, a.relayConn)
	sm.Add(ctx, b.peerID, 1, expiresAt, b.relayConn)
	sm.Add(ctx, c.peerID, 1, expiresAt, c.relayConn)

	// A publishes; lie about the origin so we can prove the relay
	// rewrites it to the authenticated peer id.
	a.publish(t, topic, "FORGED-ORIGIN", []byte(body))

	bf := b.expectFrame(t)
	cf := c.expectFrame(t)

	for _, got := range []*protocol.BroadcastFrame{bf, cf} {
		if got.Topic != topic {
			t.Errorf("topic mismatch: got %q want %q", got.Topic, topic)
		}
		if got.OriginPeerID != a.peerID {
			t.Errorf("origin mismatch: got %q want %q (relay must stamp authenticated peer id)",
				got.OriginPeerID, a.peerID)
		}
		if string(got.Body) != body {
			t.Errorf("body mismatch: got %q want %q", got.Body, body)
		}
	}

	// A must NOT receive its own broadcast.
	a.expectNoFrame(t, 100*time.Millisecond)

	sm.DrainAndClose(ctx, time.Second)
}

func TestStreamManager_BroadcastDropsDisallowedTopic(t *testing.T) {
	a := newFakeStation(t, "peer-A")
	b := newFakeStation(t, "peer-B")
	defer a.stationConn.Close()
	defer b.stationConn.Close()

	sm := NewStreamManager(nil, 4)
	// allow-list deliberately empty → every topic is disallowed.

	ctx := context.Background()
	expiresAt := time.Now().Add(time.Hour)
	sm.Add(ctx, a.peerID, 1, expiresAt, a.relayConn)
	sm.Add(ctx, b.peerID, 1, expiresAt, b.relayConn)

	a.publish(t, "rogue.topic.v1", "", []byte("payload"))

	// B must receive nothing — relay drops the off-policy publish.
	b.expectNoFrame(t, 150*time.Millisecond)

	sm.DrainAndClose(ctx, time.Second)
}

func TestStreamManagerClosesExpiredCredential(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	relayConn, stationConn := net.Pipe()
	defer stationConn.Close()

	manager := NewStreamManager(nil, 1)
	manager.Add(
		ctx,
		"peer-expired",
		3,
		time.Now().Add(-time.Second),
		relayConn,
	)
	if cleaned := manager.PingAll(
		ctx,
		time.Second,
		time.Second,
	); cleaned != 1 {
		t.Fatalf("cleaned streams = %d, want 1", cleaned)
	}
	if manager.Count() != 0 {
		t.Fatalf("active streams = %d, want 0", manager.Count())
	}
}

func TestStreamManagerValidatedAddIsClosedByConcurrentRemoval(t *testing.T) {
	ctx := context.Background()
	relayConn, stationConn := net.Pipe()
	defer stationConn.Close()

	manager := NewStreamManager(nil, 1)
	validationStarted := make(chan struct{})
	releaseValidation := make(chan struct{})
	addDone := make(chan struct{})
	var entry *streamEntry
	var addErr error
	go func() {
		entry, addErr = manager.AddValidated(
			ctx,
			"peer-racing-revoke",
			7,
			time.Now().Add(time.Hour),
			relayConn,
			streamLimits{},
			func() error {
				close(validationStarted)
				<-releaseValidation
				return nil
			},
		)
		close(addDone)
	}()

	<-validationStarted
	removeDone := make(chan struct{})
	go func() {
		manager.Remove(ctx, "peer-racing-revoke")
		close(removeDone)
	}()
	select {
	case <-removeDone:
		t.Fatal("remove bypassed the in-progress admission")
	case <-time.After(20 * time.Millisecond):
	}

	close(releaseValidation)
	<-addDone
	<-removeDone
	if addErr != nil {
		t.Fatalf("validated add: %v", addErr)
	}
	if entry == nil || !entry.closed.Load() {
		t.Fatal("concurrently revoked stream survived admission")
	}
	if manager.Count() != 0 {
		t.Fatalf("active streams = %d, want 0", manager.Count())
	}
}

func TestStreamManagerValidatedAddRejectsStaleCredentialBeforeReadLoop(t *testing.T) {
	ctx := context.Background()
	relayConn, stationConn := net.Pipe()
	defer relayConn.Close()
	defer stationConn.Close()

	manager := NewStreamManager(nil, 1)
	stale := errors.New("stale credential")
	entry, err := manager.AddValidated(
		ctx,
		"peer-stale",
		3,
		time.Now().Add(time.Hour),
		relayConn,
		streamLimits{},
		func() error { return stale },
	)
	if !errors.Is(err, stale) {
		t.Fatalf("validated add error = %v, want %v", err, stale)
	}
	if entry != nil {
		t.Fatal("stale credential created a stream entry")
	}
	if manager.Count() != 0 {
		t.Fatalf("active streams = %d, want 0", manager.Count())
	}
}
