package native

import (
	"testing"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
)

func TestBootstrapBackoffStateTransitions(t *testing.T) {
	r := &nativeRegistry{
		bootstrapActive:  make(map[peer.ID]*bootstrapNode),
		bootstrapBackoff: make(map[peer.ID]*bootstrapNode),
		extOpts:          &options{bootstrapNodeRetryTimes: 5},
	}

	// create a sample peer addr
	addr, _ := multiaddr.NewMultiaddr("/ip4/127.0.0.1/tcp/4001")
	p := peer.ID("12D3KooWTestPeer")
	r.addBootstrapInfo(peer.AddrInfo{ID: p, Addrs: []multiaddr.Multiaddr{addr}})

	// fail 5 times -> move to backoff
	for i := 0; i < 5; i++ {
		r.onBootstrapResult(p, false)
	}
	if _, ok := r.bootstrapBackoff[p]; !ok {
		t.Fatalf("expected peer in backoff after 5 failures")
	}
	if _, ok := r.bootstrapActive[p]; ok {
		t.Fatalf("peer should not be in active after backoff")
	}

	// set nextRetry to past and ensure dueBackoffPeers returns it
	r.bootstrapBackoff[p].nextRetry = time.Now().Add(-time.Minute)
	due := r.dueBackoffPeers()
	found := false
	for _, pi := range due {
		if pi.ID == p {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected peer in due backoff list")
	}

	// success -> promote to active
	r.onBootstrapResult(p, true)
	if _, ok := r.bootstrapActive[p]; !ok {
		t.Fatalf("expected peer promoted to active on success")
	}
	if r.bootstrapActive[p].failCount != 0 {
		t.Fatalf("expected failCount reset on success")
	}
}

func TestBootstrapPeersFuncFallback(t *testing.T) {
	r := &nativeRegistry{
		bootstrapActive:  make(map[peer.ID]*bootstrapNode),
		bootstrapBackoff: make(map[peer.ID]*bootstrapNode),
		extOpts:          &options{bootstrapNodes: []multiaddr.Multiaddr{}},
	}
	// when active is empty, fallback should return default peers
	peers := r.getActiveBootstrapPeers()
	if len(peers) != 0 {
		t.Fatalf("expected empty active peers initially")
	}
	// we don't call the actual BootstrapPeersFunc here; just ensure helper reflects empty state
}
