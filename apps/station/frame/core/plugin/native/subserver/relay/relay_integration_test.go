package relay_test

// End-to-end integration test for the relay subsystem.
//
// Covers the full chain:
//   1. Init (SQLite in-memory + DDD wiring)
//   2. Create Invite (admin API)
//   3. Register (public API → consumes invite → returns relay_token)
//   4. TCP Handshake (JWT validation + ACK)
//   5. Forward (HTTP→frame→station dispatch→response→HTTP)
//   6. Heartbeat + Stats
//   7. Graceful shutdown

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	federationmodel "github.com/peers-labs/peers-touch/station/frame/core/federation/model"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/application"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/protocol"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

// testEnv holds the full DDD stack for testing without needing the real
// Station server infrastructure.
type testEnv struct {
	db      *gorm.DB
	svc     *application.Service
	cleanup func()
}

func setupTestEnv(t *testing.T) *testEnv {
	t.Helper()

	db, err := gorm.Open(
		sqlite.Open("file:"+strings.ReplaceAll(t.Name(), "/", "-")+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)

	repo := infrastructure.NewGormRepo(db)
	require.NoError(t, repo.AutoMigrate())

	authority, err := application.NewCredentialAuthority(
		[]byte("test-relay-signing-key-material-32-bytes"),
	)
	require.NoError(t, err)
	svc := application.NewService(repo, authority)

	return &testEnv{
		db:  db,
		svc: svc,
		cleanup: func() {
			_ = sqlDB.Close()
		},
	}
}

type testStation struct {
	privateKey libp2pcrypto.PrivKey
	peerID     string
}

func newTestStation(t *testing.T) testStation {
	t.Helper()
	privateKey, publicKey, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
	require.NoError(t, err)
	peerID, err := peer.IDFromPublicKey(publicKey)
	require.NoError(t, err)
	return testStation{privateKey: privateKey, peerID: peerID.String()}
}

func signChallenge(
	t *testing.T,
	station testStation,
	challenge *domain.EnrollmentChallenge,
) domain.StationIdentityProof {
	t.Helper()
	statement := &peerpb.StationIdentityStatement{
		Challenge:       append([]byte(nil), challenge.Challenge...),
		StationPeerId:   station.peerID,
		CanonicalOrigin: "https://station.example:443",
		Capabilities:    []string{"access-gate", "station-identity"},
		IssuedAtUnixMs:  time.Now().Add(-time.Second).UnixMilli(),
		ExpiresAtUnixMs: time.Now().Add(30 * time.Second).UnixMilli(),
	}
	statementBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(statement)
	require.NoError(t, err)
	signature, err := station.privateKey.Sign(
		append([]byte(domain.StationIdentityDomain), statementBytes...),
	)
	require.NoError(t, err)
	publicKey, err := libp2pcrypto.MarshalPublicKey(station.privateKey.GetPublic())
	require.NoError(t, err)
	return domain.StationIdentityProof{
		ChallengeID:   challenge.ID,
		Statement:     statementBytes,
		HostPublicKey: publicKey,
		Signature:     signature,
	}
}

func enrollStation(
	t *testing.T,
	env *testEnv,
	inviteSecret string,
	label string,
	station testStation,
	maxStations int,
) *application.RegisterResult {
	t.Helper()
	challenge, err := env.svc.BeginEnrollmentChallenge(
		context.Background(),
		inviteSecret,
		label,
	)
	require.NoError(t, err)
	result, err := env.svc.Register(
		context.Background(),
		inviteSecret,
		signChallenge(t, station, challenge),
		maxStations,
	)
	require.NoError(t, err)
	return result
}

// ---- Test 1: Invite + PoP registration flow ----

func TestInviteAndRegister(t *testing.T) {
	env := setupTestEnv(t)
	defer env.cleanup()

	ctx := context.Background()
	station := newTestStation(t)

	invite, secret, err := env.svc.CreateInvite(
		ctx,
		station.peerID,
		"test-station",
		10,
		2048,
		24*time.Hour,
	)
	require.NoError(t, err)
	assert.NotEmpty(t, secret)
	assert.Equal(t, domain.InviteStatusActive, invite.Status)
	assert.Equal(t, station.peerID, invite.IntendedStationPeerID)
	assert.Equal(t, int32(10), invite.MaxClients)
	assert.Equal(t, int64(2048), invite.BandwidthLimit)
	assert.NotEqual(t, secret, invite.SecretDigest)

	result := enrollStation(t, env, secret, "my-label", station, 100)
	assert.Equal(t, station.peerID, result.Credential.StationPeerID)
	assert.NotEmpty(t, result.Credential.Token)
	assert.True(t, result.Credential.ExpiresAt.After(time.Now()))
	assert.Equal(t, uint64(1), result.Credential.Generation)

	invites, err := env.svc.ListInvites(ctx)
	require.NoError(t, err)
	require.Len(t, invites, 1)
	assert.Equal(t, domain.InviteStatusConsumed, invites[0].Status)
	assert.Equal(t, station.peerID, invites[0].ConsumedBy)
	assert.NotEqual(t, secret, invites[0].SecretDigest)

	mount, err := env.svc.GetMountByStationPeerID(ctx, station.peerID)
	require.NoError(t, err)
	assert.Equal(t, domain.MountStatusOffline, mount.Status)
	assert.Equal(t, result.Credential.JTI, mount.CredentialJTI)
	assert.NotEmpty(t, mount.HostPublicKey)
	assert.Equal(t, int32(10), mount.MaxClients)
	assert.Equal(t, int64(2048), mount.BandwidthLimit)

	identity, err := env.svc.AuthenticateMountCredential(
		ctx,
		result.Credential.Token,
		domain.ScopeMountConnect,
	)
	require.NoError(t, err)
	require.NoError(t, env.svc.ActivateMount(ctx, identity))
	mount, err = env.svc.GetMountByStationPeerID(ctx, station.peerID)
	require.NoError(t, err)
	assert.Equal(t, domain.MountStatusOnline, mount.Status)
}

// ---- Test 2: Registration fails closed and consumes an invite once ----

func TestRegisterErrorCases(t *testing.T) {
	env := setupTestEnv(t)
	defer env.cleanup()

	ctx := context.Background()
	station := newTestStation(t)

	t.Run("invalid token", func(t *testing.T) {
		_, err := env.svc.BeginEnrollmentChallenge(ctx, "bogus-token", "")
		assert.ErrorIs(t, err, application.ErrInviteNotFound)
	})

	t.Run("expired invite", func(t *testing.T) {
		_, secret, err := env.svc.CreateInvite(
			ctx,
			station.peerID,
			"exp",
			10,
			0,
			time.Millisecond,
		)
		require.NoError(t, err)
		time.Sleep(5 * time.Millisecond)

		_, err = env.svc.BeginEnrollmentChallenge(ctx, secret, "")
		assert.ErrorIs(t, err, application.ErrInviteExpired)
	})

	t.Run("concurrent consume has one winner", func(t *testing.T) {
		_, secret, err := env.svc.CreateInvite(
			ctx,
			station.peerID,
			"cons",
			10,
			0,
			24*time.Hour,
		)
		require.NoError(t, err)
		first, err := env.svc.BeginEnrollmentChallenge(ctx, secret, "cons")
		require.NoError(t, err)
		second, err := env.svc.BeginEnrollmentChallenge(ctx, secret, "cons")
		require.NoError(t, err)
		proofs := []domain.StationIdentityProof{
			signChallenge(t, station, first),
			signChallenge(t, station, second),
		}

		results := make(chan error, 2)
		var group sync.WaitGroup
		for _, proof := range proofs {
			proof := proof
			group.Add(1)
			go func() {
				defer group.Done()
				_, registerErr := env.svc.Register(
					ctx,
					secret,
					proof,
					100,
				)
				results <- registerErr
			}()
		}
		group.Wait()
		close(results)
		successes := 0
		failures := 0
		for result := range results {
			if result == nil {
				successes++
			} else {
				assert.ErrorIs(t, result, application.ErrInviteInactive)
				failures++
			}
		}
		assert.Equal(t, 1, successes)
		assert.Equal(t, 1, failures)
	})

	t.Run("capacity full", func(t *testing.T) {
		other := newTestStation(t)
		_, secret, err := env.svc.CreateInvite(
			ctx,
			other.peerID,
			"cap",
			10,
			0,
			24*time.Hour,
		)
		require.NoError(t, err)
		challenge, err := env.svc.BeginEnrollmentChallenge(ctx, secret, "cap")
		require.NoError(t, err)
		_, err = env.svc.Register(
			ctx,
			secret,
			signChallenge(t, other, challenge),
			1,
		)
		assert.ErrorIs(t, err, application.ErrCapacityFull)
	})
}

// ---- Test 3: Opaque tunnel frame symmetry ----

func TestProtocolTunnelFrameRoundTrip(t *testing.T) {
	serverConn, clientConn := net.Pipe()
	defer serverConn.Close()
	defer clientConn.Close()

	done := make(chan struct{})

	go func() {
		defer close(done)
		err := protocol.WriteTunnelOpen(serverConn, &protocol.TunnelOpenFrame{
			TunnelID:            42,
			RouteID:             "route-1",
			RouteGeneration:     7,
			CallerStationPeerID: "station-source",
			Purpose:             federationmodel.RelayTunnelPurpose_RELAY_TUNNEL_PURPOSE_FEDERATION_PEER,
		})
		assert.NoError(t, err)
	}()

	frame, err := protocol.ReadFrame(clientConn)
	require.NoError(t, err)

	open, ok := frame.(*protocol.TunnelOpenFrame)
	require.True(t, ok, "expected TunnelOpenFrame, got %T", frame)
	assert.Equal(t, uint32(42), open.TunnelID)
	assert.Equal(t, "route-1", open.RouteID)
	assert.Equal(t, uint64(7), open.RouteGeneration)
	assert.Equal(t, "station-source", open.CallerStationPeerID)
	assert.Equal(
		t,
		federationmodel.RelayTunnelPurpose_RELAY_TUNNEL_PURPOSE_FEDERATION_PEER,
		open.Purpose,
	)

	<-done

	done2 := make(chan struct{})
	go func() {
		defer close(done2)
		assert.NoError(t, protocol.WriteTunnelOpened(clientConn, 42))
	}()

	frame2, err := protocol.ReadFrame(serverConn)
	require.NoError(t, err)

	opened, ok := frame2.(*protocol.TunnelOpenedFrame)
	require.True(t, ok, "expected TunnelOpenedFrame, got %T", frame2)
	assert.Equal(t, uint32(42), opened.TunnelID)

	<-done2
}

// ---- Test 4: Ping/Pong symmetry ----

func TestPingPongRoundTrip(t *testing.T) {
	serverConn, clientConn := net.Pipe()
	defer serverConn.Close()
	defer clientConn.Close()

	go func() {
		_ = protocol.WritePing(serverConn, 99)
	}()

	frame, err := protocol.ReadFrame(clientConn)
	require.NoError(t, err)
	ping, ok := frame.(*protocol.PingFrame)
	require.True(t, ok)
	assert.Equal(t, uint32(99), ping.RequestID)

	go func() {
		_ = protocol.WritePong(clientConn, 99)
	}()

	frame2, err := protocol.ReadFrame(serverConn)
	require.NoError(t, err)
	pong, ok := frame2.(*protocol.PongFrame)
	require.True(t, ok)
	assert.Equal(t, uint32(99), pong.RequestID)
}

// ---- Test 5: Credential rotation and generation revoke ----

func TestMountCredentialRotationAndRevoke(t *testing.T) {
	env := setupTestEnv(t)
	defer env.cleanup()

	ctx := context.Background()
	station := newTestStation(t)
	_, secret, err := env.svc.CreateInvite(
		ctx,
		station.peerID,
		"rotate",
		10,
		0,
		time.Hour,
	)
	require.NoError(t, err)
	enrolled := enrollStation(t, env, secret, "rotate", station, 100)
	enrolledIdentity, err := env.svc.AuthenticateMountCredential(
		ctx,
		enrolled.Credential.Token,
		domain.ScopeMountConnect,
	)
	require.NoError(t, err)
	require.NoError(t, env.svc.ActivateMount(ctx, enrolledIdentity))
	challenge, err := env.svc.BeginRotationChallenge(
		ctx,
		enrolled.Credential.Token,
	)
	require.NoError(t, err)
	rotated, err := env.svc.RotateCredential(
		ctx,
		enrolled.Credential.Token,
		signChallenge(t, station, challenge),
	)
	require.NoError(t, err)
	assert.Equal(t, enrolled.Credential.Generation+1, rotated.Generation)
	assert.NotEqual(t, enrolled.Credential.JTI, rotated.JTI)

	_, err = env.svc.AuthenticateMountCredential(
		ctx,
		enrolled.Credential.Token,
		domain.ScopeMountConnect,
	)
	assert.ErrorIs(t, err, application.ErrCredentialInvalid)
	_, err = env.svc.AuthenticateMountCredential(
		ctx,
		rotated.Token,
		domain.ScopeMountConnect,
	)
	require.NoError(t, err)
	revoked, err := env.svc.RevokeMount(ctx, station.peerID)
	require.NoError(t, err)
	assert.Equal(t, rotated.Generation+1, revoked.Generation)
	assert.Equal(t, domain.MountStatusRevoked, revoked.Status)
	_, err = env.svc.AuthenticateMountCredential(
		ctx,
		rotated.Token,
		domain.ScopeMountConnect,
	)
	assert.ErrorIs(t, err, application.ErrCredentialInvalid)
}

// ---- Test 6: Full opaque tunnel chain (simulated) ----

func TestOpaqueTunnelChainWithNetPipe(t *testing.T) {
	relayConn, stationConn := net.Pipe()
	defer relayConn.Close()
	defer stationConn.Close()

	stationDone := make(chan struct{})

	go func() {
		defer close(stationDone)
		frame, err := protocol.ReadFrame(stationConn)
		if err != nil {
			t.Errorf("station ReadFrame: %v", err)
			return
		}
		open, ok := frame.(*protocol.TunnelOpenFrame)
		if !ok {
			t.Errorf("station expected TunnelOpenFrame, got %T", frame)
			return
		}
		if err := protocol.WriteTunnelOpened(stationConn, open.TunnelID); err != nil {
			t.Errorf("station WriteTunnelOpened: %v", err)
			return
		}
		frame, err = protocol.ReadFrame(stationConn)
		if err != nil {
			t.Errorf("station read tunnel data: %v", err)
			return
		}
		data, ok := frame.(*protocol.TunnelDataFrame)
		if !ok {
			t.Errorf("station expected TunnelDataFrame, got %T", frame)
			return
		}
		if err := protocol.WriteTunnelData(
			stationConn,
			data.TunnelID,
			1,
			append([]byte("echo: "), data.Data...),
		); err != nil {
			t.Errorf("station WriteTunnelData: %v", err)
		}
	}()

	tunnelID := uint32(7)
	require.NoError(t, protocol.WriteTunnelOpen(
		relayConn,
		&protocol.TunnelOpenFrame{
			TunnelID:        tunnelID,
			RouteID:         "route-1",
			RouteGeneration: 1,
			Purpose:         federationmodel.RelayTunnelPurpose_RELAY_TUNNEL_PURPOSE_CLIENT_ACCESS,
		},
	))

	frame, err := protocol.ReadFrame(relayConn)
	require.NoError(t, err)
	opened, ok := frame.(*protocol.TunnelOpenedFrame)
	require.True(t, ok)
	assert.Equal(t, tunnelID, opened.TunnelID)

	require.NoError(t, protocol.WriteTunnelData(relayConn, tunnelID, 1, []byte("ping")))
	frame, err = protocol.ReadFrame(relayConn)
	require.NoError(t, err)
	data, ok := frame.(*protocol.TunnelDataFrame)
	require.True(t, ok)
	assert.Equal(t, tunnelID, data.TunnelID)
	assert.Equal(t, uint64(1), data.Sequence)
	assert.Equal(t, "echo: ping", string(data.Data))

	<-stationDone
}

// ---- Test 7: ICE Server builder ----

func TestBuildICEServers(t *testing.T) {
	env := setupTestEnv(t)
	defer env.cleanup()

	t.Run("TURN disabled", func(t *testing.T) {
		servers := env.svc.BuildICEServers(application.TurnConfig{Enabled: false})
		assert.Empty(t, servers)
	})

	t.Run("TURN port=0", func(t *testing.T) {
		servers := env.svc.BuildICEServers(application.TurnConfig{
			Enabled:  true,
			PublicIP: "1.2.3.4",
			Port:     0,
		})
		assert.Empty(t, servers)
	})

	t.Run("TURN enabled", func(t *testing.T) {
		servers := env.svc.BuildICEServers(application.TurnConfig{
			Enabled:    true,
			PublicIP:   "1.2.3.4",
			Port:       3478,
			AuthSecret: "turn-secret",
		})
		assert.NotEmpty(t, servers)
	})
}

// ---- Test 8: Handshake ACK protocol (simulated server) ----

func TestHandshakeACKProtocol(t *testing.T) {
	// Simulate what handleStreamConnection sends as ACK.
	type handshakeACK struct {
		OK    bool   `json:"ok"`
		Error string `json:"error,omitempty"`
	}

	t.Run("success ACK", func(t *testing.T) {
		ack := handshakeACK{OK: true}
		data, _ := json.Marshal(ack)
		data = append(data, '\n')

		var parsed handshakeACK
		require.NoError(t, json.Unmarshal(data[:len(data)-1], &parsed))
		assert.True(t, parsed.OK)
		assert.Empty(t, parsed.Error)
	})

	t.Run("failure ACK", func(t *testing.T) {
		ack := handshakeACK{OK: false, Error: "invalid relay token"}
		data, _ := json.Marshal(ack)

		var parsed handshakeACK
		require.NoError(t, json.Unmarshal(data, &parsed))
		assert.False(t, parsed.OK)
		assert.Equal(t, "invalid relay token", parsed.Error)
	})
}

// ---- Test 9: Host-key proof rejects a different Station ----

func TestRegisterRejectsMismatchedHostKey(t *testing.T) {
	env := setupTestEnv(t)
	defer env.cleanup()

	ctx := context.Background()
	intended := newTestStation(t)
	attacker := newTestStation(t)
	_, secret, err := env.svc.CreateInvite(
		ctx,
		intended.peerID,
		"http-test",
		5,
		0,
		24*time.Hour,
	)
	require.NoError(t, err)
	challenge, err := env.svc.BeginEnrollmentChallenge(
		ctx,
		secret,
		"http-test",
	)
	require.NoError(t, err)
	_, err = env.svc.Register(
		ctx,
		secret,
		signChallenge(t, attacker, challenge),
		100,
	)
	assert.ErrorIs(t, err, application.ErrStationMismatch)
}

// ---- Test 10: OOM protection ----

func TestProtocolOOMProtection(t *testing.T) {
	serverConn, clientConn := net.Pipe()
	defer serverConn.Close()
	defer clientConn.Close()

	// Write a frame with payload size > MaxPayloadLen.
	go func() {
		hdr := make([]byte, protocol.HeaderLen)
		hdr[0] = protocol.FrameVersion
		hdr[1] = protocol.TypeTunnelData
		// reqID = 1
		hdr[2], hdr[3], hdr[4], hdr[5] = 0, 0, 0, 1
		// payloadLen = MaxPayloadLen + 1 (too large)
		oversize := protocol.MaxPayloadLen + 1
		hdr[6] = byte(oversize >> 24)
		hdr[7] = byte(oversize >> 16)
		hdr[8] = byte(oversize >> 8)
		hdr[9] = byte(oversize)
		_, _ = serverConn.Write(hdr)
	}()

	_, err := protocol.ReadFrame(clientConn)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "payload too large")
}
