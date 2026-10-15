package main

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

const endpointDomain = "peers-touch/access-endpoint/v1\x00"

type request struct {
	StationURL string `json:"station_url"`
	RelayURL   string `json:"relay_url"`
}

type response struct {
	StationRoleBound          bool `json:"station_role_bound"`
	RelayRoleBound            bool `json:"relay_role_bound"`
	ChallengesBound           bool `json:"challenges_bound"`
	RelayNoCandidates         bool `json:"relay_no_candidates"`
	DashboardAuthRequired     bool `json:"dashboard_auth_required"`
	DashboardSensitiveHeaders bool `json:"dashboard_sensitive_headers"`
}

func main() {
	var input request
	decoder := json.NewDecoder(os.Stdin)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		fail("invalid discovery probe input")
	}
	stationChallenge := make([]byte, 32)
	relayChallenge := make([]byte, 32)
	if _, err := rand.Read(stationChallenge); err != nil {
		fail("create Station discovery challenge")
	}
	if _, err := rand.Read(relayChallenge); err != nil {
		fail("create Relay discovery challenge")
	}
	station := discover(input.StationURL, stationChallenge)
	relay := discover(input.RelayURL, relayChallenge)
	stationStatement := verify(
		station,
		stationChallenge,
		peerpb.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_DIRECT_STATION,
	)
	relayStatement := verify(
		relay,
		relayChallenge,
		peerpb.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_RELAY,
	)
	dashboardAuthRequired, dashboardSensitiveHeaders :=
		verifyDashboardConnectionMaterial(input.StationURL)
	payload, err := json.Marshal(response{
		StationRoleBound: stationStatement.GetEndpointRole() ==
			peerpb.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_DIRECT_STATION,
		RelayRoleBound: relayStatement.GetEndpointRole() ==
			peerpb.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_RELAY,
		ChallengesBound: bytes.Equal(
			stationStatement.GetChallenge(),
			stationChallenge,
		) && bytes.Equal(
			relayStatement.GetChallenge(),
			relayChallenge,
		),
		RelayNoCandidates: relay.GetOutcome() ==
			peerpb.AccessEndpointOutcome_ACCESS_ENDPOINT_OUTCOME_NO_CANDIDATES,
		DashboardAuthRequired:     dashboardAuthRequired,
		DashboardSensitiveHeaders: dashboardSensitiveHeaders,
	})
	if err != nil {
		fail("encode discovery probe result")
	}
	_, _ = fmt.Fprintf(os.Stdout, "PT_ENDPOINT_DISCOVERY_PROBE=%s\n", payload)
}

func discover(origin string, challenge []byte) *peerpb.AccessEndpointResponse {
	body, err := proto.Marshal(&peerpb.AccessEndpointRequest{
		Challenge:             challenge,
		ClientProtocolVersion: 1,
	})
	if err != nil {
		fail("encode discovery request")
	}
	request, err := http.NewRequest(
		http.MethodPost,
		origin+"/.well-known/peers-touch/access",
		bytes.NewReader(body),
	)
	if err != nil {
		fail("build discovery request")
	}
	request.Header.Set("Accept", "application/protobuf")
	request.Header.Set("Content-Type", "application/protobuf")
	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(
			_ *http.Request,
			_ []*http.Request,
		) error {
			return http.ErrUseLastResponse
		},
	}
	httpResponse, err := client.Do(request)
	if err != nil {
		fail("execute discovery request")
	}
	defer httpResponse.Body.Close()
	if httpResponse.StatusCode != http.StatusOK {
		fail("discovery endpoint rejected canonical request")
	}
	raw, err := io.ReadAll(io.LimitReader(httpResponse.Body, 64*1024))
	if err != nil {
		fail("read discovery response")
	}
	result := &peerpb.AccessEndpointResponse{}
	if err := proto.Unmarshal(raw, result); err != nil {
		fail("decode discovery response")
	}
	return result
}

func verifyDashboardConnectionMaterial(origin string) (bool, bool) {
	request, err := http.NewRequest(
		http.MethodPost,
		origin+"/dashboard/api/relay/connection-material",
		strings.NewReader("{}"),
	)
	if err != nil {
		fail("build Dashboard connection material request")
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := (&http.Client{Timeout: 10 * time.Second}).Do(request)
	if err != nil {
		fail("execute Dashboard connection material request")
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64*1024))
	return response.StatusCode == http.StatusUnauthorized,
		response.Header.Get("Cache-Control") == "no-store" &&
			response.Header.Get("Referrer-Policy") == "no-referrer"
}

func verify(
	response *peerpb.AccessEndpointResponse,
	challenge []byte,
	expectedRole peerpb.AccessEndpointRole,
) *peerpb.AccessEndpointStatement {
	statement := &peerpb.AccessEndpointStatement{}
	if err := proto.Unmarshal(
		response.GetEndpointStatementBytes(),
		statement,
	); err != nil {
		fail("decode signed endpoint statement")
	}
	if statement.GetEndpointRole() != expectedRole ||
		!bytes.Equal(statement.GetChallenge(), challenge) ||
		statement.GetExpiresAtUnixMs() <= statement.GetIssuedAtUnixMs() ||
		statement.GetExpiresAtUnixMs() < time.Now().Add(-time.Minute).UnixMilli() {
		fail("endpoint statement fields are invalid")
	}
	publicKey, err := libp2pcrypto.UnmarshalPublicKey(
		response.GetEndpointPublicKey(),
	)
	if err != nil {
		fail("decode endpoint public key")
	}
	endpointPeerID, err := peer.IDFromPublicKey(publicKey)
	if err != nil || endpointPeerID.String() != statement.GetEndpointPeerId() {
		fail("endpoint peer id does not match its public key")
	}
	ok, err := publicKey.Verify(
		append(
			[]byte(endpointDomain),
			response.GetEndpointStatementBytes()...,
		),
		response.GetEndpointSignature(),
	)
	if err != nil || !ok {
		fail("endpoint signature is invalid")
	}
	return statement
}

func fail(message string) {
	_, _ = fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}
