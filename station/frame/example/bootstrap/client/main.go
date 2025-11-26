package main

import (
	"context"
	"fmt"
	"os"
	"time"

	libp2p "github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/peer"
	ping "github.com/libp2p/go-libp2p/p2p/protocol/ping"
	"github.com/multiformats/go-multiaddr"
)

// A lightweight libp2p client for quickly testing bootstrap connectivity.
// Usage:
//
//	BOOTSTRAP_MULTIADDR="/ip4/127.0.0.1/tcp/4001/p2p/<PeerID>" go run .
//
// or
//
//	go run . "/ip4/127.0.0.1/tcp/4001/p2p/<PeerID>"
func main() {
	addr := os.Getenv("BOOTSTRAP_MULTIADDR")
	if addr == "" && len(os.Args) > 1 {
		addr = os.Args[1]
	}
	if addr == "" {
		fmt.Println("[USAGE] BOOTSTRAP_MULTIADDR=<multiaddr> go run .  (or pass multiaddr as first arg)")
		os.Exit(2)
	}

	maddr, err := multiaddr.NewMultiaddr(addr)
	if err != nil {
		fmt.Printf("[ERROR] invalid multiaddr: %v\n", err)
		os.Exit(1)
	}
	pi, err := peer.AddrInfoFromP2pAddr(maddr)
	if err != nil {
		fmt.Printf("[ERROR] invalid p2p multiaddr: %v\n", err)
		os.Exit(1)
	}

	// Create a minimal libp2p host
	h, err := libp2p.New()
	if err != nil {
		fmt.Printf("[ERROR] libp2p new: %v\n", err)
		os.Exit(1)
	}
	defer func() { _ = h.Close() }()

	fmt.Printf("[CLIENT] local_peer=%s\n", h.ID().String())
	fmt.Printf("[CLIENT] dialing=%s, addrs=%v\n", pi.ID.String(), pi.Addrs)

	// Connect with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := h.Connect(ctx, *pi); err != nil {
		fmt.Printf("[CONNECT] error: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("[CONNECT] success -> %s\n", pi.ID.String())

	// Optional: Ping the remote if supported
	pinger := ping.NewPingService(h)
	pingCtx, pingCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer pingCancel()
	resCh := pinger.Ping(pingCtx, pi.ID)
	select {
	case res, ok := <-resCh:
		if ok {
			fmt.Printf("[PING] rtt=%s\n", res.RTT)
		} else {
			fmt.Println("[PING] no response (channel closed)")
		}
	case <-pingCtx.Done():
		fmt.Println("[PING] timeout or unsupported")
	}

	// Heartbeats to observe connection state
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for i := 0; i < 3; i++ {
		<-ticker.C
		conns := h.Network().ConnsToPeer(pi.ID)
		fmt.Printf("[HEARTBEAT] t=%s conn_count=%d\n", time.Now().Format(time.RFC3339), len(conns))
	}

	fmt.Println("[DONE] test completed")
}
