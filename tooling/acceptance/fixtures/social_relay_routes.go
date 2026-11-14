// Source-bound observer. Canonical peer trust verifies each published route;
// this process has no signing, enrollment, forwarding or mutation authority.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	libcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

type input struct {
	Origin   string            `json:"origin"`
	Relay    string            `json:"relayPeerId"`
	CA       string            `json:"ca"`
	Stations map[string]uint64 `json:"stations"`
}

func observe(scope input) (map[string]any, error) {
	origin, err := url.Parse(scope.Origin)
	if err != nil || origin.Scheme != "https" || origin.Host == "" ||
		origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" ||
		(origin.Path != "" && origin.Path != "/") || len(scope.Stations) != 2 {
		return nil, fmt.Errorf("invalid observation scope")
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM([]byte(scope.CA)) {
		return nil, fmt.Errorf("invalid reviewed trust anchor")
	}
	relay, err := peer.Decode(scope.Relay)
	if err != nil {
		return nil, err
	}
	challenge := make([]byte, peerpb.StationIdentityChallengeSize)
	if _, err = rand.Read(challenge); err != nil {
		return nil, err
	}
	requestBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&peerpb.AccessEndpointRequest{Challenge: challenge, ClientProtocolVersion: 1})
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(scope.Origin, "/")+"/.well-known/peers-touch/access",
		bytes.NewReader(requestBytes))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/protobuf")
	request.Header.Set("Accept", "application/protobuf")
	transport := &http.Transport{TLSClientConfig: &tls.Config{
		RootCAs: roots, MinVersion: tls.VersionTLS13,
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	wire, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil || response.StatusCode != http.StatusOK || len(wire) > 1<<20 {
		return nil, fmt.Errorf("signed discovery response failed")
	}
	value := &peerpb.AccessEndpointResponse{}
	if err = proto.Unmarshal(wire, value); err != nil {
		return nil, err
	}
	if len(value.ProtoReflect().GetUnknown()) != 0 {
		return nil, fmt.Errorf("signed discovery contains unknown fields")
	}
	statement := &peerpb.AccessEndpointStatement{}
	if err = proto.Unmarshal(value.GetEndpointStatementBytes(), statement); err != nil {
		return nil, err
	}
	canonical, err := proto.MarshalOptions{Deterministic: true}.Marshal(statement)
	now := time.Now().UTC()
	if err != nil || !bytes.Equal(canonical, value.GetEndpointStatementBytes()) ||
		!bytes.Equal(challenge, statement.GetChallenge()) ||
		statement.GetEndpointRole() != peerpb.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_RELAY ||
		statement.GetEndpointPeerId() != scope.Relay ||
		strings.TrimRight(statement.GetCanonicalOrigin(), "/") != strings.TrimRight(scope.Origin, "/") ||
		statement.GetIssuedAtUnixMs() > now.Add(time.Minute).UnixMilli() ||
		statement.GetExpiresAtUnixMs() < now.UnixMilli() {
		return nil, fmt.Errorf("signed endpoint scope differs")
	}
	key, err := libcrypto.UnmarshalPublicKey(value.GetEndpointPublicKey())
	if err != nil {
		return nil, err
	}
	identity, err := peer.IDFromPublicKey(key)
	if err != nil || identity != relay {
		return nil, fmt.Errorf("endpoint key differs")
	}
	valid, err := key.Verify(append([]byte("peers-touch/access-endpoint/v1\x00"),
		value.GetEndpointStatementBytes()...), value.GetEndpointSignature())
	if err != nil || !valid {
		return nil, fmt.Errorf("endpoint signature differs")
	}
	result := make(map[string]any)
	for _, attestation := range value.GetStationRoutes() {
		verified, verifyErr := peerpb.VerifyStationRouteAttestation(attestation, scope.Relay, now)
		if verifyErr != nil {
			continue
		}
		route := verified.Statement
		generation, selected := scope.Stations[route.GetStationPeerId()]
		if !selected {
			continue
		}
		if generation == 0 || generation != route.GetRouteGeneration() ||
			route.GetKind() != peerpb.StationRouteKind_STATION_ROUTE_KIND_CIRCUIT ||
			route.GetVisibility() != peerpb.StationRouteVisibility_STATION_ROUTE_VISIBILITY_PUBLIC ||
			len(route.GetInnerTlsSpkiSha256()) != sha256.Size {
			return nil, fmt.Errorf("prepared route generation or transport differs")
		}
		addresses := append([]string(nil), route.GetAddresses()...)
		sort.Strings(addresses)
		if len(addresses) == 0 {
			return nil, fmt.Errorf("missing Circuit addresses")
		}
		for _, address := range addresses {
			if !strings.Contains(address, "/p2p/"+scope.Relay+"/p2p-circuit/p2p/"+route.GetNodePeerId()) {
				return nil, fmt.Errorf("unbound Circuit address")
			}
		}
		if _, duplicate := result[route.GetStationPeerId()]; duplicate {
			return nil, fmt.Errorf("ambiguous prepared route")
		}
		digest := sha256.Sum256(attestation.GetStatementBytes())
		result[route.GetStationPeerId()] = map[string]any{
			"nodePeerId": route.GetNodePeerId(), "routeId": route.GetRouteId(),
			"generation": generation, "addresses": addresses,
			"statementSha256": hex.EncodeToString(digest[:]),
			"innerSpkiSha256": hex.EncodeToString(route.GetInnerTlsSpkiSha256()),
			"expiresMillis":   route.GetExpiresAtUnixMs(),
		}
	}
	if len(result) != 2 {
		return nil, fmt.Errorf("both prepared signed routes are required")
	}
	return result, nil
}

func main() {
	var scope input
	decoder := json.NewDecoder(io.LimitReader(os.Stdin, (1<<20)+1))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&scope) != nil {
		os.Exit(2)
	}
	result, err := observe(scope)
	if err != nil {
		// Public diagnostic only: no wire, credential or key material.
		fmt.Fprintln(os.Stderr, "source-bound signed route observation failed")
		os.Exit(3)
	}
	if json.NewEncoder(os.Stdout).Encode(result) != nil {
		os.Exit(4)
	}
}
