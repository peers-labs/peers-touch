package main

import (
	"crypto/rand"
	"flag"
	"fmt"
	"github.com/libp2p/go-libp2p/core/crypto"
	"log"
	"os"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/p2p/protocol/circuitv2/relay"
)

func main() {
	port := flag.Int("p", 4001, "Port to listen on")
	keyFile := flag.String("key", "node.key", "Path to private key file")
	flag.Parse()

	// Load or generate private key
	privKey, err := loadOrGenerateKey(*keyFile)
	if err != nil {
		log.Fatalf("Failed to handle private key: %v", err)
	}

	// Create host with custom identity
	h, err := libp2p.New(
		libp2p.ListenAddrStrings(fmt.Sprintf("/ip4/0.0.0.0/tcp/%d", *port)),
		libp2p.Identity(privKey),
	)

	// Create and start relay service
	_, err = relay.New(h)
	if err != nil {
		log.Fatalf("Failed to start relay service: %v", err)
	}

	// Print server information
	fmt.Println("Relay server running with:")
	fmt.Printf(" - Peer ID: %s\n", h.ID())
	for _, addr := range h.Addrs() {
		fmt.Printf(" - Address: %s/p2p/%s\n", addr, h.ID())
	}

	// Keep the server running
	select {}
}

func loadOrGenerateKey(keyFile string) (crypto.PrivKey, error) {
	// Try to load existing key
	if data, err := os.ReadFile(keyFile); err == nil {
		return crypto.UnmarshalPrivateKey(data)
	}

	// Generate new key
	privKey, _, err := crypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		return nil, err
	}

	// Save the key
	data, err := crypto.MarshalPrivateKey(privKey)
	if err != nil {
		return nil, err
	}

	if err := os.WriteFile(keyFile, data, 0600); err != nil {
		return nil, err
	}

	return privKey, nil
}
