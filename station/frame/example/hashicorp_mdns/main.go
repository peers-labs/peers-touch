package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"os"
	"strings"
	"time"

	"github.com/hashicorp/mdns"
)

func randomSuffix(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "rnd"
	}
	return hex.EncodeToString(b)
}

func main() {
	// RFC 6763 node type must start with an underscore and end with "._tcp" or "._udp"
	const serviceType = "_peers-touch-mdns-demo._tcp"

	hostname, err := os.Hostname()
	if err != nil {
		log.Fatalf("cannot obtain hostname: %v", err)
	}

	instance := fmt.Sprintf("%s-%s", hostname, randomSuffix(3))

	// Collect our IPv4 addresses for self-filtering later
	var ownIPs = map[string]struct{}{}
	if addrs, err := net.InterfaceAddrs(); err == nil {
		for _, a := range addrs {
			if ipnet, ok := a.(*net.IPNet); ok && ipnet.IP.To4() != nil {
				ownIPs[ipnet.IP.String()] = struct{}{}
			}
		}
	}

	// Advertise ourselves on the local network via mDNS
	infoTxt := []string{"txtvers=1", fmt.Sprintf("instance=%s", instance)}
	svc, err := mdns.NewMDNSService(instance, serviceType, "", "", 8000, nil, infoTxt)
	if err != nil {
		log.Fatalf("failed to create mdns node: %v", err)
	}

	server, err := mdns.NewServer(&mdns.Config{Zone: svc})
	if err != nil {
		log.Fatalf("failed to start mdns server: %v", err)
	}
	defer server.Shutdown()

	log.Printf("mDNS node started as %s.%s.local on port %d", instance, serviceType, 8000)

	// Channel to receive discovered peers
	entriesCh := make(chan *mdns.ServiceEntry, 16)
	go func() {
		for e := range entriesCh {
			/*   // Skip if discovered entry is ourselves
			     if _, ok := ownIPs[e.AddrV4.String()]; ok {
			         continue
			     } */
			if strings.HasPrefix(e.Name, instance) {
				continue
			}
			fmt.Printf("Discovered peer: %s | IP: %s | Port: %d | Info: %s | TXT: %v\n", e.Name, e.AddrV4, e.Port, e.Info, e.InfoFields)
		}
	}()

	// Periodically query for peers advertising the same node
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		if err := mdns.Lookup(serviceType, entriesCh); err != nil {
			log.Printf("lookup error: %v", err)
		}

		<-ticker.C
	}
}
