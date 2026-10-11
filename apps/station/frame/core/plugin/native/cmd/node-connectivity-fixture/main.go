package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"sync/atomic"
	"time"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/peer"
	relayclient "github.com/libp2p/go-libp2p/p2p/protocol/circuitv2/client"
	relayv2 "github.com/libp2p/go-libp2p/p2p/protocol/circuitv2/relay"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/transport/securehttp"
)

type fixtureProjection struct {
	NodePeerID string `json:"nodePeerId"`
	Route      string `json:"route"`
	SPKISHA256 string `json:"spkiSha256"`
}

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	relayHost, err := libp2p.New(
		libp2p.ListenAddrStrings("/ip4/127.0.0.1/tcp/0"),
		libp2p.EnableRelay(),
		libp2p.ForceReachabilityPublic(),
		libp2p.EnableRelayService(relayv2.WithResources(relayv2.Resources{
			Limit: &relayv2.RelayLimit{
				Duration: time.Hour,
				Data:     64 << 20,
			},
			ReservationTTL:         time.Hour,
			MaxReservations:        16,
			MaxCircuits:            16,
			BufferSize:             32 << 10,
			MaxReservationsPerPeer: 1,
			MaxReservationsPerIP:   16,
			MaxReservationsPerASN:  16,
		})),
	)
	must(err)
	defer relayHost.Close()
	stationHost, err := libp2p.New(
		libp2p.ListenAddrStrings("/ip4/127.0.0.1/tcp/0"),
		libp2p.EnableRelay(),
	)
	must(err)
	defer stationHost.Close()
	relayInfo := peer.AddrInfo{
		ID:    relayHost.ID(),
		Addrs: relayHost.Addrs(),
	}
	must(stationHost.Connect(ctx, relayInfo))
	reservation, err := relayclient.Reserve(ctx, stationHost, relayInfo)
	must(err)

	var sideEffects atomic.Uint64
	backendListener, err := net.Listen("tcp", "127.0.0.1:0")
	must(err)
	backend := &http.Server{Handler: http.HandlerFunc(func(
		writer http.ResponseWriter,
		request *http.Request,
	) {
		switch request.URL.Path {
		case "/ping":
			_, _ = writer.Write([]byte("pong"))
		case "/side-effect":
			sideEffects.Add(1)
			_, _ = writer.Write([]byte("committed"))
		case "/side-effect-count":
			_, _ = fmt.Fprintf(writer, "%d", sideEffects.Load())
		case "/events":
			writer.Header().Set("Content-Type", "text/event-stream")
			flusher, ok := writer.(http.Flusher)
			if !ok {
				http.Error(writer, "flush unavailable", http.StatusInternalServerError)
				return
			}
			for _, event := range []string{"one", "two"} {
				_, _ = fmt.Fprintf(writer, "data: %s\n\n", event)
				flusher.Flush()
			}
		case "/upload":
			digest := sha256.New()
			count, readErr := io.Copy(digest, request.Body)
			if readErr != nil {
				http.Error(writer, readErr.Error(), http.StatusBadRequest)
				return
			}
			writer.Header().Set(
				"X-Content-SHA256",
				hex.EncodeToString(digest.Sum(nil)),
			)
			_, _ = fmt.Fprintf(writer, "%d", count)
		default:
			http.NotFound(writer, request)
		}
	})}
	go func() {
		_ = backend.Serve(backendListener)
	}()
	defer backend.Close()

	identity, err := securehttp.NewNodeTLSIdentity(
		stationHost.Peerstore().PrivKey(stationHost.ID()),
		time.Now().UTC(),
	)
	must(err)
	backendURL, err := url.Parse(
		"http://" + backendListener.Addr().String(),
	)
	must(err)
	ingress, err := securehttp.NewIngress(securehttp.IngressConfig{
		BackendURL: backendURL,
		Identity:   identity,
	})
	must(err)
	must(ingress.AttachHost(stationHost))
	must(ingress.Start(ctx))
	defer ingress.Close()

	relayAddress := relayHost.Addrs()[0].String()
	route := fmt.Sprintf(
		"%s/p2p/%s/p2p-circuit/p2p/%s",
		relayAddress,
		relayHost.ID(),
		stationHost.ID(),
	)
	spki := identity.SPKISHA256()
	projection := fixtureProjection{
		NodePeerID: stationHost.ID().String(),
		Route:      route,
		SPKISHA256: hex.EncodeToString(spki[:]),
	}
	must(json.NewEncoder(os.Stdout).Encode(projection))
	_ = os.Stdout.Sync()
	_, _ = io.Copy(io.Discard, os.Stdin)
	_ = reservation
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}
