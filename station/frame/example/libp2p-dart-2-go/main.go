package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"

	libp2p "github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/protocol"
	"github.com/libp2p/go-libp2p/p2p/muxer/yamux"
	"github.com/multiformats/go-multiaddr"
)

func main() {
	ctx := context.Background()

	port := os.Getenv("LIBP2P_PORT")
	if port == "" {
		port = "5001"
	}

	listen, err := multiaddr.NewMultiaddr("/ip4/0.0.0.0/tcp/" + port)
	if err != nil {
		log.Fatalf("listen multiaddr error: %v", err)
	}

	h, err := libp2p.New(
		libp2p.ListenAddrs(listen),
		libp2p.NoSecurity, // Disable security to match Dart client's Plaintext mode
		libp2p.Muxer("/yamux/1.0.0", yamux.DefaultTransport),
	)
	if err != nil {
		log.Fatalf("libp2p.New error: %v", err)
	}
	defer h.Close()

	h.SetStreamHandler(protocol.ID("/my-protocol/1.0.0"), func(s network.Stream) {
		defer s.Close()
		buf := make([]byte, 4096)
		n, err := s.Read(buf)
		if err != nil && err != io.EOF {
			log.Printf("read error: %v", err)
			return
		}
		msg := string(buf[:n])
		log.Printf("received: %s", msg)
		_, _ = s.Write([]byte("echo: " + msg))
	})

	if len(h.Addrs()) > 0 {
		fmt.Printf("Peer ID: %s\n", h.ID().String())
		fmt.Printf("Dial Multiaddr: %s/p2p/%s\n", h.Addrs()[0].String(), h.ID().String())
	}

	target := os.Getenv("TARGET_MULTIADDR")
	if target != "" {
		maddr, err := multiaddr.NewMultiaddr(target)
		if err != nil {
			log.Fatalf("invalid TARGET_MULTIADDR: %v", err)
		}
		info, err := peer.AddrInfoFromP2pAddr(maddr)
		if err != nil {
			log.Fatalf("parse p2p addr error: %v", err)
		}
		if err := h.Connect(ctx, *info); err != nil {
			log.Fatalf("connect error: %v", err)
		}
		s, err := h.NewStream(ctx, info.ID, protocol.ID("/my-protocol/1.0.0"))
		if err != nil {
			log.Fatalf("new stream error: %v", err)
		}
		defer s.Close()
		if _, err := s.Write([]byte("Hello from go-libp2p!")); err != nil {
			log.Fatalf("write error: %v", err)
		}
		buf := make([]byte, 4096)
		n, err := s.Read(buf)
		if err != nil && err != io.EOF {
			log.Fatalf("read error: %v", err)
		}
		fmt.Printf("Response: %s\n", string(buf[:n]))
		return
	}

	<-ctx.Done()
}
