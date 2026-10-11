package native

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type clusterAuthorizationFixture struct {
	stationPeerID string
	nodePeerID    string
}

func (f clusterAuthorizationFixture) ClusterNodeAuthorization(
	context.Context,
) (string, string, uint64, string, error) {
	return f.stationPeerID,
		f.nodePeerID,
		1,
		"authorization-" + f.nodePeerID,
		nil
}

type clusterReadinessSubserverFixture struct {
	name     string
	identity string
}

func (clusterReadinessSubserverFixture) Init(
	context.Context,
	...option.Option,
) error {
	return nil
}

func (clusterReadinessSubserverFixture) Start(
	context.Context,
	...option.Option,
) error {
	return nil
}

func (clusterReadinessSubserverFixture) Stop(context.Context) error {
	return nil
}

func (f clusterReadinessSubserverFixture) Name() string {
	return f.name
}

func (clusterReadinessSubserverFixture) Address() server.SubserverAddress {
	return server.SubserverAddress{}
}

func (clusterReadinessSubserverFixture) Status() server.Status {
	return server.StatusRunning
}

func (clusterReadinessSubserverFixture) Handlers() []server.Handler {
	return nil
}

func (clusterReadinessSubserverFixture) Type() server.SubserverType {
	return server.SubserverTypeHTTP
}

func (f clusterReadinessSubserverFixture) ClusterReadiness(
	context.Context,
) (string, error) {
	return f.identity, nil
}

func TestStationNodeRegistryFencesIncarnationAndBacking(t *testing.T) {
	database, err := gorm.Open(
		sqlite.Open("file:station-cluster-admission?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open registry database: %v", err)
	}
	admission := &stationClusterAdmission{
		config: stationClusterConfig{
			mode:      stationClusterModeSingle,
			lease:     time.Minute,
			heartbeat: 10 * time.Second,
		},
		database: database,
	}
	if err := admission.migrate(t.Context()); err != nil {
		t.Fatalf("migrate registry: %v", err)
	}

	nodeA := clusterRegistryFixture("node-a", "incarnation-a", "backing-one")
	if err := admission.register(t.Context(), nodeA); err != nil {
		t.Fatalf("register node A: %v", err)
	}
	restartedA := clusterRegistryFixture(
		"node-a",
		"incarnation-a-restarted",
		"backing-one",
	)
	if err := admission.register(
		t.Context(),
		restartedA,
	); !errors.Is(err, errStationNodeLeaseHeld) {
		t.Fatalf("live duplicate incarnation error = %v", err)
	}

	nodeBWrongBacking := clusterRegistryFixture(
		"node-b",
		"incarnation-b",
		"backing-two",
	)
	if err := admission.register(
		t.Context(),
		nodeBWrongBacking,
	); !errors.Is(err, errStationClusterBackingMismatch) {
		t.Fatalf("mismatched backing error = %v", err)
	}

	nodeB := clusterRegistryFixture(
		"node-b",
		"incarnation-b",
		"backing-one",
	)
	if err := admission.register(t.Context(), nodeB); err != nil {
		t.Fatalf("register node B: %v", err)
	}

	if err := database.Model(&stationNodeRegistryRecord{}).
		Where(
			"station_peer_id = ? AND node_peer_id = ?",
			nodeA.StationPeerID,
			nodeA.NodePeerID,
		).
		Update("lease_expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatalf("expire node A: %v", err)
	}
	if err := admission.register(t.Context(), restartedA); err != nil {
		t.Fatalf("take over expired node A: %v", err)
	}
}

func TestStationClusterConfigFailsClosed(t *testing.T) {
	t.Setenv(stationClusterModeEnvironment, "maybe")
	if _, err := stationClusterConfigFromEnvironment(); err == nil {
		t.Fatal("invalid cluster mode was accepted")
	}

	t.Setenv(stationClusterModeEnvironment, stationClusterModeEnabled)
	t.Setenv(stationClusterLeaseEnvironment, "10")
	t.Setenv(stationClusterHeartbeatEnvironment, "5")
	if _, err := stationClusterConfigFromEnvironment(); err == nil {
		t.Fatal("undersized cluster lease was accepted")
	}
}

func TestPostgresStationClusterAdmission(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("NCP_CLUSTER_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("NCP_CLUSTER_POSTGRES_DSN is not configured")
	}
	database, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = sqlDatabase.Close()
	})
	admission := &stationClusterAdmission{
		config: stationClusterConfig{
			mode:      stationClusterModeEnabled,
			lease:     time.Minute,
			heartbeat: 10 * time.Second,
		},
		database: database,
	}
	if err := admission.migrate(t.Context()); err != nil {
		t.Fatal(err)
	}
	backingIdentity, err := store.PostgresClusterIdentity(
		t.Context(),
		database,
	)
	if err != nil {
		t.Fatal(err)
	}
	stationPeerID := "ncp-cluster-station"
	if err := database.Where(
		"station_peer_id = ?",
		stationPeerID,
	).Delete(&stationNodeRegistryRecord{}).Error; err != nil {
		t.Fatal(err)
	}
	serverOptions := &server.Options{
		Address: "127.0.0.1:18080",
		SubserverInstances: map[string]server.Subserver{
			"events": clusterReadinessSubserverFixture{
				name:     "events",
				identity: backingIdentity,
			},
			"agent": clusterReadinessSubserverFixture{
				name:     "agent",
				identity: backingIdentity,
			},
			"oss": clusterReadinessSubserverFixture{
				name:     "oss",
				identity: "shared-object-namespace",
			},
		},
	}
	nodeA := clusterReadinessSnapshot(
		t,
		admission,
		serverOptions,
		stationPeerID,
		clusterNodeIdentity("a"),
		clusterNodeIncarnation("a"),
	)
	nodeB := clusterReadinessSnapshot(
		t,
		admission,
		serverOptions,
		stationPeerID,
		clusterNodeIdentity("b"),
		clusterNodeIncarnation("b"),
	)
	if err := admission.register(t.Context(), nodeA); err != nil {
		t.Fatal(err)
	}
	if err := admission.register(t.Context(), nodeB); err != nil {
		t.Fatal(err)
	}
	var readyCount int64
	if err := database.Model(&stationNodeRegistryRecord{}).
		Where(
			"station_peer_id = ? AND cluster_ready = ? AND "+
				"lifecycle_state = ? AND lease_expires_at > CURRENT_TIMESTAMP",
			stationPeerID,
			true,
			stationNodeStateReady,
		).
		Count(&readyCount).Error; err != nil {
		t.Fatal(err)
	}
	if readyCount != 2 {
		t.Fatalf("ready node count = %d, want 2", readyCount)
	}
	assertConcurrentStationAdmissionIsFenced(
		t,
		admission,
		stationPeerID+"-concurrent",
		backingIdentity,
	)
	if path := strings.TrimSpace(
		os.Getenv("NCP_CLUSTER_RESULT_PATH"),
	); path != "" {
		payload := map[string]any{
			"artifactKind": "ncp-cluster-admission-process-result",
			"status":       "passed",
			"scenarios": map[string]any{
				"NCP-G06-READINESS": map[string]any{
					"stationPeerId":      stationPeerID,
					"nodePeerIds":        []string{nodeA.NodePeerID, nodeB.NodePeerID},
					"incarnations":       []string{nodeA.Incarnation, nodeB.Incarnation},
					"readyNodeCount":     readyCount,
					"sharedBackingMatch": true,
					"schemaRevision":     stationClusterSchema,
				},
			},
		}
		encoded, err := json.MarshalIndent(payload, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, append(encoded, '\n'), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func clusterReadinessSnapshot(
	t *testing.T,
	base *stationClusterAdmission,
	serverOptions *server.Options,
	stationPeerID string,
	nodePeerID string,
	incarnation string,
) stationNodeRegistryRecord {
	t.Helper()
	admission := &stationClusterAdmission{
		config:        base.config,
		database:      base.database,
		serverOptions: serverOptions,
		authorization: clusterAuthorizationFixture{
			stationPeerID: stationPeerID,
			nodePeerID:    nodePeerID,
		},
		stationPeerID: stationPeerID,
		nodePeerID:    nodePeerID,
		incarnation:   incarnation,
		endpoint:      serverOptions.Address,
		keyringReadiness: func(context.Context) (string, error) {
			return "shared-keyring-id", nil
		},
	}
	snapshot, err := admission.readinessSnapshot(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func assertConcurrentStationAdmissionIsFenced(
	t *testing.T,
	admission *stationClusterAdmission,
	stationPeerID string,
	backingIdentity string,
) {
	t.Helper()
	if err := admission.database.Where(
		"station_peer_id = ?",
		stationPeerID,
	).Delete(&stationNodeRegistryRecord{}).Error; err != nil {
		t.Fatal(err)
	}
	left := clusterRegistryFixture(
		"concurrent-node",
		"concurrent-incarnation-left",
		backingIdentity,
	)
	left.StationPeerID = stationPeerID
	right := left
	right.Incarnation = "concurrent-incarnation-right"
	start := make(chan struct{})
	results := make(chan error, 2)
	var workers sync.WaitGroup
	for _, snapshot := range []stationNodeRegistryRecord{left, right} {
		workers.Add(1)
		go func(snapshot stationNodeRegistryRecord) {
			defer workers.Done()
			<-start
			results <- admission.register(t.Context(), snapshot)
		}(snapshot)
	}
	close(start)
	workers.Wait()
	close(results)

	successes := 0
	leaseConflicts := 0
	for err := range results {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, errStationNodeLeaseHeld):
			leaseConflicts++
		default:
			t.Fatalf("unexpected concurrent admission error: %v", err)
		}
	}
	if successes != 1 || leaseConflicts != 1 {
		t.Fatalf(
			"concurrent admission successes=%d lease_conflicts=%d",
			successes,
			leaseConflicts,
		)
	}
}

func clusterNodeIdentity(suffix string) string {
	value := strings.TrimSpace(os.Getenv(
		"NCP_CLUSTER_NODE_" + strings.ToUpper(suffix) + "_ID",
	))
	if value != "" {
		return value
	}
	return "cluster-node-" + suffix
}

func clusterNodeIncarnation(suffix string) string {
	value := strings.TrimSpace(os.Getenv(
		"NCP_CLUSTER_NODE_" + strings.ToUpper(suffix) + "_INCARNATION",
	))
	if value != "" {
		return value
	}
	return "cluster-incarnation-" + suffix
}

func clusterRegistryFixture(
	nodePeerID string,
	incarnation string,
	backingDigest string,
) stationNodeRegistryRecord {
	return stationNodeRegistryRecord{
		StationPeerID:       "station-one",
		NodePeerID:          nodePeerID,
		NodePublicKeyDigest: clusterDigest("node", []string{nodePeerID}),
		AuthorizationDigest: "authorization-" + nodePeerID,
		AuthorizationEpoch:  1,
		Incarnation:         incarnation,
		Mode:                stationClusterModeEnabled,
		ClusterReady:        true,
		LifecycleState:      stationNodeStateReady,
		EndpointDigest:      "endpoint-" + nodePeerID,
		SchemaRevision:      stationClusterSchema,
		SharedBackingDigest: backingDigest,
		EnabledOwnersDigest: "owners-one",
		LeaseExpiresAt:      time.Now().Add(time.Minute),
		CreatedAt:           time.Now(),
		UpdatedAt:           time.Now(),
	}
}
