package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"strings"
	"time"

	"github.com/hashicorp/mdns"
)

// PeerInfo represents a discovered peer's information
type PeerInfo struct {
	ID    string   `json:"id"`
	Addrs []string `json:"addrs"`
	Port  int      `json:"port"`
}

// randomSuffix generates a random hex suffix for unique instance identification
func randomSuffix(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "rnd"
	}
	return hex.EncodeToString(b)
}

// generatePeerID creates a unique peer ID similar to libp2p format
func generatePeerID() string {
	return "12D3KooW" + randomSuffix(20) // Similar to libp2p peer ID format
}

// getLocalAddrs returns local network addresses
func getLocalAddrs() []string {
	var addrs []string
	interfaces, err := net.Interfaces()
	if err != nil {
		return addrs
	}

	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}

		addresses, err := iface.Addrs()
		if err != nil {
			continue
		}

		for _, addr := range addresses {
			if ipnet, ok := addr.(*net.IPNet); ok && ipnet.IP.To4() != nil {
				addrs = append(addrs, ipnet.IP.String())
			}
		}
	}
	return addrs
}

// collectOwnIPs returns a map of own IP addresses for self-filtering
func collectOwnIPs() map[string]struct{} {
	ownIPs := make(map[string]struct{})
	if addrs, err := net.InterfaceAddrs(); err == nil {
		for _, a := range addrs {
			if ipnet, ok := a.(*net.IPNet); ok && ipnet.IP.To4() != nil {
				ownIPs[ipnet.IP.String()] = struct{}{}
			}
		}
	}
	return ownIPs
}

func main() {
	// service type following RFC 6763 - using TCP for consistency with working HashiCorp demo
	const serviceType = "_peers-touch-mdns-demo._tcp"
	const port = 8000

	hostname, err := os.Hostname()
	if err != nil {
		log.Fatalf("cannot obtain hostname: %v", err)
	}

	// Generate unique peer ID and instance name
	peerID := generatePeerID()
	instance := fmt.Sprintf("%s-%s", hostname, randomSuffix(3))

	log.Printf("Local peer ID: %s", peerID)

	// Get local addresses
	localAddrs := getLocalAddrs()
	for _, addr := range localAddrs {
		log.Printf("Listening on /ip4/%s/tcp/%d", addr, port)
	}

	// Collect own IPs for self-filtering
	ownIPs := collectOwnIPs()

	// Create peer info for advertisement
	peerInfo := PeerInfo{
		ID:    peerID,
		Addrs: localAddrs,
		Port:  port,
	}

	peerInfoJSON, err := json.Marshal(peerInfo)
	if err != nil {
		log.Fatalf("failed to marshal peer info: %v", err)
	}

	// Create TXT records with peer information
	infoTxt := []string{
		"txtvers=1",
		fmt.Sprintf("instance=%s", instance),
		fmt.Sprintf("peer_id=%s", peerID),
		fmt.Sprintf("peer_info=%s", string(peerInfoJSON)),
	}

	// Advertise ourselves on the local network via mDNS
	svc, err := mdns.NewMDNSService(instance, serviceType, "", "", port, nil, infoTxt)
	if err != nil {
		log.Fatalf("failed to create mdns node: %v", err)
	}

	server, err := mdns.NewServer(&mdns.Config{Zone: svc})
	if err != nil {
		log.Fatalf("failed to start mdns server: %v", err)
	}
	defer server.Shutdown()

	log.Printf("mDNS node started with rendezvous \"%s\"", serviceType)
	log.Printf("Instance: %s.%s.local on port %d", instance, serviceType, port)

	// Channel to receive discovered peers
	entriesCh := make(chan *mdns.ServiceEntry, 16)
	go func() {
		for e := range entriesCh {
			// Skip if discovered entry is ourselves (by IP)
			if _, ok := ownIPs[e.AddrV4.String()]; ok {
				continue
			}

			// Skip if discovered entry is ourselves (by instance name)
			if strings.HasPrefix(e.Name, instance) {
				continue
			}

			// Extract peer information from TXT records
			var discoveredPeerID string
			var discoveredPeerInfo PeerInfo

			for _, txt := range e.InfoFields {
				if strings.HasPrefix(txt, "peer_id=") {
					discoveredPeerID = strings.TrimPrefix(txt, "peer_id=")
				} else if strings.HasPrefix(txt, "peer_info=") {
					peerInfoStr := strings.TrimPrefix(txt, "peer_info=")
					if err := json.Unmarshal([]byte(peerInfoStr), &discoveredPeerInfo); err != nil {
						log.Printf("Failed to unmarshal peer info: %v", err)
						continue
					}
				}
			}

			// Skip self-discovery by peer ID
			if discoveredPeerID == peerID {
				continue
			}

			// Log discovered peer in libp2p-like format
			if discoveredPeerID != "" {
				var addrStrs []string
				for _, addr := range discoveredPeerInfo.Addrs {
					addrStrs = append(addrStrs, fmt.Sprintf("/ip4/%s/tcp/%d", addr, discoveredPeerInfo.Port))
				}
				log.Printf("[mDNS] Discovered peer %s at %v", discoveredPeerID, addrStrs)
			} else {
				// Fallback to basic info if peer_id extraction failed
				log.Printf("[mDNS] Discovered peer: %s | IP: %s | Port: %d | TXT: %v", e.Name, e.AddrV4, e.Port, e.InfoFields)
			}
		}
	}()

	// Periodically query for peers advertising the same node
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	go func() {
		for {
			if err := mdns.Lookup(serviceType, entriesCh); err != nil {
				log.Printf("lookup error: %v", err)
			}
			<-ticker.C
		}
	}()

	// Wait for Ctrl-C to exit
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)
	<-sigCh
	log.Println("Interrupt received, shutting down…")
}
