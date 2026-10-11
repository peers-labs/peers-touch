package native

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/runtime/role"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	stationClusterModeEnvironment      = "PEERS_STATION_CLUSTER_MODE"
	stationClusterLeaseEnvironment     = "PEERS_STATION_CLUSTER_LEASE_SECONDS"
	stationClusterHeartbeatEnvironment = "PEERS_STATION_CLUSTER_HEARTBEAT_SECONDS"

	stationClusterModeSingle  = "single"
	stationClusterModeEnabled = "cluster"
	stationClusterSchema      = uint32(1)

	stationNodeStateReady   = "READY"
	stationNodeStateStopped = "STOPPED"
)

var (
	errStationNodeLeaseHeld = errors.New(
		"Station node PeerID is already held by another live incarnation",
	)
	errStationClusterBackingMismatch = errors.New(
		"Station cluster backing differs from a live node",
	)
)

type clusterNodeAuthorizationProvider interface {
	ClusterNodeAuthorization(context.Context) (
		stationPeerID string,
		nodePeerID string,
		authorizationEpoch uint64,
		authorizationDigest string,
		err error,
	)
}

type clusterReadinessProvider interface {
	ClusterReadiness(context.Context) (backingIdentity string, err error)
}

type stationNodeRegistryRecord struct {
	StationPeerID       string    `gorm:"column:station_peer_id;size:255;primaryKey;priority:1"`
	NodePeerID          string    `gorm:"column:node_peer_id;size:255;primaryKey;priority:2"`
	NodePublicKeyDigest string    `gorm:"column:node_public_key_digest;size:64;not null"`
	AuthorizationDigest string    `gorm:"column:authorization_digest;size:64;not null"`
	AuthorizationEpoch  uint64    `gorm:"column:authorization_epoch;not null"`
	Incarnation         string    `gorm:"column:incarnation;size:64;not null"`
	Mode                string    `gorm:"column:mode;size:16;not null"`
	ClusterReady        bool      `gorm:"column:cluster_ready;not null;index"`
	LifecycleState      string    `gorm:"column:lifecycle_state;size:16;not null;index"`
	Draining            bool      `gorm:"column:draining;not null"`
	EndpointDigest      string    `gorm:"column:endpoint_digest;size:64;not null"`
	SchemaRevision      uint32    `gorm:"column:schema_revision;not null"`
	SharedBackingDigest string    `gorm:"column:shared_backing_digest;size:64;not null"`
	EnabledOwnersDigest string    `gorm:"column:enabled_owners_digest;size:64;not null"`
	LeaseExpiresAt      time.Time `gorm:"column:lease_expires_at;not null;index"`
	CreatedAt           time.Time `gorm:"column:created_at;not null"`
	UpdatedAt           time.Time `gorm:"column:updated_at;not null"`
}

func (stationNodeRegistryRecord) TableName() string {
	return "station_node_registry"
}

type stationClusterConfig struct {
	mode      string
	lease     time.Duration
	heartbeat time.Duration
}

type stationClusterAdmission struct {
	config           stationClusterConfig
	database         *gorm.DB
	serverOptions    *server.Options
	authorization    clusterNodeAuthorizationProvider
	stationPeerID    string
	nodePeerID       string
	incarnation      string
	endpoint         string
	keyringReadiness func(context.Context) (string, error)

	cancel context.CancelFunc
	done   chan struct{}

	failure chan error
	once    sync.Once
}

func stationClusterConfigFromEnvironment() (stationClusterConfig, error) {
	mode := strings.ToLower(strings.TrimSpace(
		os.Getenv(stationClusterModeEnvironment),
	))
	if mode == "" {
		mode = stationClusterModeSingle
	}
	if mode != stationClusterModeSingle &&
		mode != stationClusterModeEnabled {
		return stationClusterConfig{}, fmt.Errorf(
			"%s must be single or cluster",
			stationClusterModeEnvironment,
		)
	}
	lease, err := clusterDurationFromEnvironment(
		stationClusterLeaseEnvironment,
		15*time.Second,
	)
	if err != nil {
		return stationClusterConfig{}, err
	}
	heartbeat, err := clusterDurationFromEnvironment(
		stationClusterHeartbeatEnvironment,
		5*time.Second,
	)
	if err != nil {
		return stationClusterConfig{}, err
	}
	if heartbeat <= 0 || lease < heartbeat*3 {
		return stationClusterConfig{}, fmt.Errorf(
			"Station cluster lease must be at least three heartbeat intervals",
		)
	}
	return stationClusterConfig{
		mode:      mode,
		lease:     lease,
		heartbeat: heartbeat,
	}, nil
}

func clusterDurationFromEnvironment(
	name string,
	fallback time.Duration,
) (time.Duration, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback, nil
	}
	seconds, err := strconv.ParseInt(raw, 10, 32)
	if err != nil || seconds <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", name)
	}
	return time.Duration(seconds) * time.Second, nil
}

func newStationClusterAdmission(
	ctx context.Context,
	processRole role.Role,
	stationPeerID string,
	nodePeerID string,
	incarnation string,
	serverOptions *server.Options,
) (*stationClusterAdmission, error) {
	if processRole != role.Station {
		return nil, nil
	}
	config, err := stationClusterConfigFromEnvironment()
	if err != nil {
		return nil, err
	}
	if serverOptions == nil {
		return nil, fmt.Errorf("Station cluster admission requires server options")
	}
	bootstrap := serverOptions.SubserverInstances["bootstrap"]
	authorization, ok := bootstrap.(clusterNodeAuthorizationProvider)
	if !ok {
		return nil, fmt.Errorf(
			"Station cluster admission requires bootstrap node authorization",
		)
	}
	database, err := store.GetRDS(ctx)
	if err != nil {
		return nil, fmt.Errorf(
			"Station cluster admission database: %w",
			err,
		)
	}
	return &stationClusterAdmission{
		config:           config,
		database:         database,
		serverOptions:    serverOptions,
		authorization:    authorization,
		stationPeerID:    strings.TrimSpace(stationPeerID),
		nodePeerID:       strings.TrimSpace(nodePeerID),
		incarnation:      strings.TrimSpace(incarnation),
		endpoint:         strings.TrimSpace(serverOptions.Address),
		keyringReadiness: coreauth.StationAccessKeyringReady,
		failure:          make(chan error, 1),
		done:             make(chan struct{}),
	}, nil
}

func newNodeIncarnation() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", fmt.Errorf("generate Station node incarnation: %w", err)
	}
	return hex.EncodeToString(value[:]), nil
}

func (a *stationClusterAdmission) Failure() <-chan error {
	if a == nil {
		return nil
	}
	return a.failure
}

func (a *stationClusterAdmission) Admit(ctx context.Context) error {
	if a == nil {
		return nil
	}
	if err := a.migrate(ctx); err != nil {
		return err
	}
	snapshot, err := a.readinessSnapshot(ctx)
	if err != nil {
		return err
	}
	if err := a.register(ctx, snapshot); err != nil {
		return err
	}
	runContext, cancel := context.WithCancel(ctx)
	a.cancel = cancel
	go a.runHeartbeat(runContext, snapshot)
	return nil
}

func (a *stationClusterAdmission) readinessSnapshot(
	ctx context.Context,
) (stationNodeRegistryRecord, error) {
	if a.stationPeerID == "" ||
		a.nodePeerID == "" ||
		a.incarnation == "" {
		return stationNodeRegistryRecord{}, fmt.Errorf(
			"Station cluster identity is incomplete",
		)
	}
	stationPeerID, nodePeerID, epoch, authorizationDigest, err :=
		a.authorization.ClusterNodeAuthorization(ctx)
	if err != nil {
		return stationNodeRegistryRecord{}, fmt.Errorf(
			"verify Station node authorization: %w",
			err,
		)
	}
	if stationPeerID != a.stationPeerID ||
		nodePeerID != a.nodePeerID ||
		epoch == 0 ||
		strings.TrimSpace(authorizationDigest) == "" {
		return stationNodeRegistryRecord{}, fmt.Errorf(
			"Station node authorization does not match the process identity",
		)
	}
	keyID, err := a.keyringReadiness(ctx)
	if err != nil {
		return stationNodeRegistryRecord{}, fmt.Errorf(
			"verify Station Access keyring: %w",
			err,
		)
	}
	ownerNames := make([]string, 0, len(a.serverOptions.SubserverInstances))
	for name, subserver := range a.serverOptions.SubserverInstances {
		if subserver == nil {
			return stationNodeRegistryRecord{}, fmt.Errorf(
				"Station subserver %q is unavailable",
				name,
			)
		}
		ownerNames = append(ownerNames, name)
		if a.config.mode == stationClusterModeEnabled &&
			subserver.Status() != server.StatusRunning {
			return stationNodeRegistryRecord{}, fmt.Errorf(
				"Station subserver %q is not running",
				name,
			)
		}
	}
	sort.Strings(ownerNames)

	backingIdentities := []string{"keyring=" + keyID}
	if a.config.mode == stationClusterModeEnabled {
		databaseIdentity, err := store.PostgresClusterIdentity(
			ctx,
			a.database,
		)
		if err != nil {
			return stationNodeRegistryRecord{}, err
		}
		backingIdentities = append(
			backingIdentities,
			"database="+databaseIdentity,
		)
		for _, owner := range ownerNames {
			if owner == "bootstrap" {
				continue
			}
			subserver := a.serverOptions.SubserverInstances[owner]
			provider, ok := subserver.(clusterReadinessProvider)
			if !ok {
				return stationNodeRegistryRecord{}, fmt.Errorf(
					"enabled owner %q does not declare cluster readiness",
					owner,
				)
			}
			identity, err := provider.ClusterReadiness(ctx)
			if err != nil {
				return stationNodeRegistryRecord{}, fmt.Errorf(
					"owner %q is not cluster ready: %w",
					owner,
					err,
				)
			}
			if strings.TrimSpace(identity) == "" {
				return stationNodeRegistryRecord{}, fmt.Errorf(
					"owner %q returned an empty cluster backing identity",
					owner,
				)
			}
			backingIdentities = append(
				backingIdentities,
				owner+"="+identity,
			)
		}
	} else {
		backingIdentities = append(
			backingIdentities,
			"database=single-node-"+a.database.Dialector.Name(),
		)
	}
	sort.Strings(backingIdentities)
	return stationNodeRegistryRecord{
		StationPeerID:       a.stationPeerID,
		NodePeerID:          a.nodePeerID,
		NodePublicKeyDigest: clusterDigest("node", []string{a.nodePeerID}),
		AuthorizationDigest: authorizationDigest,
		AuthorizationEpoch:  epoch,
		Incarnation:         a.incarnation,
		Mode:                a.config.mode,
		ClusterReady:        a.config.mode == stationClusterModeEnabled,
		LifecycleState:      stationNodeStateReady,
		Draining:            false,
		EndpointDigest: clusterDigest(
			"endpoint",
			[]string{a.endpoint},
		),
		SchemaRevision:      stationClusterSchema,
		SharedBackingDigest: clusterDigest("backing", backingIdentities),
		EnabledOwnersDigest: clusterDigest("owners", ownerNames),
	}, nil
}

func clusterDigest(domain string, values []string) string {
	digest := sha256.New()
	_, _ = digest.Write([]byte(domain))
	_, _ = digest.Write([]byte{0})
	for _, value := range values {
		_, _ = digest.Write([]byte(value))
		_, _ = digest.Write([]byte{0})
	}
	return hex.EncodeToString(digest.Sum(nil))
}

func (a *stationClusterAdmission) migrate(ctx context.Context) error {
	if a.config.mode == stationClusterModeEnabled {
		if err := store.MigratePostgresClusterIdentity(
			ctx,
			a.database,
		); err != nil {
			return err
		}
	}
	return a.database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if tx.Dialector.Name() == "postgres" {
			if err := tx.Exec(
				"SELECT pg_advisory_xact_lock(?)",
				int64(0x505453544e4f4445),
			).Error; err != nil {
				return fmt.Errorf("lock Station node registry migration: %w", err)
			}
		}
		if err := tx.AutoMigrate(&stationNodeRegistryRecord{}); err != nil {
			return fmt.Errorf("migrate Station node registry: %w", err)
		}
		return nil
	})
}

func (a *stationClusterAdmission) register(
	ctx context.Context,
	snapshot stationNodeRegistryRecord,
) error {
	return a.database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockStationClusterAdmission(
			tx,
			snapshot.StationPeerID,
		); err != nil {
			return err
		}
		now, err := clusterDatabaseTime(tx)
		if err != nil {
			return err
		}
		var current stationNodeRegistryRecord
		err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"station_peer_id = ? AND node_peer_id = ?",
				snapshot.StationPeerID,
				snapshot.NodePeerID,
			).
			First(&current).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err == nil {
			currentLive := current.LifecycleState == stationNodeStateReady &&
				current.LeaseExpiresAt.After(now)
			if current.AuthorizationEpoch > snapshot.AuthorizationEpoch {
				return fmt.Errorf("Station node authorization epoch is stale")
			}
			if currentLive &&
				current.Incarnation != snapshot.Incarnation {
				return errStationNodeLeaseHeld
			}
		}
		if snapshot.ClusterReady {
			var peers []stationNodeRegistryRecord
			if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
				Where(
					"station_peer_id = ? AND node_peer_id <> ? AND "+
						"cluster_ready = ? AND lifecycle_state = ? AND "+
						"draining = ? AND lease_expires_at > ?",
					snapshot.StationPeerID,
					snapshot.NodePeerID,
					true,
					stationNodeStateReady,
					false,
					now,
				).
				Find(&peers).Error; err != nil {
				return err
			}
			for i := range peers {
				if peers[i].SchemaRevision != snapshot.SchemaRevision ||
					peers[i].SharedBackingDigest !=
						snapshot.SharedBackingDigest ||
					peers[i].EnabledOwnersDigest !=
						snapshot.EnabledOwnersDigest {
					return errStationClusterBackingMismatch
				}
			}
		}
		snapshot.LeaseExpiresAt = now.Add(a.config.lease)
		snapshot.UpdatedAt = now
		if current.CreatedAt.IsZero() {
			snapshot.CreatedAt = now
		} else {
			snapshot.CreatedAt = current.CreatedAt
		}
		return tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{
				{Name: "station_peer_id"},
				{Name: "node_peer_id"},
			},
			DoUpdates: clause.AssignmentColumns([]string{
				"node_public_key_digest",
				"authorization_digest",
				"authorization_epoch",
				"incarnation",
				"mode",
				"cluster_ready",
				"lifecycle_state",
				"draining",
				"endpoint_digest",
				"schema_revision",
				"shared_backing_digest",
				"enabled_owners_digest",
				"lease_expires_at",
				"updated_at",
			}),
		}).Create(&snapshot).Error
	})
}

func lockStationClusterAdmission(
	database *gorm.DB,
	stationPeerID string,
) error {
	if database.Dialector.Name() != "postgres" {
		return nil
	}
	digest := sha256.Sum256([]byte(
		"peers-touch/station-cluster-admission/v1\x00" + stationPeerID,
	))
	lockID := int64(binary.BigEndian.Uint64(digest[:8]))
	if err := database.Exec(
		"SELECT pg_advisory_xact_lock(?)",
		lockID,
	).Error; err != nil {
		return fmt.Errorf("lock Station cluster admission: %w", err)
	}
	return nil
}

func clusterDatabaseTime(database *gorm.DB) (time.Time, error) {
	if database.Dialector.Name() != "postgres" {
		return time.Now().UTC(), nil
	}
	var row struct {
		Now time.Time `gorm:"column:now"`
	}
	if err := database.Raw("SELECT CURRENT_TIMESTAMP AS now").
		Scan(&row).Error; err != nil {
		return time.Time{}, fmt.Errorf("read Station database time: %w", err)
	}
	if row.Now.IsZero() {
		return time.Time{}, fmt.Errorf("Station database returned zero time")
	}
	return row.Now.UTC(), nil
}

func (a *stationClusterAdmission) runHeartbeat(
	ctx context.Context,
	snapshot stationNodeRegistryRecord,
) {
	defer close(a.done)
	ticker := time.NewTicker(a.config.heartbeat)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			current, err := a.readinessSnapshot(ctx)
			if err == nil && (current.StationPeerID != snapshot.StationPeerID ||
				current.NodePeerID != snapshot.NodePeerID ||
				current.Incarnation != snapshot.Incarnation ||
				current.Mode != snapshot.Mode ||
				current.ClusterReady != snapshot.ClusterReady ||
				current.SchemaRevision != snapshot.SchemaRevision ||
				current.SharedBackingDigest != snapshot.SharedBackingDigest ||
				current.EnabledOwnersDigest != snapshot.EnabledOwnersDigest) {
				err = fmt.Errorf(
					"Station cluster readiness contract changed during the node lease",
				)
			}
			if err == nil &&
				(current.AuthorizationEpoch != snapshot.AuthorizationEpoch ||
					current.AuthorizationDigest != snapshot.AuthorizationDigest) {
				err = a.register(ctx, current)
				if err == nil {
					snapshot = current
				}
			}
			if err == nil {
				err = a.renew(ctx, snapshot)
			}
			if err != nil {
				a.once.Do(func() {
					a.failure <- err
				})
				return
			}
		}
	}
}

func (a *stationClusterAdmission) renew(
	ctx context.Context,
	snapshot stationNodeRegistryRecord,
) error {
	return a.database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now, err := clusterDatabaseTime(tx)
		if err != nil {
			return err
		}
		result := tx.Model(&stationNodeRegistryRecord{}).
			Where(
				"station_peer_id = ? AND node_peer_id = ? AND "+
					"incarnation = ? AND authorization_digest = ? AND "+
					"authorization_epoch = ? AND lifecycle_state = ? AND "+
					"draining = ? AND lease_expires_at > ?",
				snapshot.StationPeerID,
				snapshot.NodePeerID,
				snapshot.Incarnation,
				snapshot.AuthorizationDigest,
				snapshot.AuthorizationEpoch,
				stationNodeStateReady,
				false,
				now,
			).
			Updates(map[string]any{
				"lease_expires_at": now.Add(a.config.lease),
				"updated_at":       now,
			})
		if result.Error != nil {
			return fmt.Errorf("renew Station node lease: %w", result.Error)
		}
		if result.RowsAffected != 1 {
			return fmt.Errorf("renew Station node lease: authority is stale")
		}
		return nil
	})
}

func (a *stationClusterAdmission) Stop(ctx context.Context) error {
	if a == nil {
		return nil
	}
	if a.cancel != nil {
		a.cancel()
		<-a.done
	}
	return a.database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now, err := clusterDatabaseTime(tx)
		if err != nil {
			return err
		}
		result := tx.Model(&stationNodeRegistryRecord{}).
			Where(
				"station_peer_id = ? AND node_peer_id = ? AND incarnation = ?",
				a.stationPeerID,
				a.nodePeerID,
				a.incarnation,
			).
			Updates(map[string]any{
				"lifecycle_state":  stationNodeStateStopped,
				"cluster_ready":    false,
				"draining":         true,
				"lease_expires_at": now,
				"updated_at":       now,
			})
		if result.Error != nil {
			return fmt.Errorf("release Station node lease: %w", result.Error)
		}
		return nil
	})
}
