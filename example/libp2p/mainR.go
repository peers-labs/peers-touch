package main

import (
	"context"
	"crypto/rand"
	"flag"
	"fmt"
	"github.com/libp2p/go-libp2p/core/host"
	"log"
	"time"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	ma "github.com/multiformats/go-multiaddr"
)

func main() {
	bootstrapAddr := flag.String("b", "/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWNkwN8YVfM1vTuBGMbq7roouSTobJrSNM4RXvYWgHsr2r", "Bootstrap node address")
	relayAddr := flag.String("r", "/ip4/127.0.0.1/tcp/4002/p2p/12D3KooWNkwN8YVfM1vTuBGMbq7roouSTobJrSNM4RXvYWgHsr2r", "Relay node address")
	port := flag.Int("p", 0, "Network port (0 for random)")
	flag.Parse()

	// Generate a new key for this node
	privKey, _, err := crypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		log.Fatal(err)
	}

	// Create host
	host, err := libp2p.New(
		libp2p.ListenAddrStrings(fmt.Sprintf("/ip4/0.0.0.0/tcp/%d", *port)),
		libp2p.Identity(privKey),
		libp2p.EnableRelay(),
	)
	if err != nil {
		log.Fatal(err)
	}

	// Connect to bootstrap
	if err := connectToPeer(host, *bootstrapAddr); err != nil {
		log.Fatal(err)
	}
	fmt.Println("Connected to bootstrap node")

	// Connect to relay
	if err := connectToPeer(host, *relayAddr); err != nil {
		log.Fatal(err)
	}
	fmt.Println("Connected to relay node")

	// Print node information
	fmt.Println("Normal node running with:")
	fmt.Printf(" - Peer ID: %s\n", host.ID())
	for _, addr := range host.Addrs() {
		fmt.Printf(" - Address: %s/p2p/%s\n", addr, host.ID())
	}

	// Keep the node running
	select {}
}

func connectToPeer(h host.Host, addr string) error {
	maddr, err := ma.NewMultiaddr(addr)
	if err != nil {
		return err
	}

	peerInfo, err := peer.AddrInfoFromP2pAddr(maddr)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	return h.Connect(ctx, *peerInfo)
}
