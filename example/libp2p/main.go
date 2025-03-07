package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/p2p/muxer/yamux"
	"github.com/libp2p/go-libp2p/p2p/security/noise"
	"github.com/libp2p/go-libp2p/p2p/transport/tcp"
	ma "github.com/multiformats/go-multiaddr"
)

func main() {
	listenF := flag.Bool("l", false, "Listen mode")
	targetF := flag.String("d", "", "Target peer to dial")
	flag.Parse()

	// Configure NAT-friendly libp2p options
	opts := []libp2p.Option{
		libp2p.ListenAddrStrings(
			"/ip4/0.0.0.0/tcp/0", // All IPv4 interfaces, random port
			"/ip6/::/tcp/0",      // All IPv6 interfaces, random port
		),
		libp2p.Security(noise.ID, noise.New), // Add security protocol
		libp2p.Transport(tcp.NewTCPTransport),
		libp2p.Muxer("/yamux/1.0.0", yamux.DefaultTransport),
		libp2p.NATPortMap(), // Enable UPnP NAT traversal
	}

	// Create libp2p host
	host, err := libp2p.New(opts...)
	if err != nil {
		log.Fatal(err)
	}
	defer host.Close()

	// Set stream handler for incoming messages
	host.SetStreamHandler("/chat/1.0.0", func(s network.Stream) {
		fmt.Printf("\nNew connection from %s\n", s.Conn().RemotePeer())
		go handleStream(s)
	})

	// Print listening addresses
	fmt.Println("Listening on addresses:")
	for _, addr := range host.Addrs() {
		fmt.Printf("  %s/p2p/%s\n", addr, host.ID())
	}

	fmt.Println("Listening above addresses")

	if *listenF {
		// Keep listening
		select {}
		//
	}

	// Dial to target peer
	if *targetF != "" {
		// Parse target multiaddress
		targetAddr, err := ma.NewMultiaddr(*targetF)
		if err != nil {
			log.Fatal(err)
		}

		// Extract peer ID from multiaddress
		targetInfo, err := peer.AddrInfoFromP2pAddr(targetAddr)
		if err != nil {
			log.Fatal(err)
		}

		// Connect to target peer
		if err := host.Connect(context.Background(), *targetInfo); err != nil {
			log.Fatal(err)
		}

		s, err := host.NewStream(context.Background(), targetInfo.ID, "/chat/1.0.0")
		if err != nil {
			log.Fatal(err)
		}

		go handleStream(s)

		// Keep main thread alive
		select {}
	}
}

// Add these new functions at the bottom of main()
func readLoop(s network.Stream) {
	buf := bufio.NewReader(s)
	for {
		str, err := buf.ReadString('\n')
		if err != nil {
			fmt.Printf("Connection closed: %v\n", err)
			return
		}
		fmt.Printf("\n[%s] %s", s.Conn().RemotePeer(), str)
	}
}

func writeLoop(s network.Stream) {
	scanner := bufio.NewScanner(os.Stdin)
	for {
		fmt.Print("> ")
		scanner.Scan()
		msg := scanner.Text() + "\n"
		_, err := s.Write([]byte(msg))
		if err != nil {
			fmt.Printf("Send error: %v\n", err)
			return
		}
	}
}

// Add these new functions
func handleStream(s network.Stream) {
	defer s.Close()

	// Create separate contexts for read/write
	readCtx, readCancel := context.WithCancel(context.Background())
	defer readCancel()

	go func() {
		buf := bufio.NewReader(s)
		for {
			select {
			case <-readCtx.Done():
				return
			default:
				str, err := buf.ReadString('\n')
				if err != nil {
					readCancel()
					return
				}
				fmt.Printf("[%s] %s", s.Conn().RemotePeer(), str)
			}
		}
	}()

	// Write loop
	scanner := bufio.NewScanner(os.Stdin)
	for {
		select {
		case <-readCtx.Done():
			return
		default:
			fmt.Print("> ")
			scanner.Scan()
			msg := scanner.Text() + "\n"
			_, err := s.Write([]byte(msg))
			if err != nil {
				readCancel()
				return
			}
		}
	}
}
