package main

// ... existing imports ...
import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/libp2p/go-libp2p"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/p2p/discovery/routing"
	"github.com/libp2p/go-libp2p/p2p/discovery/util"
	"github.com/libp2p/go-libp2p/p2p/muxer/yamux"
	"github.com/libp2p/go-libp2p/p2p/security/noise"
	"github.com/libp2p/go-libp2p/p2p/transport/tcp"
	ma "github.com/multiformats/go-multiaddr"
)

func main() {
	regMode := flag.Bool("r", false, "Run as registry node")
	bootstrapAddr := flag.String("b", "", "Bootstrap node address")
	port := flag.Int("p", 4001, "Network port")
	flag.Parse()

	// Create host with security and transport
	host := createHost(*port, *regMode)

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

func createHost(port int, regMode bool) host.Host {
	opts := []libp2p.Option{
		libp2p.ListenAddrStrings(fmt.Sprintf("/ip4/0.0.0.0/tcp/%d", port)),
		libp2p.Security(noise.ID, noise.New),
		libp2p.Transport(tcp.NewTCPTransport),
		libp2p.Muxer("/yamux/1.0.0", yamux.DefaultTransport),
	}

	if regMode {
		opts = append(opts, libp2p.NATPortMap())
	}

	h, err := libp2p.New(opts...)
	if err != nil {
		log.Fatal(err)
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

			fmt.Printf("Discovered new peer: %s\n", peer.ID)
			connectWithBackoff(h, peer)
		}

		time.Sleep(1 * time.Minute)
	}
}

func connectWithBackoff(h host.Host, p peer.AddrInfo) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := h.Connect(ctx, p); err != nil {
		fmt.Printf("Connection failed: %v\n", err)
		return
	}
	fmt.Printf("Connected to: %s\n", p.ID)
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
