package worker

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	ossrepo "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/repo"
	ossservice "github.com/peers-labs/peers-touch/station/app/subserver/oss/service"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const (
	ossFencingDBName = "ncp-oss-fencing"
	ossOwnerPTID     = "ptid:person:ncp-oss-alice"
	ossOtherPTID     = "ptid:person:ncp-oss-bob"
	ossGCKey         = "ncp/gc/replacement.bin"
)

type ossFencingStore struct {
	db *gorm.DB
}

func (s *ossFencingStore) Init(context.Context, ...option.Option) error { return nil }
func (s *ossFencingStore) RDS(context.Context, ...store.RDSDMLOption) (*gorm.DB, error) {
	return s.db, nil
}
func (s *ossFencingStore) Name() string { return ossFencingDBName }

type ossFencingProcessResult struct {
	Role                    string `json:"role"`
	ProcessID               int    `json:"processId"`
	ObjectKey               string `json:"objectKey,omitempty"`
	ObjectDigest            string `json:"objectDigest,omitempty"`
	ReadDigest              string `json:"readDigest,omitempty"`
	UnauthorizedReadDenied  bool   `json:"unauthorizedReadDenied,omitempty"`
	HealthyLeasePreserved   bool   `json:"healthyLeasePreserved,omitempty"`
	OwnerNodePeerID         string `json:"ownerNodePeerId,omitempty"`
	OwnerIncarnation        string `json:"ownerIncarnation,omitempty"`
	FencingToken            uint64 `json:"fencingToken,omitempty"`
	Generation              uint64 `json:"generation,omitempty"`
	StorageKey              string `json:"storageKey,omitempty"`
	ReplacementDigest       string `json:"replacementDigest,omitempty"`
	ReplacementDigestMatch  bool   `json:"replacementDigestMatch,omitempty"`
	StaleCompletionRejected bool   `json:"staleCompletionRejected,omitempty"`
	RefCount                int64  `json:"refCount,omitempty"`
	BucketUsedBytes         int64  `json:"bucketUsedBytes,omitempty"`
	BucketObjectCount       int64  `json:"bucketObjectCount,omitempty"`
}

type runningOSSFencingProcess struct {
	command   *exec.Cmd
	output    bytes.Buffer
	finalPath string
}

func TestPostgresCrossProcessOSSFencing(t *testing.T) {
	database, dsn := openOSSFencingPostgres(t)
	resetOSSFencingPostgres(t, database)
	runtimeRoot := t.TempDir()
	sharedRoot := filepath.Join(runtimeRoot, "shared-objects")
	if err := os.MkdirAll(sharedRoot, 0o755); err != nil {
		t.Fatal(err)
	}

	nodeA := startOSSFencingProcessA(t, dsn, sharedRoot, runtimeRoot)
	upload := waitOSSFencingResult(t, filepath.Join(runtimeRoot, "node-a-upload.json"))
	waitOSSFencingFile(t, filepath.Join(runtimeRoot, "node-a-gc-ready"))

	nodeB := startOSSFencingProcessB(t, dsn, sharedRoot, runtimeRoot)
	observed := waitOSSFencingResult(t, filepath.Join(runtimeRoot, "node-b-ready.json"))
	if upload.ProcessID <= 0 ||
		observed.ProcessID <= 0 ||
		upload.ProcessID == observed.ProcessID ||
		upload.ObjectDigest == "" ||
		observed.ReadDigest != upload.ObjectDigest ||
		!observed.UnauthorizedReadDenied ||
		!observed.HealthyLeasePreserved {
		t.Fatalf("cross-node read or healthy lease observation failed: upload=%+v observed=%+v", upload, observed)
	}

	if result := database.Model(&ossmodel.WorkerLease{}).
		Where("worker_name = ? AND fencing_token = ?", "blob_gc", 1).
		Update("expires_at", gorm.Expr("CURRENT_TIMESTAMP - INTERVAL '1 second'")); result.Error != nil || result.RowsAffected != 1 {
		t.Fatalf("expire node A worker lease: rows=%d err=%v", result.RowsAffected, result.Error)
	}
	takeover := waitOSSFencingResult(t, filepath.Join(runtimeRoot, "node-b-takeover.json"))
	if takeover.FencingToken != 2 ||
		takeover.OwnerNodePeerID != "oss-node-b" ||
		takeover.Generation != 2 ||
		takeover.StorageKey == "" ||
		takeover.StorageKey == ossGCKey ||
		!takeover.ReplacementDigestMatch {
		t.Fatalf("node B takeover or replacement is invalid: %+v", takeover)
	}

	writeOSSFencingBarrier(t, filepath.Join(runtimeRoot, "resume-node-a"))
	stale := nodeA.wait(t)
	if !stale.StaleCompletionRejected ||
		!stale.ReplacementDigestMatch ||
		stale.Generation != takeover.Generation ||
		stale.RefCount != 1 {
		t.Fatalf("stale node A corrupted replacement generation: %+v", stale)
	}
	writeOSSFencingBarrier(t, filepath.Join(runtimeRoot, "finish-node-b"))
	nodeBResult := nodeB.wait(t)
	if nodeBResult.FencingToken != takeover.FencingToken {
		t.Fatalf("node B final authority changed unexpectedly: %+v", nodeBResult)
	}

	var blob ossmodel.Blob
	if err := database.First(&blob, "backend = ? AND key = ?", "shared-fs", ossGCKey).Error; err != nil {
		t.Fatal(err)
	}
	var bucket ossmodel.Bucket
	if err := database.First(&bucket, "owner_ptid = ? AND name = ?", ossOwnerPTID, ossmodel.SystemBucketAvatar).Error; err != nil {
		t.Fatal(err)
	}
	var fileCount int64
	if err := database.Model(&ossmodel.FileMeta{}).
		Where("owner_ptid = ? AND key = ? AND deleted_at IS NULL", ossOwnerPTID, ossGCKey).
		Count(&fileCount).Error; err != nil {
		t.Fatal(err)
	}
	backend := storage.NewSharedFSBackend(sharedRoot)
	if !backend.ClusterShared() {
		t.Fatal("shared-fs backend did not declare cluster-shared scope")
	}
	if _, err := backend.Stat(context.Background(), ossGCKey); err == nil {
		t.Fatal("stale generation bytes were not deleted")
	}
	body, digest := readOSSFencingObject(t, backend, blob.StorageKey)
	if digest != takeover.ReplacementDigest || int64(len(body)) != blob.Size {
		t.Fatalf("replacement readback mismatch digest=%s size=%d blob=%+v", digest, len(body), blob)
	}
	if blob.Generation != 2 ||
		blob.RefCount != 1 ||
		blob.LifecycleState != ossmodel.BlobLifecycleLive ||
		bucket.UsedBytes != blob.Size ||
		bucket.ObjectCount != 1 ||
		fileCount != 1 {
		t.Fatalf("authoritative OSS readback invalid blob=%+v bucket=%+v files=%d", blob, bucket, fileCount)
	}

	if path := os.Getenv("NCP_OSS_RESULT_PATH"); path != "" {
		report := map[string]any{
			"artifactKind": "ncp-oss-fencing-process-result",
			"status":       "passed",
			"scenarios": map[string]any{
				"NCP-G06-OSS-READ": map[string]any{
					"uploaderProcessId":      upload.ProcessID,
					"readerProcessId":        observed.ProcessID,
					"digestMatch":            observed.ReadDigest == upload.ObjectDigest,
					"authorizedOwnerRead":    true,
					"unauthorizedReadDenied": observed.UnauthorizedReadDenied,
					"sharedBackendReady":     backend.ClusterShared(),
				},
				"NCP-G06-OSS-GC": map[string]any{
					"healthyLeasePreserved": observed.HealthyLeasePreserved,
					"tokenAdvanced":         takeover.FencingToken == 2,
					"refCount":              blob.RefCount,
					"bucketUsedBytes":       bucket.UsedBytes,
					"bucketObjectCount":     bucket.ObjectCount,
				},
				"NCP-G06-OSS-STALE": map[string]any{
					"oldGeneration":            1,
					"replacementGeneration":    blob.Generation,
					"immutableStorageKey":      blob.StorageKey,
					"staleCompletionRejected":  stale.StaleCompletionRejected,
					"replacementDigestMatch":   digest == takeover.ReplacementDigest,
					"staleDeleteBoundToOldKey": blob.StorageKey != ossGCKey,
				},
			},
		}
		encoded, err := json.MarshalIndent(report, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, append(encoded, '\n'), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestPostgresOSSFencingProcessHelper(t *testing.T) {
	role := strings.TrimSpace(os.Getenv("NCP_OSS_HELPER_ROLE"))
	if role == "" {
		t.Skip("not an OSS fencing helper process")
	}
	database, _ := openOSSFencingPostgres(t)
	sharedRoot := strings.TrimSpace(os.Getenv("NCP_OSS_SHARED_ROOT"))
	if sharedRoot == "" {
		t.Fatal("shared object root is missing")
	}
	switch role {
	case "node-a":
		runOSSFencingNodeA(t, database, sharedRoot)
	case "node-b":
		runOSSFencingNodeB(t, database, sharedRoot)
	default:
		t.Fatalf("unknown OSS fencing helper role %q", role)
	}
}

func runOSSFencingNodeA(t *testing.T, database *gorm.DB, sharedRoot string) {
	ctx := context.Background()
	backend := storage.NewSharedFSBackend(sharedRoot)
	fileRepo := ossrepo.NewFileRepository(ossFencingDBName)
	bucketRepo := ossrepo.NewBucketRepository(ossFencingDBName)
	blobRepo := ossrepo.NewBlobRepository(ossFencingDBName)
	service := ossservice.NewFileService(ossservice.Config{
		Files: fileRepo, Buckets: bucketRepo, Blobs: blobRepo,
		Backend: backend, BackendName: "shared-fs",
		Strategy: ossservice.KeyStrategyCAS,
	})
	uploadBody := []byte("node-a shared object readback")
	uploadFile, header := ossFencingMultipartFile(t, uploadBody, "readback.bin")
	defer uploadFile.Close()
	meta, err := service.SaveFile(ctx, ossservice.UploadAttribution{
		ActorPTID:  ossOwnerPTID,
		BucketName: ossmodel.SystemBucketPersonal,
		Visibility: ossmodel.VisibilityPrivate,
	}, uploadFile, header)
	if err != nil {
		t.Fatal(err)
	}
	writeOSSFencingResult(t, os.Getenv("NCP_OSS_UPLOAD_PATH"), ossFencingProcessResult{
		Role:         "node-a-upload",
		ProcessID:    os.Getpid(),
		ObjectKey:    meta.Key,
		ObjectDigest: sha256String(uploadBody),
	})

	oldBody := []byte("old generation")
	if _, err := backend.Save(ctx, ossGCKey, bytes.NewReader(oldBody)); err != nil {
		t.Fatal(err)
	}
	staged, err := blobRepo.StageWrite(ctx, "shared-fs", ossGCKey, int64(len(oldBody)), sha256String(oldBody))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := blobRepo.CommitWrite(ctx, *staged); err != nil {
		t.Fatal(err)
	}
	if _, _, err := blobRepo.Release(ctx, "shared-fs", ossGCKey); err != nil {
		t.Fatal(err)
	}
	if err := database.Model(&ossmodel.Blob{}).
		Where("backend = ? AND key = ?", "shared-fs", ossGCKey).
		Update("last_seen_at", time.Now().UTC().Add(-2*time.Hour)).Error; err != nil {
		t.Fatal(err)
	}

	lock, err := NewDBLeaderLock(ossFencingDBName, "oss-node-a", "oss-incarnation-a", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	authority, release, err := lock.TryAcquire(ctx, "blob_gc")
	if err != nil || authority == nil {
		t.Fatalf("node A acquire: authority=%+v err=%v", authority, err)
	}
	defer release()
	pausing := &ossPausingBackend{
		Backend:    backend,
		readyPath:  os.Getenv("NCP_OSS_GC_READY_PATH"),
		resumePath: os.Getenv("NCP_OSS_RESUME_PATH"),
		targetKey:  ossGCKey,
	}
	audit := ossrepo.NewAuditRepository(ossFencingDBName)
	gc, err := NewBlobGC(BlobGCConfig{
		Blobs: blobRepo, Backend: pausing, Audit: audit,
		BackendName: "shared-fs", Grace: time.Minute, Interval: time.Hour,
	})
	if err != nil {
		t.Fatal(err)
	}
	runCtx := withLeaseAuthority(ctx, *authority)
	if err := gc.RunOnce(runCtx); err != nil {
		t.Fatal(err)
	}
	var current ossmodel.Blob
	if err := database.First(&current, "backend = ? AND key = ?", "shared-fs", ossGCKey).Error; err != nil {
		t.Fatal(err)
	}
	_, replacementDigest := readOSSFencingObject(t, backend, current.StorageKey)
	var staleAuditCount int64
	if err := database.Model(&ossmodel.Audit{}).
		Where("action = ? AND file_key = ? AND outcome = ? AND reason LIKE ?", ossmodel.AuditActionBlobGC, ossGCKey, ossmodel.AuditOutcomeError, "stale_completion%").
		Count(&staleAuditCount).Error; err != nil {
		t.Fatal(err)
	}
	writeOSSFencingResult(t, os.Getenv("NCP_OSS_FINAL_PATH"), ossFencingProcessResult{
		Role:                    "node-a-final",
		ProcessID:               os.Getpid(),
		Generation:              current.Generation,
		StorageKey:              current.StorageKey,
		ReplacementDigest:       replacementDigest,
		ReplacementDigestMatch:  replacementDigest != "",
		StaleCompletionRejected: staleAuditCount == 1,
		RefCount:                current.RefCount,
	})
}

func runOSSFencingNodeB(t *testing.T, database *gorm.DB, sharedRoot string) {
	ctx := context.Background()
	backend := storage.NewSharedFSBackend(sharedRoot)
	blobRepo := ossrepo.NewBlobRepository(ossFencingDBName)
	service := ossservice.NewFileService(ossservice.Config{
		Files:   ossrepo.NewFileRepository(ossFencingDBName),
		Buckets: ossrepo.NewBucketRepository(ossFencingDBName),
		Blobs:   blobRepo, Backend: backend, BackendName: "shared-fs",
		Strategy: ossservice.KeyStrategyCAS,
	})
	reader := service.(ossservice.AttachmentReader)
	upload := waitOSSFencingResult(t, os.Getenv("NCP_OSS_UPLOAD_PATH"))
	_, body, err := reader.ReadOwnedFile(ctx, ossOwnerPTID, upload.ObjectKey, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	_, _, unauthorizedErr := reader.ReadOwnedFile(ctx, ossOtherPTID, upload.ObjectKey, 1<<20)
	lock, err := NewDBLeaderLock(ossFencingDBName, "oss-node-b", "oss-incarnation-b", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	initial, _, err := lock.TryAcquire(ctx, "blob_gc")
	if err != nil {
		t.Fatal(err)
	}
	if initial != nil {
		t.Fatal("node B acquired a healthy foreign worker lease")
	}
	writeOSSFencingResult(t, os.Getenv("NCP_OSS_READY_PATH"), ossFencingProcessResult{
		Role:                   "node-b-ready",
		ProcessID:              os.Getpid(),
		ReadDigest:             sha256String(body),
		UnauthorizedReadDenied: unauthorizedErr != nil,
		HealthyLeasePreserved:  true,
	})

	deadline := time.Now().Add(30 * time.Second)
	var authority *LeaseAuthority
	var release func()
	for authority == nil {
		authority, release, err = lock.TryAcquire(ctx, "blob_gc")
		if err != nil {
			t.Fatal(err)
		}
		if authority == nil {
			if time.Now().After(deadline) {
				t.Fatal("timed out waiting for OSS worker takeover")
			}
			time.Sleep(20 * time.Millisecond)
		}
	}
	defer release()

	replacementBody := []byte("replacement generation survives stale delete")
	replacementDigest := sha256String(replacementBody)
	staged, err := blobRepo.StageWrite(
		ctx,
		"shared-fs",
		ossGCKey,
		int64(len(replacementBody)),
		replacementDigest,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !staged.RequiresWrite || staged.Generation != 2 || staged.StorageKey == ossGCKey {
		t.Fatalf("replacement stage is not immutable: %+v", staged)
	}
	if _, err := backend.Save(ctx, staged.StorageKey, bytes.NewReader(replacementBody)); err != nil {
		t.Fatal(err)
	}
	current, err := blobRepo.CommitWrite(ctx, *staged)
	if err != nil {
		t.Fatal(err)
	}
	bucketRepo := ossrepo.NewBucketRepository(ossFencingDBName)
	bucket, err := bucketRepo.EnsureSystem(ctx, ossOwnerPTID, *ossmodel.FindSystemBucketSpec(ossmodel.SystemBucketAvatar))
	if err != nil {
		t.Fatal(err)
	}
	if err := bucketRepo.AddUsage(ctx, bucket.ID, current.Size); err != nil {
		t.Fatal(err)
	}
	if err := ossrepo.NewFileRepository(ossFencingDBName).Create(ctx, &ossmodel.FileMeta{
		ID: "ncp-oss-replacement", Key: ossGCKey, Name: "replacement.bin",
		Size: current.Size, Mime: "application/octet-stream", Backend: "shared-fs",
		Path: current.StorageKey, Sha256: replacementDigest, BucketID: bucket.ID,
		OwnerPTID: ossOwnerPTID, Visibility: ossmodel.VisibilityPrivate,
		CreatedAt: time.Now().UTC(),
	}); err != nil {
		t.Fatal(err)
	}
	_, readDigest := readOSSFencingObject(t, backend, current.StorageKey)
	writeOSSFencingResult(t, os.Getenv("NCP_OSS_TAKEOVER_PATH"), ossFencingProcessResult{
		Role:                   "node-b-takeover",
		ProcessID:              os.Getpid(),
		OwnerNodePeerID:        authority.OwnerNodePeerID,
		OwnerIncarnation:       authority.OwnerIncarnation,
		FencingToken:           authority.FencingToken,
		Generation:             current.Generation,
		StorageKey:             current.StorageKey,
		ReplacementDigest:      replacementDigest,
		ReplacementDigestMatch: readDigest == replacementDigest,
		RefCount:               current.RefCount,
	})
	waitOSSFencingFile(t, os.Getenv("NCP_OSS_FINISH_PATH"))
	writeOSSFencingResult(t, os.Getenv("NCP_OSS_FINAL_PATH"), ossFencingProcessResult{
		Role:         "node-b-final",
		ProcessID:    os.Getpid(),
		FencingToken: authority.FencingToken,
	})
}

type ossPausingBackend struct {
	storage.Backend
	readyPath  string
	resumePath string
	targetKey  string
}

func (b *ossPausingBackend) Delete(ctx context.Context, key string) error {
	if key == b.targetKey {
		writeOSSFencingBarrierRaw(b.readyPath)
		waitOSSFencingPath(b.resumePath, 30*time.Second)
	}
	return b.Backend.Delete(ctx, key)
}

func openOSSFencingPostgres(t *testing.T) (*gorm.DB, string) {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("NCP_OSS_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("NCP_OSS_POSTGRES_DSN is not configured")
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
	if err := store.InjectStore(context.Background(), &ossFencingStore{db: database}); err != nil {
		t.Fatal(err)
	}
	if err := database.AutoMigrate(
		&ossmodel.Audit{},
		&ossmodel.Blob{},
		&ossmodel.BlobGCGeneration{},
		&ossmodel.Bucket{},
		&ossmodel.FileMeta{},
		&ossmodel.Meta{},
		&ossmodel.WorkerLease{},
	); err != nil {
		t.Fatal(err)
	}
	if err := ossrepo.MigrateBlobGenerations(database); err != nil {
		t.Fatal(err)
	}
	return database, dsn
}

func resetOSSFencingPostgres(t *testing.T, database *gorm.DB) {
	t.Helper()
	for _, table := range []string{
		"oss_files",
		"oss_buckets",
		"oss_audit",
		"oss_meta",
		"oss_blobs",
		"oss_blob_gc_generations",
		"oss_worker_leases",
	} {
		if err := database.Exec("TRUNCATE TABLE " + table + " CASCADE").Error; err != nil {
			t.Fatal(err)
		}
	}
}

func startOSSFencingProcessA(
	t *testing.T,
	dsn string,
	sharedRoot string,
	runtimeRoot string,
) *runningOSSFencingProcess {
	return startOSSFencingProcess(
		t,
		dsn,
		sharedRoot,
		"node-a",
		filepath.Join(runtimeRoot, "node-a-final.json"),
		map[string]string{
			"NCP_OSS_UPLOAD_PATH":   filepath.Join(runtimeRoot, "node-a-upload.json"),
			"NCP_OSS_GC_READY_PATH": filepath.Join(runtimeRoot, "node-a-gc-ready"),
			"NCP_OSS_RESUME_PATH":   filepath.Join(runtimeRoot, "resume-node-a"),
		},
	)
}

func startOSSFencingProcessB(
	t *testing.T,
	dsn string,
	sharedRoot string,
	runtimeRoot string,
) *runningOSSFencingProcess {
	return startOSSFencingProcess(
		t,
		dsn,
		sharedRoot,
		"node-b",
		filepath.Join(runtimeRoot, "node-b-final.json"),
		map[string]string{
			"NCP_OSS_UPLOAD_PATH":   filepath.Join(runtimeRoot, "node-a-upload.json"),
			"NCP_OSS_READY_PATH":    filepath.Join(runtimeRoot, "node-b-ready.json"),
			"NCP_OSS_TAKEOVER_PATH": filepath.Join(runtimeRoot, "node-b-takeover.json"),
			"NCP_OSS_FINISH_PATH":   filepath.Join(runtimeRoot, "finish-node-b"),
		},
	)
}

func startOSSFencingProcess(
	t *testing.T,
	dsn string,
	sharedRoot string,
	role string,
	finalPath string,
	extra map[string]string,
) *runningOSSFencingProcess {
	t.Helper()
	process := &runningOSSFencingProcess{
		command: exec.Command(
			os.Args[0],
			"-test.run=^TestPostgresOSSFencingProcessHelper$",
			"-test.count=1",
		),
		finalPath: finalPath,
	}
	process.command.Env = append(
		os.Environ(),
		"NCP_OSS_HELPER_ROLE="+role,
		"NCP_OSS_POSTGRES_DSN="+dsn,
		"NCP_OSS_SHARED_ROOT="+sharedRoot,
		"NCP_OSS_FINAL_PATH="+finalPath,
	)
	for key, value := range extra {
		process.command.Env = append(process.command.Env, key+"="+value)
	}
	process.command.Stdout = &process.output
	process.command.Stderr = &process.output
	if err := process.command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if process.command.ProcessState == nil && process.command.Process != nil {
			_ = process.command.Process.Kill()
			_, _ = process.command.Process.Wait()
		}
	})
	return process
}

func (p *runningOSSFencingProcess) wait(t *testing.T) ossFencingProcessResult {
	t.Helper()
	if err := p.command.Wait(); err != nil {
		t.Fatalf("OSS fencing process failed: %v\n%s", err, p.output.String())
	}
	return waitOSSFencingResult(t, p.finalPath)
}

func ossFencingMultipartFile(
	t *testing.T,
	body []byte,
	name string,
) (multipart.File, *multipart.FileHeader) {
	t.Helper()
	file, err := os.CreateTemp("", "ncp-oss-upload-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = os.Remove(file.Name())
	})
	if _, err := file.Write(body); err != nil {
		t.Fatal(err)
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	return file, &multipart.FileHeader{Filename: name, Size: int64(len(body))}
}

func readOSSFencingObject(
	t *testing.T,
	backend storage.Backend,
	key string,
) ([]byte, string) {
	t.Helper()
	reader, _, _, err := backend.Open(context.Background(), key, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	body, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	return body, sha256String(body)
}

func sha256String(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}

func waitOSSFencingResult(t *testing.T, path string) ossFencingProcessResult {
	t.Helper()
	waitOSSFencingFile(t, path)
	encoded, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var result ossFencingProcessResult
	if err := json.Unmarshal(encoded, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func writeOSSFencingResult(t *testing.T, path string, result ossFencingProcessResult) {
	t.Helper()
	encoded, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, append(encoded, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
}

func waitOSSFencingFile(t *testing.T, path string) {
	t.Helper()
	if err := waitOSSFencingPath(path, 30*time.Second); err != nil {
		t.Fatal(err)
	}
}

func waitOSSFencingPath(path string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		if info, err := os.Stat(path); err == nil && info.Size() > 0 {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("timed out waiting for %s", path)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func writeOSSFencingBarrier(t *testing.T, path string) {
	t.Helper()
	if err := writeOSSFencingBarrierRaw(path); err != nil {
		t.Fatal(err)
	}
}

func writeOSSFencingBarrierRaw(path string) error {
	return os.WriteFile(path, []byte("ready"), 0o600)
}
