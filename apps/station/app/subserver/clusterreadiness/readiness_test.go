package clusterreadiness

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
)

func TestFilesystemBackendRequiresExplicitClusterMode(t *testing.T) {
	t.Setenv(stationClusterModeEnvironment, "")
	local := FilesystemBackend(t.TempDir())
	if shared, ok := local.(storage.ClusterSharedBackend); ok &&
		shared.ClusterShared() {
		t.Fatal("single-node filesystem declared cluster-shared backing")
	}

	t.Setenv(stationClusterModeEnvironment, "cluster")
	cluster := FilesystemBackend(t.TempDir())
	shared, ok := cluster.(storage.ClusterSharedBackend)
	if !ok || !shared.ClusterShared() {
		t.Fatal("cluster filesystem did not declare shared backing")
	}
	identityProvider := cluster.(storage.ClusterBackingIdentityProvider)
	identity, err := identityProvider.EnsureClusterBackingIdentity(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if identity == "" {
		t.Fatal("cluster filesystem identity is empty")
	}
	if err := cluster.Healthz(t.Context()); err != nil {
		t.Fatalf("cluster filesystem remained unhealthy: %v", err)
	}
}

func TestStatelessProbeHasStableOwnerIdentity(t *testing.T) {
	probe := Stateless("app_meta")
	first, err := probe(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	second, err := probe(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if first != "stateless=app_meta:v1" || second != first {
		t.Fatalf("stateless readiness identity drifted: %q / %q", first, second)
	}
}
