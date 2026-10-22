package endpointvalidator

import (
	"context"
	"encoding/base64"
	"errors"
	"net"
	"sync"
	"testing"
	"time"

	peer "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"github.com/peers-labs/peers-touch/x-config/internal/domain/catalog"
	"google.golang.org/protobuf/proto"
)

func TestValidatorRejectsPrivateLoopbackLinkLocalAndMetadataOrigins(t *testing.T) {
	for _, value := range []string{
		"127.0.0.1",
		"10.0.0.1",
		"172.16.0.1",
		"192.168.1.1",
		"169.254.169.254",
		"100.100.100.200",
		"::1",
		"fe80::1",
	} {
		if !forbiddenAddress(net.ParseIP(value)) {
			t.Fatalf("forbidden address was accepted: %s", value)
		}
	}
	if forbiddenAddress(net.ParseIP("192.0.2.10")) {
		t.Fatal("public documentation address was classified as private")
	}

	now := time.Date(2026, 10, 18, 20, 0, 0, 0, time.UTC)
	material := &peer.PublicEndpointConnectionMaterial{
		SchemaVersion:            1,
		CanonicalDiscoveryOrigin: "http://127.0.0.1:8080",
		ExpectedEndpointRole:     peer.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_RELAY,
		ExpectedEndpointIdentity: "12D3KooWLpZy2EgZ6SC2pgJFHjM13j1ygz7DXCfm9HiPeNQZ1uaW",
		IssuedAtUnixMs:           now.Add(-time.Minute).UnixMilli(),
		ExpiresAtUnixMs:          now.Add(time.Hour).UnixMilli(),
	}
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(material)
	if err != nil {
		t.Fatal(err)
	}
	findings := (Validator{Now: func() time.Time { return now }}).Validate(
		t.Context(),
		catalog.CatalogEndpoint{
			SeedID:                   "private",
			Kind:                     "relay",
			DisplayName:              "Private",
			ConnectionMaterialBase64: base64.StdEncoding.EncodeToString(raw),
		},
	)
	if len(findings) != 1 || findings[0].Code != "origin_not_public" {
		t.Fatalf("private origin findings = %+v", findings)
	}
}

func TestValidatorAcceptsAnyReachableAddressFamily(t *testing.T) {
	addresses := []net.IP{
		net.ParseIP("192.0.2.10"),
		net.ParseIP("2001:db8::10"),
	}
	for _, successHost := range []string{"192.0.2.10", "2001:db8::10"} {
		t.Run(successHost, func(t *testing.T) {
			clientConnection, serverConnection := net.Pipe()
			t.Cleanup(func() {
				_ = clientConnection.Close()
				_ = serverConnection.Close()
			})
			var started sync.WaitGroup
			started.Add(len(addresses))
			networks := make(map[string]string, len(addresses))
			var networksMu sync.Mutex
			validator := Validator{
				DialContext: func(
					_ context.Context,
					network string,
					target string,
				) (net.Conn, error) {
					host, _, err := net.SplitHostPort(target)
					if err != nil {
						return nil, err
					}
					networksMu.Lock()
					networks[host] = network
					networksMu.Unlock()
					started.Done()
					started.Wait()
					if host == successHost {
						return clientConnection, nil
					}
					return nil, errors.New("address family unavailable")
				},
			}
			connection, err := validator.dialResolvedAddresses(
				t.Context(),
				"tcp",
				"443",
				addresses,
				time.Second,
			)
			if err != nil {
				t.Fatalf("reachable address family was rejected: %v", err)
			}
			if connection != clientConnection {
				t.Fatal("validator returned the wrong connection")
			}
			networksMu.Lock()
			defer networksMu.Unlock()
			if networks["192.0.2.10"] != "tcp4" ||
				networks["2001:db8::10"] != "tcp6" {
				t.Fatalf("unexpected address-family attempts: %+v", networks)
			}
		})
	}
}

func TestValidatorRejectsWhenAllResolvedAddressesFail(t *testing.T) {
	validator := Validator{
		DialContext: func(
			_ context.Context,
			_ string,
			_ string,
		) (net.Conn, error) {
			return nil, errors.New("unreachable")
		},
	}
	connection, err := validator.dialResolvedAddresses(
		t.Context(),
		"tcp",
		"443",
		[]net.IP{
			net.ParseIP("192.0.2.10"),
			net.ParseIP("2001:db8::10"),
		},
		time.Second,
	)
	if err == nil || connection != nil {
		t.Fatalf("all-address failure was accepted: conn=%v err=%v", connection, err)
	}
}
