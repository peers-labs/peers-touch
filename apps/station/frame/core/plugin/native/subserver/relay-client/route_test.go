package relayclient

import (
	"context"
	"crypto/rand"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

func TestPublishDefaultRouteMakesMountedStationPubliclyDiscoverable(t *testing.T) {
	privateKey, publicKey, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	stationPeerID, err := peer.IDFromPublicKey(publicKey)
	if err != nil {
		t.Fatal(err)
	}
	ingress, err := newInnerTLSIngress(0, time.Second)
	if err != nil {
		t.Fatal(err)
	}

	var published *peerpb.StationRouteStatement
	relayServer := httptest.NewServer(http.HandlerFunc(
		func(response http.ResponseWriter, request *http.Request) {
			body, readErr := io.ReadAll(request.Body)
			if readErr != nil {
				response.WriteHeader(http.StatusBadRequest)
				return
			}
			input := &peerpb.PublishStationRouteRequest{}
			if err := proto.Unmarshal(body, input); err != nil {
				response.WriteHeader(http.StatusBadRequest)
				return
			}
			published = &peerpb.StationRouteStatement{}
			if err := proto.Unmarshal(
				input.GetRouteAttestation().GetStatementBytes(),
				published,
			); err != nil {
				response.WriteHeader(http.StatusBadRequest)
				return
			}
			output, err := proto.Marshal(&peerpb.PublishStationRouteResponse{
				RouteId:         published.GetRouteId(),
				RouteGeneration: published.GetRouteGeneration(),
			})
			if err != nil {
				response.WriteHeader(http.StatusInternalServerError)
				return
			}
			_, _ = response.Write(output)
		},
	))
	defer relayServer.Close()

	subserver := &SubServer{
		opts:            &Options{RelayURL: relayServer.URL},
		status:          server.StatusRunning,
		enrollmentState: "mounted",
		stationSigner: connectionMaterialSigner{
			privateKey: privateKey,
		},
		innerTLS:        ingress,
		publishedRoutes: make(map[string]uint64),
	}
	subserver.setCredential(&cachedMountCredential{
		Token:         "mount-token",
		RelayPeerID:   "relay-peer",
		StationPeerID: stationPeerID.String(),
		MountID:       1,
		Generation:    2,
		ExpiresAt:     time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	})

	subserver.publishDefaultRoute(context.Background())

	if published == nil {
		t.Fatal("default route was not published")
	}
	if published.GetVisibility() !=
		peerpb.StationRouteVisibility_STATION_ROUTE_VISIBILITY_PUBLIC {
		t.Fatalf("default route visibility = %s, want PUBLIC", published.GetVisibility())
	}
}
