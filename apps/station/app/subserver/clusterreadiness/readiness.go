package clusterreadiness

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

const stationClusterModeEnvironment = "PEERS_STATION_CLUSTER_MODE"

// SharedPostgres declares one owner whose durable truth is fully contained in
// the Station's canonical PostgreSQL runtime.
func SharedPostgres(owner string) server.ClusterReadinessProbe {
	owner = strings.TrimSpace(owner)
	return func(ctx context.Context) (string, error) {
		if owner == "" {
			return "", fmt.Errorf("cluster owner name is required")
		}
		database, err := store.GetRDS(ctx)
		if err != nil {
			return "", fmt.Errorf("%s: resolve shared PostgreSQL: %w", owner, err)
		}
		identity, err := store.PostgresClusterIdentity(ctx, database)
		if err != nil {
			return "", fmt.Errorf("%s: verify shared PostgreSQL: %w", owner, err)
		}
		return "postgres=" + identity, nil
	}
}

// Stateless declares one owner that keeps no process-local durable truth.
func Stateless(owner string) server.ClusterReadinessProbe {
	identity := "stateless=" + strings.TrimSpace(owner) + ":v1"
	return func(context.Context) (string, error) {
		if strings.TrimSpace(owner) == "" {
			return "", fmt.Errorf("cluster owner name is required")
		}
		return identity, nil
	}
}

// FilesystemBackend selects the ordinary local backend for one-node Station
// mode and the explicit shared-fs contract for cluster mode.
func FilesystemBackend(root string) storage.Backend {
	if strings.EqualFold(
		strings.TrimSpace(os.Getenv(stationClusterModeEnvironment)),
		"cluster",
	) {
		return storage.NewSharedFSBackend(root)
	}
	return storage.NewLocalBackend(root)
}

// SharedPostgresAndFilesystem verifies one owner whose metadata is in
// PostgreSQL and whose bytes are on an explicitly shared filesystem backend.
func SharedPostgresAndFilesystem(
	ctx context.Context,
	owner string,
	database *gorm.DB,
	backend storage.Backend,
) (string, error) {
	owner = strings.TrimSpace(owner)
	if owner == "" || database == nil || backend == nil {
		return "", fmt.Errorf("%s: cluster backing is incomplete", owner)
	}
	databaseIdentity, err := store.PostgresClusterIdentity(ctx, database)
	if err != nil {
		return "", fmt.Errorf("%s: verify shared PostgreSQL: %w", owner, err)
	}
	shared, ok := backend.(storage.ClusterSharedBackend)
	if !ok || !shared.ClusterShared() {
		return "", fmt.Errorf("%s: filesystem backend is not cluster shared", owner)
	}
	identityProvider, ok := backend.(storage.ClusterBackingIdentityProvider)
	if !ok {
		return "", fmt.Errorf("%s: shared filesystem identity is unavailable", owner)
	}
	filesystemIdentity, err := identityProvider.EnsureClusterBackingIdentity(ctx)
	if err != nil {
		return "", fmt.Errorf("%s: verify shared filesystem: %w", owner, err)
	}
	if strings.TrimSpace(filesystemIdentity) == "" {
		return "", fmt.Errorf("%s: shared filesystem identity is empty", owner)
	}
	if err := backend.Healthz(ctx); err != nil {
		return "", fmt.Errorf("%s: shared filesystem health: %w", owner, err)
	}
	return "postgres=" + databaseIdentity + ";filesystem=" + filesystemIdentity, nil
}
