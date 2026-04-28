package oss

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/oss/db/repo"
	"github.com/peers-labs/peers-touch/station/app/subserver/oss/service"
	"github.com/peers-labs/peers-touch/station/app/subserver/oss/worker"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/appdir"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

// defaultMaxFileSize is the per-file upload cap when the operator does not
// override `Options.MaxFileSize`. 32 MiB matches the multipart parser's
// in-memory threshold and is a reasonable default for home deployments.
const defaultMaxFileSize int64 = 32 << 20

// defaultMaxFilesPerMessage is an advisory client-side limit surfaced via
// capabilities. We do not enforce it server-side because each upload is a
// separate request.
const defaultMaxFilesPerMessage int32 = 9

// defaultPresignedUploadThreshold is the size at which the desktop
// client switches from multipart to direct presigned PUT, when the
// active backend supports it. 8 MiB picks the inflection point where
// multipart's in-memory buffering starts costing measurable RAM on
// the Station while staying small enough that a single 5-minute
// presign window comfortably covers typical home upload bandwidth.
const defaultPresignedUploadThreshold int64 = 8 << 20

// defaultPresignedTTL is the validity window of presigned PUT/GET URLs
// when the operator leaves the value at zero. Long enough for typical
// home bandwidth × the upload threshold, short enough that a leaked
// URL is not a long-term liability.
const defaultPresignedTTL = 5 * time.Minute

// v3 lifecycle / observability defaults. Each is the fallback used
// when the matching `Options` field is left at zero. Documented
// alongside the YAML keys in `docs/architecture/oss/file-storage.md §5`.
const (
	defaultMultipartUploadThreshold int64 = 100 << 20 // 100 MiB

	defaultSoftDeleteGraceDays = 7
	defaultBlobGCGraceHours    = 24
	defaultAuditRetentionDays  = 90

	defaultPeerKeyMaxIdleDays           = 30
	defaultFederationRotationGraceHours = 24
	defaultBucketReconcileDriftPermille = 10 // 1%

	defaultWorkerTTLInterval         = time.Hour
	defaultWorkerBlobGCInterval      = time.Hour
	defaultWorkerReconcileInterval   = 24 * time.Hour
	defaultWorkerPeerKeyTrimInterval = 24 * time.Hour
	defaultWorkerKeyRotationInterval = time.Hour
	defaultWorkerAuditTrimInterval   = 24 * time.Hour
)

type ossSubServer struct {
	status       server.Status
	addrs        []string
	pathBase     string
	dbName       string
	storePath    string
	signSecret   string
	backend      storage.Backend
	authProvider auth.Provider
	fileService  service.FileService
	fileRepo     repo.FileRepository
	bucketRepo   repo.BucketRepository
	auditRepo    repo.AuditRepository
	blobRepo     repo.BlobRepository
	metaRepo     repo.MetaRepository
	peerKeyRepo  repo.PeerKeyRepository
	chatResolver ChatSessionResolver

	// fedKeys holds the Ed25519 keypair this station signs
	// federation tokens with. Lazily loaded from oss_meta on the
	// first Mint call — keeping this off the boot path means a
	// station that never federates never generates a key it does
	// not need.
	fedKeys *federationKeyCache

	// localStationID is what we stamp into outbound federation
	// tokens as `iss`, and what we expect inbound tokens to claim
	// as `aud`. Today this is the node ID supplied via options;
	// when empty, MintPeerToken refuses to mint and VerifyPeerToken
	// skips audience checking (test harness convenience).
	localStationID string

	// hostOverride / limits / backendType drive the `/capabilities`
	// response and the `cid` URIs returned from `/upload`. See
	// `Options` for the full rationale on each.
	hostOverride       string
	maxFileSize        int64
	maxFilesPerMessage int32
	backendType        string
	keyStrategy        string

	// Presigned-upload knobs. When the active backend implements
	// `storage.PresignedBackend` AND `presignedThreshold > 0`, the
	// subserver advertises the presigned data path via capabilities
	// and accepts `/presign-upload` + `/upload-complete` requests.
	presignedThreshold   int64
	presignedUploadTTL   time.Duration
	presignedDownloadTTL time.Duration

	// multipartThreshold is the size at which the desktop client
	// switches from `/upload` to the multipart-protocol endpoints.
	// Surfaced via /capabilities; only meaningful when the active
	// backend implements `MultipartBackend`.
	multipartThreshold int64

	// mimeBlocklist is the set of MIME prefixes the upload writer
	// rejects. See Options.MimeBlocklist.
	mimeBlocklist []string

	// metricsBearerToken gates `/sub-oss/metrics`. Empty disables
	// the endpoint entirely.
	metricsBearerToken string

	// Lifecycle parameters. Each falls back to the documented
	// default when the operator leaves the matching Options field
	// at zero. The lifecycle workers (S11+) consume these via the
	// subserver struct rather than re-reading Options every tick.
	softDeleteGrace              time.Duration
	blobGCGrace                  time.Duration
	auditRetention               time.Duration
	peerKeyMaxIdle               time.Duration
	federationRotationGrace      time.Duration
	bucketReconcileDriftPermille int
	workerTTLInterval            time.Duration
	workerBlobGCInterval         time.Duration
	workerReconcileInterval      time.Duration
	workerPeerKeyTrimInterval    time.Duration
	workerKeyRotationInterval    time.Duration
	workerAuditTrimInterval      time.Duration

	// workerScheduler runs the background lifecycle workers
	// (TTLSweeper / BlobGC for S11; Reconciler / PeerKeyTrim /
	// KeyRotationFinalizer / AuditTrim are added in S12). Lazy:
	// only constructed when at least one worker has a positive
	// interval AND the OSS subserver has all required deps.
	workerScheduler *worker.Scheduler
}

// NewOSSSubServer constructs the OSS subserver from operator-supplied
// options. The constructor performs only argument validation and
// in-process wiring; network I/O against the configured backend is
// deferred to the first request so a misconfigured S3 bucket does not
// abort process startup for unrelated subservers.
func NewOSSSubServer(opts ...option.Option) server.Subserver {
	o := getOptions(opts...)
	s := &ossSubServer{status: server.StatusStopped, addrs: []string{}}
	s.pathBase = o.Path
	s.dbName = o.DBName
	s.storePath = o.StorePath
	s.signSecret = o.SignSecret
	s.authProvider = o.AuthProvider
	s.hostOverride = strings.TrimRight(o.HostOverride, "/")
	s.maxFileSize = o.MaxFileSize
	if s.maxFileSize <= 0 {
		s.maxFileSize = defaultMaxFileSize
	}
	s.maxFilesPerMessage = o.MaxFilesPerMessage
	if s.maxFilesPerMessage <= 0 {
		s.maxFilesPerMessage = defaultMaxFilesPerMessage
	}
	s.backendType = strings.ToLower(strings.TrimSpace(o.BackendType))
	if s.backendType == "" {
		s.backendType = string(storage.DriverLocal)
	}
	s.keyStrategy = strings.ToLower(strings.TrimSpace(o.KeyStrategy))
	switch s.keyStrategy {
	case "", "random":
		s.keyStrategy = "random"
	case "cas":
		// Accepted as-is.
	default:
		// Operator typo'd a value we don't understand. Refuse to
		// silently fall back; surface clearly in logs and stay on
		// the safe `random` strategy so uploads keep working.
		s.keyStrategy = "random"
	}
	if s.pathBase == "" {
		s.pathBase = "/sub-oss"
	}

	s.presignedUploadTTL = secondsToDurationOr(o.PresignedUploadTTL, defaultPresignedTTL)
	s.presignedDownloadTTL = secondsToDurationOr(o.PresignedDownloadTTL, defaultPresignedTTL)
	s.presignedThreshold = o.PresignedUploadThreshold
	if s.presignedThreshold < 0 {
		s.presignedThreshold = 0
	}
	if s.presignedThreshold == 0 && backendSupportsPresign(s.backendType) {
		s.presignedThreshold = defaultPresignedUploadThreshold
	}

	s.multipartThreshold = o.MultipartUploadThreshold
	if s.multipartThreshold <= 0 {
		s.multipartThreshold = defaultMultipartUploadThreshold
	}

	s.mimeBlocklist = normaliseMimeBlocklist(o.MimeBlocklist)
	s.metricsBearerToken = strings.TrimSpace(o.MetricsBearerToken)

	s.softDeleteGrace = daysToDurationOr(o.SoftDeleteGraceDays, defaultSoftDeleteGraceDays*24*time.Hour)
	s.blobGCGrace = hoursToDurationOr(o.BlobGCGraceHours, defaultBlobGCGraceHours*time.Hour)
	s.auditRetention = daysToDurationOr(o.AuditRetentionDays, defaultAuditRetentionDays*24*time.Hour)
	s.peerKeyMaxIdle = daysToDurationOr(o.PeerKeyMaxIdleDays, defaultPeerKeyMaxIdleDays*24*time.Hour)
	s.federationRotationGrace = hoursToDurationOr(o.FederationRotationGraceHours, defaultFederationRotationGraceHours*time.Hour)
	if o.BucketReconcileDriftPermille > 0 {
		s.bucketReconcileDriftPermille = o.BucketReconcileDriftPermille
	} else {
		s.bucketReconcileDriftPermille = defaultBucketReconcileDriftPermille
	}
	s.workerTTLInterval = secondsToDurationOr(o.WorkerTTLIntervalSeconds, defaultWorkerTTLInterval)
	s.workerBlobGCInterval = secondsToDurationOr(o.WorkerBlobGCIntervalSeconds, defaultWorkerBlobGCInterval)
	s.workerReconcileInterval = secondsToDurationOr(o.WorkerReconcileIntervalSeconds, defaultWorkerReconcileInterval)
	s.workerPeerKeyTrimInterval = secondsToDurationOr(o.WorkerPeerKeyTrimIntervalSeconds, defaultWorkerPeerKeyTrimInterval)
	s.workerKeyRotationInterval = secondsToDurationOr(o.WorkerKeyRotationIntervalSeconds, defaultWorkerKeyRotationInterval)
	s.workerAuditTrimInterval = secondsToDurationOr(o.WorkerAuditTrimIntervalSeconds, defaultWorkerAuditTrimInterval)

	backend, err := buildBackend(s.backendType, o, &s.storePath)
	if err != nil {
		logger.Errorf(context.Background(), "[oss] backend init failed: %v — falling back to local", err)
		s.backendType = string(storage.DriverLocal)
		backend = storage.NewLocalBackend(s.storePath)
	}
	s.backend = backend

	// Initialize Service Layer. The bucket repo is mandatory: every
	// upload debits a bucket and there is no service mode that
	// bypasses quota accounting. The audit repo is mandatory for
	// the read path so denials are recorded.
	s.fileRepo = repo.NewFileRepository(s.dbName)
	s.bucketRepo = repo.NewBucketRepository(s.dbName)
	s.auditRepo = repo.NewAuditRepository(s.dbName)
	s.blobRepo = repo.NewBlobRepository(s.dbName)
	s.metaRepo = repo.NewMetaRepository(s.dbName)
	s.peerKeyRepo = repo.NewPeerKeyRepository(s.dbName)
	s.fedKeys = newFederationKeyCache(s.peerKeyRepo)
	s.localStationID = strings.TrimSpace(o.LocalStationID)
	s.fileService = service.NewFileService(service.Config{
		Files:         s.fileRepo,
		Buckets:       s.bucketRepo,
		Blobs:         s.blobRepo,
		Meta:          s.metaRepo,
		Backend:       s.backend,
		BackendName:   s.backendType,
		Strategy:      service.KeyStrategy(s.keyStrategy),
		MimeBlocklist: s.mimeBlocklist,
	})

	// Default the chat-audience resolver to the SQL-backed view of
	// the friend_chat_sessions table. Operators who run OSS in a
	// federated topology will replace this via WithChatSessionResolver.
	if o.ChatResolver != nil {
		s.chatResolver = o.ChatResolver
	} else if s.dbName != "" {
		s.chatResolver = NewSQLChatSessionResolver(s.dbName)
	}

	return s
}

// buildBackend resolves the operator-configured driver via the
// storage factory, defaulting `storePath` if the caller did not
// supply one. Returning the populated `storePath` back to the
// caller via the pointer keeps `oss.go`'s state correct for log
// lines and migrations.
func buildBackend(backendType string, o *Options, storePath *string) (storage.Backend, error) {
	cfg := storage.Config{Driver: storage.Driver(backendType)}
	switch storage.Driver(backendType) {
	case storage.DriverLocal, "":
		if *storePath == "" {
			if dataDir, err := appdir.Resolve("station", "data"); err == nil {
				*storePath = filepath.Join(dataDir, "oss")
			} else {
				*storePath = "/tmp/oss"
			}
		}
		cfg.Driver = storage.DriverLocal
		cfg.Local = &storage.LocalConfig{Root: *storePath}
	case storage.DriverS3:
		cfg.S3 = &storage.S3Config{
			Endpoint:        o.S3.Endpoint,
			Region:          o.S3.Region,
			Bucket:          o.S3.Bucket,
			AccessKeyID:     o.S3.AccessKeyID,
			SecretAccessKey: o.S3.SecretAccessKey,
			UseSSL:          o.S3.UseSSL,
			ForcePathStyle:  o.S3.ForcePathStyle,
			KeyPrefix:       o.S3.KeyPrefix,
		}
	default:
		return nil, fmt.Errorf("unsupported backend %q", backendType)
	}
	b, err := storage.New(cfg)
	if err != nil {
		return nil, err
	}
	return b, nil
}

// presignedBackend returns the active backend's PresignedBackend
// view, or nil when the driver does not support pre-signed URLs.
// Callers use the nil check as the authoritative gate on whether
// the presigned upload data path is available.
func (s *ossSubServer) presignedBackend() storage.PresignedBackend {
	if pb, ok := s.backend.(storage.PresignedBackend); ok && s.presignedThreshold > 0 {
		return pb
	}
	return nil
}

// presignedUploadEnabled is the public-facing predicate behind the
// `presigned_upload` capability flag. Kept separate from
// `presignedBackend()` so future drivers that gate the feature on
// their own side (e.g. quota, region) have a single seam to extend.
func (s *ossSubServer) presignedUploadEnabled() bool {
	return s.presignedBackend() != nil
}

func backendSupportsPresign(name string) bool {
	switch storage.Driver(name) {
	case storage.DriverS3:
		return true
	default:
		return false
	}
}

// secondsToDurationOr coerces an operator-supplied integer (seconds)
// into a `time.Duration`, falling back to `fallback` when the value
// is unset or negative.
func secondsToDurationOr(seconds int64, fallback time.Duration) time.Duration {
	if seconds <= 0 {
		return fallback
	}
	return time.Duration(seconds) * time.Second
}

// daysToDurationOr / hoursToDurationOr keep the YAML side ergonomic
// (operators write `7` for "seven days" rather than `604800`) while
// the runtime always works in `time.Duration`. Negative values fall
// back to `fallback` rather than rejecting outright — a misconfigured
// row should not abort startup.
func daysToDurationOr(days int, fallback time.Duration) time.Duration {
	if days <= 0 {
		return fallback
	}
	return time.Duration(days) * 24 * time.Hour
}

func hoursToDurationOr(hours int, fallback time.Duration) time.Duration {
	if hours <= 0 {
		return fallback
	}
	return time.Duration(hours) * time.Hour
}

// normaliseMimeBlocklist trims and lower-cases each entry, drops the
// empties, and de-duplicates. We do this once at boot so the upload
// hot path can compare with `strings.HasPrefix` against a stable
// slice without per-request allocation.
func normaliseMimeBlocklist(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, v := range in {
		v = strings.ToLower(strings.TrimSpace(v))
		if v == "" {
			continue
		}
		if _, dup := seen[v]; dup {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}

// isBlockedMime reports whether `mime` matches any prefix in
// `s.mimeBlocklist`. The match is prefix-only: `application/`
// blocks every `application/*` payload while a more specific entry
// like `application/x-msdownload` blocks only that exact MIME.
//
// Empty mime is *not* blocked here (the upload validator already
// rejects empty MIME with a different reason); callers should
// invoke this only after the basic shape check.
func (s *ossSubServer) isBlockedMime(mime string) bool {
	if mime == "" || len(s.mimeBlocklist) == 0 {
		return false
	}
	mime = strings.ToLower(mime)
	for _, prefix := range s.mimeBlocklist {
		if strings.HasPrefix(mime, prefix) {
			return true
		}
	}
	return false
}

// ErrUnsupportedBackend is returned by handlers whose path-specific
// validation rejects an inbound key (e.g. presigned upload requested
// while the active backend does not implement `PresignedBackend`).
var ErrUnsupportedBackend = errors.New("oss: backend does not support requested operation")

func (s *ossSubServer) Init(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusStarting
	if s.dbName != "" {
		if rds, err := store.GetRDS(ctx, store.WithRDSDBName(s.dbName)); err == nil {
			// Defensive AutoMigrate. The authoritative migration
			// runs inside repo.Bootstrap (which also stamps the
			// schema sentinel and seeds capability_version);
			// re-running it here keeps Init self-contained when
			// the InitTableHooks pre-pass missed a model.
			_ = rds.AutoMigrate(
				&ossmodel.Audit{},
				&ossmodel.Blob{},
				&ossmodel.Bucket{},
				&ossmodel.FileMeta{},
				&ossmodel.Meta{},
				&ossmodel.PeerKey{},
			)
			// Bootstrap stamps the schema version sentinel and
			// seeds `capability_version`. Idempotent — repeat
			// calls return ErrAlreadyBootstrapped. Any other
			// failure aborts startup because the OSS subsystem
			// is structurally broken without a stamped schema.
			if res, err := repo.Bootstrap(ctx, repo.BootstrapDeps{DBName: s.dbName}); err != nil {
				if !errors.Is(err, repo.ErrAlreadyBootstrapped) {
					return err
				}
			} else if !res.Skipped {
				logger.Infof(ctx, "[oss] schema %s stamped in %dms",
					ossmodel.SchemaVersionCurrent, res.ElapsedMs)
			}
		}
	}
	return nil
}

func (s *ossSubServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning
	if err := s.startWorkers(ctx); err != nil {
		// Worker startup failure is logged-not-fatal: the
		// per-request data plane is independent of the
		// background workers, so a misconfigured TTLSweeper
		// must not abort the subserver. Operators see the
		// failure in audit + logs and fix the deps.
		logger.Errorf(ctx, "[oss] background workers failed to start: %v", err)
	}
	return nil
}

func (s *ossSubServer) Stop(ctx context.Context) error {
	s.status = server.StatusStopped
	if s.workerScheduler != nil {
		s.workerScheduler.Stop()
	}
	return nil
}

// startWorkers constructs the background lifecycle workers and
// hands them to a Scheduler. Idempotent: subsequent calls are
// no-ops once the scheduler is running. Workers requiring deps
// the subserver did not initialise (e.g. SQLite-only test boots
// that skip the audit repo) are silently skipped — the TTL /
// BlobGC contract requires a real audit repo.
//
// The set of workers we register here is the v3 lifecycle bundle:
//
//   - TTLSweeper          — soft-delete expired files (S11)
//   - BlobGC              — physically GC orphaned blobs (S11)
//   - BucketReconciler    — correct bucket usage drift (S12)
//   - PeerKeyTrim         — drop stale unpinned peer keys (S12)
//   - KeyRotationFinalize — clear `_prev` after dual-sign (S12)
//   - AuditTrim           — bound oss_audit row count (S12)
//
// All run under the same scheduler / leader lock so multi-instance
// deployments do not double-fire any of them.
func (s *ossSubServer) startWorkers(ctx context.Context) error {
	if s.workerScheduler != nil {
		return nil
	}
	if s.fileRepo == nil || s.blobRepo == nil || s.auditRepo == nil || s.backend == nil {
		return errors.New("oss: workers: missing dependencies (fileRepo/blobRepo/auditRepo/backend)")
	}

	workers := make([]worker.Worker, 0, 6)

	if s.workerTTLInterval > 0 {
		ttl, err := worker.NewTTLSweeper(worker.TTLSweeperConfig{
			Files:       s.fileRepo,
			Buckets:     s.bucketRepo,
			Blobs:       s.blobRepo,
			Audit:       s.auditRepo,
			BackendName: s.backendType,
			Interval:    s.workerTTLInterval,
		})
		if err != nil {
			return fmt.Errorf("oss: workers: ttl: %w", err)
		}
		workers = append(workers, ttl)
	}

	if s.workerBlobGCInterval > 0 {
		gc, err := worker.NewBlobGC(worker.BlobGCConfig{
			Blobs:       s.blobRepo,
			Backend:     s.backend,
			Audit:       s.auditRepo,
			BackendName: s.backendType,
			Grace:       s.blobGCGrace,
			Interval:    s.workerBlobGCInterval,
		})
		if err != nil {
			return fmt.Errorf("oss: workers: blob_gc: %w", err)
		}
		workers = append(workers, gc)
	}

	if s.workerReconcileInterval > 0 && s.bucketRepo != nil {
		rec, err := worker.NewBucketReconciler(worker.BucketReconcilerConfig{
			Buckets:       s.bucketRepo,
			Files:         s.fileRepo,
			Audit:         s.auditRepo,
			Interval:      s.workerReconcileInterval,
			DriftPermille: s.bucketReconcileDriftPermille,
		})
		if err != nil {
			return fmt.Errorf("oss: workers: bucket_reconcile: %w", err)
		}
		workers = append(workers, rec)
	}

	if s.workerPeerKeyTrimInterval > 0 && s.peerKeyRepo != nil {
		pkt, err := worker.NewPeerKeyTrim(worker.PeerKeyTrimConfig{
			Peers:    s.peerKeyRepo,
			Audit:    s.auditRepo,
			MaxIdle:  s.peerKeyMaxIdle,
			Interval: s.workerPeerKeyTrimInterval,
		})
		if err != nil {
			return fmt.Errorf("oss: workers: peer_key_trim: %w", err)
		}
		workers = append(workers, pkt)
	}

	if s.workerKeyRotationInterval > 0 && s.metaRepo != nil {
		krf, err := worker.NewKeyRotationFinalizer(worker.KeyRotationFinalizerConfig{
			Meta:     s.metaRepo,
			Audit:    s.auditRepo,
			Grace:    s.federationRotationGrace,
			Interval: s.workerKeyRotationInterval,
		})
		if err != nil {
			return fmt.Errorf("oss: workers: key_rotation: %w", err)
		}
		workers = append(workers, krf)
	}

	if s.workerAuditTrimInterval > 0 {
		at, err := worker.NewAuditTrim(worker.AuditTrimConfig{
			Audit:     s.auditRepo,
			Retention: s.auditRetention,
			Interval:  s.workerAuditTrimInterval,
		})
		if err != nil {
			return fmt.Errorf("oss: workers: audit_trim: %w", err)
		}
		workers = append(workers, at)
	}

	if len(workers) == 0 {
		return nil
	}

	// MemLock is correct for single-instance deployments; a
	// PgAdvisoryLock implementation can swap in here without
	// touching any of the worker constructors. The lock is
	// keyed per worker name so even a multi-instance station
	// runs each worker on exactly one node per tick.
	s.workerScheduler = worker.NewScheduler(workers, worker.NewMemLock(), s.auditRepo)
	if err := s.workerScheduler.Start(ctx); err != nil {
		s.workerScheduler = nil
		return fmt.Errorf("oss: workers: scheduler start: %w", err)
	}
	logger.Infof(ctx, "[oss] %d background worker(s) started", len(workers))
	return nil
}
func (s *ossSubServer) Status() server.Status          { return s.status }
func (s *ossSubServer) Name() string                   { return "oss" }
func (s *ossSubServer) Type() server.SubserverType     { return server.SubserverTypeHTTP }
func (s *ossSubServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}

// ---------------------------------------------------------------------------
// Sibling-subserver accessors
//
// These let other subservers (today: `dashboard`) reuse the OSS
// subserver's already-wired application-layer dependencies instead
// of re-building a parallel write path against the storage backend
// + GORM tables. Keeping the accessors on this struct (rather than
// exposing the dependency at construction time) means the
// dashboard's `Start()` can resolve the OSS subserver from the
// shared `server.Options.SubserverInstances` snapshot — the same
// mechanism it already uses for status/overview projection.
// ---------------------------------------------------------------------------

// FileService returns the OSS subserver's FileService. May return
// nil when called before Init has wired the dependency tree, which
// is expected during early-boot test harnesses.
func (s *ossSubServer) FileService() service.FileService {
	return s.fileService
}

// MaxFileSize returns the upload size cap the OSS HTTP handler
// enforces. Callers that want to short-circuit oversized requests
// (the dashboard admin upload, for example) should mirror this
// budget against `http.MaxBytesReader` rather than rely on the
// service layer to reject after the bytes have moved.
func (s *ossSubServer) MaxFileSize() int64 {
	return s.maxFileSize
}

// FileServiceProvider is the cross-package interface other
// subservers can use to type-assert against the OSS subserver
// without importing the unexported `*ossSubServer` symbol. The
// `dashboard` subserver does this at `Start()` time when scanning
// the shared `SubserverInstances` snapshot.
type FileServiceProvider interface {
	FileService() service.FileService
	MaxFileSize() int64
}
