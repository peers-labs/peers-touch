package relayclient

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	federationcore "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/bootstrap"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

var _ stationConnectionSigner = (*bootstrap.SubServer)(nil)

type connectionMaterialSigner struct {
	privateKey libp2pcrypto.PrivKey
}

func (s connectionMaterialSigner) SignStationRouteAttestation(
	statement *peerpb.StationRouteStatement,
) (*peerpb.StationRouteAttestation, error) {
	statementBytes, err := proto.MarshalOptions{Deterministic: true}.
		Marshal(statement)
	if err != nil {
		return nil, err
	}
	signature, err := s.privateKey.Sign(
		append([]byte(domain.StationRouteDomain), statementBytes...),
	)
	if err != nil {
		return nil, err
	}
	publicKey, err := libp2pcrypto.MarshalPublicKey(
		s.privateKey.GetPublic(),
	)
	if err != nil {
		return nil, err
	}
	return &peerpb.StationRouteAttestation{
		StatementBytes: statementBytes,
		HostPublicKey:  publicKey,
		Signature:      signature,
	}, nil
}

func (s connectionMaterialSigner) SignStationConnectionGrant(
	statement *peerpb.StationConnectionGrantStatement,
) (*peerpb.StationConnectionGrant, error) {
	statementBytes, err := proto.MarshalOptions{Deterministic: true}.
		Marshal(statement)
	if err != nil {
		return nil, err
	}
	signature, err := s.privateKey.Sign(
		append([]byte(domain.ConnectionGrantDomain), statementBytes...),
	)
	if err != nil {
		return nil, err
	}
	publicKey, err := libp2pcrypto.MarshalPublicKey(
		s.privateKey.GetPublic(),
	)
	if err != nil {
		return nil, err
	}
	return &peerpb.StationConnectionGrant{
		StatementBytes: statementBytes,
		HostPublicKey:  publicKey,
		Signature:      signature,
	}, nil
}

func TestIssueConnectionMaterialRegistersGrantBeforeReturningCode(t *testing.T) {
	privateKey, publicKey, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	stationIdentity, err := peer.IDFromPublicKey(publicKey)
	if err != nil {
		t.Fatalf("derive Station peer ID: %v", err)
	}
	ingress, err := newInnerTLSIngress(0, time.Second)
	if err != nil {
		t.Fatalf("create inner TLS ingress: %v", err)
	}

	var published *peerpb.StationRouteAttestation
	var registered *peerpb.RegisterStationConnectionGrantRequest
	var grantRegistered bool
	relayServer := httptest.NewServer(http.HandlerFunc(
		func(response http.ResponseWriter, request *http.Request) {
			if request.URL.RawQuery != "" {
				t.Errorf("sensitive control request used query parameters")
			}
			if request.Header.Get("Authorization") != "Bearer mount-token" {
				response.WriteHeader(http.StatusUnauthorized)
				return
			}
			body, readErr := io.ReadAll(request.Body)
			if readErr != nil {
				t.Errorf("read Relay request: %v", readErr)
				response.WriteHeader(http.StatusBadRequest)
				return
			}
			var output proto.Message
			switch request.URL.Path {
			case "/api/v1/relay/routes":
				input := &peerpb.PublishStationRouteRequest{}
				if err := proto.Unmarshal(body, input); err != nil {
					t.Errorf("decode route request: %v", err)
					response.WriteHeader(http.StatusBadRequest)
					return
				}
				published = input.GetRouteAttestation()
				statement := &peerpb.StationRouteStatement{}
				if err := proto.Unmarshal(
					published.GetStatementBytes(),
					statement,
				); err != nil {
					t.Errorf("decode route statement: %v", err)
					response.WriteHeader(http.StatusBadRequest)
					return
				}
				output = &peerpb.PublishStationRouteResponse{
					RouteId:         statement.GetRouteId(),
					RouteGeneration: statement.GetRouteGeneration(),
				}
			case "/api/v1/relay/grants":
				if published == nil {
					t.Error("grant registered before route publication")
					response.WriteHeader(http.StatusConflict)
					return
				}
				input := &peerpb.RegisterStationConnectionGrantRequest{}
				if err := proto.Unmarshal(body, input); err != nil {
					t.Errorf("decode grant request: %v", err)
					response.WriteHeader(http.StatusBadRequest)
					return
				}
				registered = input
				grantRegistered = true
				output = &peerpb.RegisterStationConnectionGrantResponse{
					GrantId:       input.GetGrantId(),
					RemainingUses: input.GetMaxUses(),
				}
			default:
				response.WriteHeader(http.StatusNotFound)
				return
			}
			encoded, marshalErr := proto.Marshal(output)
			if marshalErr != nil {
				t.Errorf("encode Relay response: %v", marshalErr)
				response.WriteHeader(http.StatusInternalServerError)
				return
			}
			response.Header().Set("Content-Type", "application/protobuf")
			_, _ = response.Write(encoded)
		},
	))
	defer relayServer.Close()

	subserver := &SubServer{
		opts:            &Options{RelayURL: relayServer.URL},
		status:          server.StatusRunning,
		enrollmentState: "mounted",
		stationSigner:   connectionMaterialSigner{privateKey: privateKey},
		innerTLS:        ingress,
		publishedRoutes: make(map[string]uint64),
	}
	subserver.setCredential(&cachedMountCredential{
		Token:         "mount-token",
		RelayPeerID:   "relay-peer",
		StationPeerID: stationIdentity.String(),
		MountID:       7,
		Generation:    3,
		ExpiresAt:     time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	})
	material, err := subserver.IssueConnectionMaterial(
		context.Background(),
		ConnectionMaterialRequest{
			RouteID:            "private-route",
			InnerTLSSPKISHA256: bytes.Repeat([]byte{0x31}, sha256.Size),
			CapabilitiesDigest: bytes.Repeat([]byte{0x32}, sha256.Size),
			RouteLifetime:      time.Hour,
			GrantLifetime:      time.Minute,
			MaxUses:            2,
		},
	)
	if err != nil {
		t.Fatalf("issue connection material: %v", err)
	}
	if !grantRegistered || registered == nil {
		t.Fatal("connection material returned before grant registration")
	}
	if !strings.HasPrefix(material.Code, connectionCodePrefix) {
		t.Fatalf("connection code prefix = %q", material.Code)
	}
	payload := strings.TrimPrefix(material.Code, connectionCodePrefix)
	if material.DeepLink != connectionDeepLink+payload {
		t.Fatalf("deep link does not contain the exact connection payload")
	}
	envelopeBytes, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		t.Fatalf("decode connection material: %v", err)
	}
	envelope := &peerpb.StationConnectionEnvelope{}
	if err := proto.Unmarshal(envelopeBytes, envelope); err != nil {
		t.Fatalf("decode connection envelope: %v", err)
	}
	if envelope.GetProtocolVersion() != domain.AccessProtocolVersion ||
		envelope.GetRelayOrigin() != relayServer.URL {
		t.Fatalf("unexpected connection envelope: %+v", envelope)
	}
	grantBytes, err := proto.MarshalOptions{Deterministic: true}.
		Marshal(envelope.GetConnectionGrant())
	if err != nil {
		t.Fatal(err)
	}
	grantDigest := sha256.Sum256(grantBytes)
	if !bytes.Equal(registered.GetGrantDigest(), grantDigest[:]) {
		t.Fatal("Relay registration digest does not match returned grant")
	}
	if !proto.Equal(envelope.GetRouteAttestation(), published) {
		t.Fatal("returned route attestation differs from published route")
	}
	statement := &peerpb.StationRouteStatement{}
	if err := proto.Unmarshal(published.GetStatementBytes(), statement); err != nil {
		t.Fatalf("decode published route statement: %v", err)
	}
	if !bytes.Equal(statement.GetInnerTlsSpkiSha256(), ingress.SPKISHA256()) {
		t.Fatal("route attestation does not bind the Station-owned inner TLS SPKI")
	}
	if !bytes.Equal(
		statement.GetCapabilitiesDigest(),
		federationcore.PeerCapabilityManifestDigest(),
	) {
		t.Fatal("route attestation does not bind the canonical capability manifest")
	}
	if bytes.Equal(
		statement.GetInnerTlsSpkiSha256(),
		bytes.Repeat([]byte{0x31}, sha256.Size),
	) || bytes.Equal(
		statement.GetCapabilitiesDigest(),
		bytes.Repeat([]byte{0x32}, sha256.Size),
	) {
		t.Fatal("caller-controlled route security material was trusted")
	}
}

func TestIssueConnectionMaterialReturnsNothingWhenGrantRegistrationFails(
	t *testing.T,
) {
	privateKey, publicKey, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	ingress, err := newInnerTLSIngress(0, time.Second)
	if err != nil {
		t.Fatalf("create inner TLS ingress: %v", err)
	}
	stationIdentity, err := peer.IDFromPublicKey(publicKey)
	if err != nil {
		t.Fatal(err)
	}
	relayServer := httptest.NewServer(http.HandlerFunc(
		func(response http.ResponseWriter, request *http.Request) {
			if request.URL.Path == "/api/v1/relay/routes" {
				input := &peerpb.PublishStationRouteRequest{}
				body, _ := io.ReadAll(request.Body)
				_ = proto.Unmarshal(body, input)
				statement := &peerpb.StationRouteStatement{}
				_ = proto.Unmarshal(
					input.GetRouteAttestation().GetStatementBytes(),
					statement,
				)
				output, _ := proto.Marshal(&peerpb.PublishStationRouteResponse{
					RouteId:         statement.GetRouteId(),
					RouteGeneration: statement.GetRouteGeneration(),
				})
				_, _ = response.Write(output)
				return
			}
			response.WriteHeader(http.StatusServiceUnavailable)
		},
	))
	defer relayServer.Close()

	subserver := &SubServer{
		opts:            &Options{RelayURL: relayServer.URL},
		status:          server.StatusRunning,
		enrollmentState: "mounted",
		stationSigner:   connectionMaterialSigner{privateKey: privateKey},
		innerTLS:        ingress,
		publishedRoutes: make(map[string]uint64),
	}
	subserver.setCredential(&cachedMountCredential{
		Token:         "mount-token",
		RelayPeerID:   "relay-peer",
		StationPeerID: stationIdentity.String(),
		MountID:       7,
		Generation:    3,
		ExpiresAt:     time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	})
	material, err := subserver.IssueConnectionMaterial(
		context.Background(),
		ConnectionMaterialRequest{
			RouteID:            "private-route",
			InnerTLSSPKISHA256: bytes.Repeat([]byte{0x41}, sha256.Size),
			CapabilitiesDigest: bytes.Repeat([]byte{0x42}, sha256.Size),
		},
	)
	if err == nil {
		t.Fatal("grant registration failure was ignored")
	}
	if material != nil {
		t.Fatal("connection material escaped before grant registration")
	}
}

func TestIssueConnectionMaterialRequiresMountedRelayConnection(t *testing.T) {
	for _, test := range []struct {
		name            string
		status          server.Status
		enrollmentState string
	}{
		{
			name:            "stopped",
			status:          server.StatusStopped,
			enrollmentState: "mounted",
		},
		{
			name:            "disconnected",
			status:          server.StatusStarting,
			enrollmentState: "reconnecting",
		},
		{
			name:            "running but not mounted",
			status:          server.StatusRunning,
			enrollmentState: "connecting",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			subserver := &SubServer{
				opts:            &Options{RelayURL: "https://relay.invalid"},
				status:          test.status,
				enrollmentState: test.enrollmentState,
			}
			subserver.setCredential(&cachedMountCredential{
				Token:         "mount-token",
				RelayPeerID:   "relay-peer",
				StationPeerID: "station-peer",
				MountID:       7,
				Generation:    3,
				ExpiresAt: time.Now().Add(time.Hour).UTC().
					Format(time.RFC3339),
			})

			material, err := subserver.IssueConnectionMaterial(
				context.Background(),
				ConnectionMaterialRequest{
					InnerTLSSPKISHA256: bytes.Repeat(
						[]byte{0x51},
						sha256.Size,
					),
					CapabilitiesDigest: bytes.Repeat(
						[]byte{0x52},
						sha256.Size,
					),
				},
			)
			if !errors.Is(err, ErrConnectionMaterialUnavailable) {
				t.Fatalf(
					"error = %v, want ErrConnectionMaterialUnavailable",
					err,
				)
			}
			if material != nil {
				t.Fatal("connection material escaped an unavailable mount")
			}
		})
	}
}
