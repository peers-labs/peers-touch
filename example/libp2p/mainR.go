package main

// ... existing imports ...
import (
	"bufio"
	"context"
	"crypto/rand"
	"flag"
	"fmt"
	"github.com/libp2p/go-libp2p/core/crypto"
	"log"
	"os"
	"time"

	"github.com/libp2p/go-libp2p"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p/core/control"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/p2p/discovery/routing"
	"github.com/libp2p/go-libp2p/p2p/discovery/util"
	"github.com/libp2p/go-libp2p/p2p/host/autonat"
	"github.com/libp2p/go-libp2p/p2p/muxer/yamux"
	"github.com/libp2p/go-libp2p/p2p/protocol/circuitv2/relay"
	"github.com/libp2p/go-libp2p/p2p/security/noise"
	"github.com/libp2p/go-libp2p/p2p/transport/tcp"
	ma "github.com/multiformats/go-multiaddr"
)

var staticRelays = []peer.AddrInfo{
	{
		ID: mustDecodePeerID("12D3KooWQ44fTG1wHJ1XLogKYMfGyT7Wjducfm1m9RY5C2Xd6gmG"),
		Addrs: []ma.Multiaddr{
			mustDecodeMultiaddr("/ip4/127.0.0.1/tcp/4002"), // /ip4/127.0.0.1/tcp/4001/p2p/12D3KooWQ44fTG1wHJ1XLogKYMfGyT7Wjducfm1m9RY5C2Xd6gmG
		},
	},
}

var publicRelays = []string{}

func main() {
	regMode := flag.Bool("r", false, "Run as registry node")
	bootstrapAddr := flag.String("b", "", "Bootstrap node address")
	port := flag.Int("p", 4001, "Network port")
	generateKey := flag.Bool("key", false, "Generate a new key")
	keyName := flag.String("keyName", "node.key", "Name for the generated key file")

	flag.Parse()

	// Generate key if requested
	if *generateKey {
		if err := generateAndSaveKey(*keyName); err != nil {
			log.Fatalf("Failed to generate key: %v", err)
		}
		fmt.Printf("Generated new key: %s\n", *keyName)
		return
	}

	// Load or generate private key
	privKey, err := loadOrGenerateKey(*keyName)
	if err != nil {
		log.Fatalf("Failed to handle private key: %v", err)
	}

	// Create host with security and transport
	host := createHost(*port, *regMode, privKey)

	// Add after host creation
	if !*regMode {
		publicAddr := getPublicAddress(host)
		if publicAddr != "" {
			fmt.Printf("Public address: %s/p2p/%s\n", publicAddr, host.ID())
		}
	}

	// Initialize DHT based on mode
	var kdht *dht.IpfsDHT
	if *regMode {
		fmt.Printf("Running as registry node: %s\n", getMultiaddr(host))
		kdht = initDHT(context.Background(), host, dht.ModeServer)
	} else {
		kdht = initDHT(context.Background(), host, dht.ModeClient)
	}

	// Setup chat protocol
	host.SetStreamHandler("/chat/1.0.0", func(s network.Stream) {
		defer s.Close()
		buf := bufio.NewReader(s)
		str, err := buf.ReadString('\n')
		if err != nil {
			return
		}
		fmt.Printf("\n[%s] %s", s.Conn().RemotePeer(), str)
	})

	// Connect to bootstrap if specified
	if *bootstrapAddr != "" {
		connectToBootstrap(host, *bootstrapAddr)
	}

	// Start peer discovery
	discovery := routing.NewRoutingDiscovery(kdht)
	util.Advertise(context.Background(), discovery, "peers-network")
	go discoverPeers(host, discovery)

	// Add to main function after peer discovery setup
	go sendMessages(host)

	select {}
}

func createHost(port int, regMode bool, privKey crypto.PrivKey) host.Host {
	opts := []libp2p.Option{
		libp2p.ListenAddrStrings(fmt.Sprintf("/ip4/0.0.0.0/tcp/%d", port)),
		libp2p.Identity(privKey),
		libp2p.Security(noise.ID, noise.New),
		libp2p.Transport(tcp.NewTCPTransport),
		libp2p.Muxer("/yamux/1.0.0", yamux.DefaultTransport),
		libp2p.EnableNATService(),                            // Enable NAT service
		libp2p.EnableRelay(),                                 // Enable relay service
		libp2p.EnableAutoRelayWithStaticRelays(staticRelays), // Enable auto relay
		libp2p.Ping(true),
		libp2p.ConnectionGater(&blockAllGater{}), // Add connection gater
	}

	if regMode {
		opts = append(opts, libp2p.NATPortMap())
	}

	h, err := libp2p.New(opts...)
	if err != nil {
		log.Fatal(err)
	}

	// Add NAT status logging
	if nat, err := autonat.New(h); err == nil {
		status := nat.Status()
		fmt.Printf("NAT status: %s\n", status)
	}

	// Add relay info logging
	if relayService, err := relay.New(h); err == nil {
		fmt.Printf("Relay service enabled: %v\n", relayService != nil)
	}

	return h
}

// Add to existing functions
func initDHT(ctx context.Context, h host.Host, mode dht.ModeOpt) *dht.IpfsDHT {
	kdht, err := dht.New(ctx, h, dht.Mode(mode))
	if err != nil {
		log.Fatal(err)
	}

	if err = kdht.Bootstrap(ctx); err != nil {
		log.Fatal(err)
	}
	return kdht
}

func connectToBootstrap(h host.Host, addr string) {
	targetAddr, err := ma.NewMultiaddr(addr)
	if err != nil {
		log.Fatal(err)
	}

	targetInfo, err := peer.AddrInfoFromP2pAddr(targetAddr)
	if err != nil {
		log.Fatal(err)
	}

	if err := h.Connect(context.Background(), *targetInfo); err != nil {
		log.Fatal(err)
	}
}

func discoverPeers(h host.Host, discovery *routing.RoutingDiscovery) {
	for {
		peerChan, err := discovery.FindPeers(context.Background(), "peers-network")
		if err != nil {
			log.Fatal(err)
		}

		for peer := range peerChan {
			if peer.ID == h.ID() || len(peer.Addrs) == 0 {
				continue
			}

			// Add relay addresses
			relayAddr, _ := ma.NewMultiaddr(fmt.Sprintf("/p2p/%s/p2p-circuit", peer.ID))
			peer.Addrs = append(peer.Addrs, relayAddr)

			fmt.Printf("Discovered new peer: %s\n", peer.ID)
			connectWithBackoff(h, peer)
		}

		time.Sleep(1 * time.Minute)
	}
}

func connectWithBackoff(h host.Host, p peer.AddrInfo) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second) // Increased timeout
	defer cancel()

	// Skip if already connected
	if h.Network().Connectedness(p.ID) == network.Connected {
		return
	}

	// Try connecting with each address
	for _, addr := range p.Addrs {
		fmt.Printf("Attempting to connect to %s via %s\n", p.ID, addr)
		targetInfo := peer.AddrInfo{
			ID:    p.ID,
			Addrs: []ma.Multiaddr{addr},
		}

		if err := h.Connect(ctx, targetInfo); err != nil {
			fmt.Printf("Connection failed to %s via %s: %v\n", p.ID, addr, err)
			continue
		}
		fmt.Printf("Successfully connected to: %s via %s\n", p.ID, addr)
		return
	}
}

func getMultiaddr(h host.Host) string {
	return fmt.Sprintf("%s/p2p/%s", h.Addrs()[0], h.ID())
}

// Add these new functions
func sendMessages(h host.Host) {
	scanner := bufio.NewScanner(os.Stdin)
	for {
		fmt.Print("> ")
		scanner.Scan()
		msg := scanner.Text() + "\n"

		// Send to all connected peers
		for _, peer := range h.Network().Peers() {
			if peer == h.ID() {
				continue
			}

			s, err := h.NewStream(context.Background(), peer, "/chat/1.0.0")
			if err != nil {
				fmt.Printf("Error creating stream to %s: %v\n", peer, err)
				continue
			}

			if _, err := s.Write([]byte(msg)); err != nil {
				fmt.Printf("Error sending to %s: %v\n", peer, err)
			}
			s.Close()
		}
	}
}

func getPublicAddress(h host.Host) string {
	addrs := h.Addrs()
	for _, addr := range addrs {
		if addr.String() != fmt.Sprintf("/ip4/0.0.0.0/tcp/%d", 4001) {
			return addr.String()
		}
	}
	return ""
}

func mustDecodePeerID(s string) peer.ID {
	pid, err := peer.Decode(s)
	if err != nil {
		panic(err)
	}
	return pid
}

func mustDecodeMultiaddr(s string) ma.Multiaddr {
	addr, err := ma.NewMultiaddr(s)
	if err != nil {
		panic(err)
	}
	return addr
}

// Add this new struct
type blockAllGater struct{}

func (g *blockAllGater) InterceptAddrDial(p peer.ID, addr ma.Multiaddr) bool {
	// Allow all connections by default
	return true
}

func (g *blockAllGater) InterceptPeerDial(p peer.ID) bool {
	// Allow all peer connections
	return true
}

func (g *blockAllGater) InterceptAccept(n network.ConnMultiaddrs) bool {
	// Accept all incoming connections
	return true
}

func (g *blockAllGater) InterceptSecured(dir network.Direction, p peer.ID, n network.ConnMultiaddrs) bool {
	// Allow all secured connections
	return true
}

func (g *blockAllGater) InterceptUpgraded(n network.Conn) (bool, control.DisconnectReason) {
	// Allow all upgraded connections
	return true, 0
}

func generateAndSaveKey(filename string) error {
	privKey, _, err := crypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		return err
	}

	data, err := crypto.MarshalPrivateKey(privKey)
	if err != nil {
		return err
	}

	return os.WriteFile(filename, data, 0600)
}

func loadOrGenerateKey(filename string) (crypto.PrivKey, error) {
	// Try to load existing key
	if data, err := os.ReadFile(filename); err == nil {
		return crypto.UnmarshalPrivateKey(data)
	}

	// Generate new key if not exists
	privKey, _, err := crypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		return nil, err
	}

	// Save the key
	data, err := crypto.MarshalPrivateKey(privKey)
	if err != nil {
		return nil, err
	}

	if err := os.WriteFile(filename, data, 0600); err != nil {
		return nil, err
	}

	return privKey, nil
}
