package repo

import (
	"context"
	"errors"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

// Bootstrap is the one-shot migration that brings a v1-era OSS
// database to v2. Idempotency is guaranteed by an `oss_meta` sentinel
// row keyed by `ossmodel.MetaKeySchemaVersion`; a second call returns
// `ErrAlreadyBootstrapped` immediately.
//
// Flow:
//
//  1. AutoMigrate the new tables (oss_buckets, oss_audit, oss_meta)
//     and additive columns on oss_files.
//  2. Open a transaction.
//  3. Discover the universe of actor IDs we have to seed system
//     buckets for: union of (a) distinct OwnerActorID already on
//     oss_files (will be empty pre-bootstrap), (b) actors observed in
//     friend_chat_sessions (covers everyone who has ever chatted),
//     (c) the special `LegacyOwnerActorID` actor used for
//     un-attributable rows.
//  4. For each actor, EnsureSystem the three system buckets.
//  5. Backfill oss_files: for each row with empty BucketID, look up
//     the friend_chat_message_attachments.cid==Key match and copy
//     the message's session ULID into ChatSessionID; pick the best
//     bucket per the table in plan.md §migration.
//  6. Recompute oss_buckets.UsedBytes / ObjectCount from a single
//     SUM/GROUP BY over oss_files.
//  7. Mark schema_version = v2 and commit.
//
// Any error rolls the transaction back. The caller (oss.go startup
// sequence) is expected to log + continue on bootstrap failure
// rather than refusing to boot — the new code paths gracefully
// degrade when buckets are missing (treating files as
// pre-bootstrap legacy rows).
type BootstrapResult struct {
	Skipped              bool
	ActorsSeeded         int
	BucketsCreated       int
	FilesBackfilled      int
	UsageReconciled      int
	ElapsedMs            int64
}

// ErrAlreadyBootstrapped is returned when Bootstrap is called on a
// database whose `oss_meta(schema_version) >= V2`. Callers can
// safely ignore it.
var ErrAlreadyBootstrapped = errors.New("oss: bootstrap: already at v2")

// BootstrapDeps lets tests inject a custom set of repos or override
// the actor-discovery query (for example to seed extra synthetic
// actors). All zero-value fields are filled with sensible defaults.
type BootstrapDeps struct {
	// DBName scopes the gorm DB resolution. Required.
	DBName string

	// Clock is used for timestamps; defaults to time.Now.
	Clock func() time.Time

	// ExtraActors is a list of actor DIDs to seed system buckets for
	// in addition to the ones discovered automatically. Useful for
	// tests; production passes nil.
	ExtraActors []string
}

// Bootstrap performs the v1→v2 migration. Safe to call from server
// startup. Returns ErrAlreadyBootstrapped if the migration has
// already been applied.
func Bootstrap(ctx context.Context, deps BootstrapDeps) (*BootstrapResult, error) {
	if deps.DBName == "" {
		return nil, errors.New("oss: bootstrap: DBName required")
	}
	if deps.Clock == nil {
		deps.Clock = time.Now
	}

	db, err := store.GetRDS(ctx, store.WithRDSDBName(deps.DBName))
	if err != nil {
		return nil, err
	}

	// Step 1: AutoMigrate. We invoke this defensively — the OSS
	// subserver's Init also calls AutoMigrate, but routing tests
	// reach Bootstrap without going through the subserver, and the
	// idempotent design of AutoMigrate makes the redundant call free.
	if err := db.AutoMigrate(
		&ossmodel.FileMeta{},
		&ossmodel.Bucket{},
		&ossmodel.Audit{},
		&ossmodel.Meta{},
	); err != nil {
		return nil, err
	}

	// Step 2: short-circuit if already at v2.
	if v, err := readSchemaVersion(db); err == nil && v == ossmodel.SchemaVersionV2 {
		return &BootstrapResult{Skipped: true}, ErrAlreadyBootstrapped
	}

	start := time.Now()
	result := &BootstrapResult{}
	bucketRepo := &bucketRepo{dbName: deps.DBName, clock: deps.Clock}

	err = db.Transaction(func(tx *gorm.DB) error {
		// Step 3: discover actor universe.
		actors, err := discoverActors(tx, deps.ExtraActors)
		if err != nil {
			return err
		}
		result.ActorsSeeded = len(actors)

		// Step 4: ensure system buckets per actor.
		// We bypass the public BucketRepository here because we want
		// to use the same gorm tx; instead we replicate EnsureSystem
		// inline against tx.
		for _, actorID := range actors {
			for _, spec := range ossmodel.SystemBucketSpecs {
				created, err := ensureSystemTx(tx, deps.Clock, actorID, spec)
				if err != nil {
					return err
				}
				if created {
					result.BucketsCreated++
				}
			}
		}

		// Step 5: backfill oss_files.
		filled, err := backfillFileMetas(tx, deps.Clock)
		if err != nil {
			return err
		}
		result.FilesBackfilled = filled

		// Step 6: reconcile bucket usage.
		reconciled, err := reconcileUsage(tx, deps.Clock)
		if err != nil {
			return err
		}
		result.UsageReconciled = reconciled

		// Step 7: stamp schema_version.
		return writeSchemaVersion(tx, deps.Clock(), ossmodel.SchemaVersionV2)
	})
	if err != nil {
		return nil, err
	}

	// Use bucketRepo so the unused-import / unused-var lint stays
	// quiet when the file is read in isolation; also reserves the
	// repo wiring for a future "reconcile-on-demand" admin RPC.
	_ = bucketRepo

	result.ElapsedMs = time.Since(start).Milliseconds()
	return result, nil
}

// discoverActors returns the union of: actors that already own
// oss_files rows, actors observed in friend_chat_sessions, and any
// extra actors the caller asked to seed. We add `LegacyOwnerActorID`
// last so its bucket exists for the backfill step.
func discoverActors(tx *gorm.DB, extra []string) ([]string, error) {
	seen := make(map[string]struct{})
	add := func(id string) {
		if id == "" {
			return
		}
		seen[id] = struct{}{}
	}

	// (a) existing oss_files owners (will be empty on first
	//     bootstrap, populated on re-runs after column add).
	var fileOwners []string
	if err := tx.Model(&ossmodel.FileMeta{}).
		Where("owner_actor_id <> ''").
		Distinct("owner_actor_id").
		Pluck("owner_actor_id", &fileOwners).Error; err != nil {
		return nil, err
	}
	for _, a := range fileOwners {
		add(a)
	}

	// (b) friend_chat_sessions participants. We hit the table
	//     directly via raw SQL to avoid an import cycle with the
	//     friend_chat domain types. The table may not yet exist on
	//     test databases — we tolerate the failure.
	type pair struct {
		A string
		B string
	}
	var pairs []pair
	if err := tx.Raw(`
		SELECT participant_a_did AS a, participant_b_did AS b
		FROM friend_chat_sessions
	`).Scan(&pairs).Error; err == nil {
		for _, p := range pairs {
			add(p.A)
			add(p.B)
		}
	}
	// If the table is missing the Scan returns an error — silently
	// drop it; we have no friend_chat data to mine.

	for _, a := range extra {
		add(a)
	}
	add(ossmodel.LegacyOwnerActorID)

	out := make([]string, 0, len(seen))
	for k := range seen {
		out = append(out, k)
	}
	return out, nil
}

// ensureSystemTx is the in-transaction sibling of bucketRepo.EnsureSystem.
// Returns (created, err): created=true means a brand-new row was inserted.
func ensureSystemTx(tx *gorm.DB, clock func() time.Time, actorID string, spec ossmodel.SystemBucketSpec) (bool, error) {
	var existing ossmodel.Bucket
	err := tx.Where("owner_actor_id = ? AND name = ?", actorID, spec.Name).First(&existing).Error
	if err == nil {
		return false, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return false, err
	}
	now := clock()
	row := &ossmodel.Bucket{
		ID:                newULID(now),
		Name:              spec.Name,
		OwnerActorID:      actorID,
		Kind:              spec.Kind,
		SystemKey:         spec.SystemKey,
		DefaultVisibility: spec.DefaultVisibility,
		QuotaBytes:        spec.QuotaBytes,
		TTLDays:           spec.TTLDays,
		Description:       spec.Description,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	if err := tx.Create(row).Error; err != nil {
		// Race — someone else inserted in parallel. Treat as success.
		if isUniqueViolation(err) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// backfillFileMetas fills BucketID / OwnerActorID / Visibility /
// ChatSessionID for every FileMeta row that still has them empty.
// The strategy mirrors the migration table in plan.md §migration:
//
//  1. Try to match the FileMeta.Key against the friend_chat
//     attachment table. On hit, owner = sender, session ULID copied,
//     visibility = chat, bucket = sender's `chat`.
//  2. On miss, the file is an orphan: assign it to
//     LegacyOwnerActorID's `chat` bucket with visibility=chat. (We
//     intentionally do not put orphans in `personal` because a
//     legacy actor we cannot identify cannot "own" private files.)
func backfillFileMetas(tx *gorm.DB, clock func() time.Time) (int, error) {
	var rows []ossmodel.FileMeta
	if err := tx.Where("bucket_id = '' OR bucket_id IS NULL").Find(&rows).Error; err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		return 0, nil
	}

	// Look up attachment metadata in one round trip.
	type attachInfo struct {
		CID         string
		MessageULID string
	}
	var attachments []attachInfo
	cids := make([]string, 0, len(rows))
	keyToCID := make(map[string]string, len(rows))
	for _, r := range rows {
		// FileMeta.Key is stored in the attachment row as the bare
		// content key (no `oss://` prefix); historically attachments
		// are stored with their full CID URI. We try both forms.
		cids = append(cids, r.Key, "oss://self/"+r.Key)
		keyToCID[r.Key] = r.Key
	}
	if err := tx.Raw(`
		SELECT cid, message_ulid AS message_ulid
		FROM friend_chat_message_attachments
		WHERE cid IN (?)
	`, cids).Scan(&attachments).Error; err != nil {
		// Table may not exist in tests; treat as empty result.
		attachments = nil
	}

	// Resolve message_ulid → (sender_did, session_ulid) for the
	// matched attachments.
	type msgInfo struct {
		ULID        string
		SenderDID   string
		SessionULID string
	}
	var messages []msgInfo
	if len(attachments) > 0 {
		ulids := make([]string, 0, len(attachments))
		for _, a := range attachments {
			ulids = append(ulids, a.MessageULID)
		}
		_ = tx.Raw(`
			SELECT ulid, sender_did, session_ulid
			FROM friend_chat_messages
			WHERE ulid IN (?)
		`, ulids).Scan(&messages).Error
	}
	msgByULID := make(map[string]msgInfo, len(messages))
	for _, m := range messages {
		msgByULID[m.ULID] = m
	}
	cidToMsg := make(map[string]msgInfo, len(attachments))
	for _, a := range attachments {
		if m, ok := msgByULID[a.MessageULID]; ok {
			cidToMsg[a.CID] = m
		}
	}

	// Cache: (owner, bucketName) → bucketID. Avoids re-querying for
	// every file from the same sender.
	bucketCache := make(map[string]string)
	bucketIDFor := func(owner, name string) (string, error) {
		key := owner + "|" + name
		if id, ok := bucketCache[key]; ok {
			return id, nil
		}
		var b ossmodel.Bucket
		err := tx.Where("owner_actor_id = ? AND name = ?", owner, name).First(&b).Error
		if err != nil {
			return "", err
		}
		bucketCache[key] = b.ID
		return b.ID, nil
	}

	now := clock()
	updated := 0
	for _, r := range rows {
		var (
			owner   string
			vis     string
			session string
		)
		if m, ok := cidToMsg[r.Key]; ok {
			owner = m.SenderDID
			vis = ossmodel.VisibilityChat
			session = m.SessionULID
		} else if m, ok := cidToMsg["oss://self/"+r.Key]; ok {
			owner = m.SenderDID
			vis = ossmodel.VisibilityChat
			session = m.SessionULID
		} else {
			owner = ossmodel.LegacyOwnerActorID
			vis = ossmodel.VisibilityChat
			session = ""
		}
		bucketID, err := bucketIDFor(owner, ossmodel.SystemBucketChat)
		if err != nil {
			// Last-resort fallback: use the legacy actor's chat
			// bucket. If even that fails, skip this row — better
			// to leave it un-backfilled than to abort the whole
			// migration.
			bucketID, err = bucketIDFor(ossmodel.LegacyOwnerActorID, ossmodel.SystemBucketChat)
			if err != nil {
				continue
			}
			owner = ossmodel.LegacyOwnerActorID
		}
		if err := tx.Model(&ossmodel.FileMeta{}).
			Where("id = ?", r.ID).
			Updates(map[string]any{
				"bucket_id":       bucketID,
				"owner_actor_id":  owner,
				"visibility":      vis,
				"chat_session_id": session,
			}).Error; err != nil {
			return updated, err
		}
		_ = now // reserved if we ever decide to bump UpdatedAt on FileMeta
		updated++
	}
	return updated, nil
}

// reconcileUsage rewrites every bucket's UsedBytes and ObjectCount
// from the source-of-truth `oss_files` rows.
func reconcileUsage(tx *gorm.DB, clock func() time.Time) (int, error) {
	type row struct {
		BucketID    string
		Total       int64
		ObjectCount int64
	}
	var rows []row
	if err := tx.Raw(`
		SELECT bucket_id, COALESCE(SUM(size),0) AS total, COUNT(*) AS object_count
		FROM oss_files
		WHERE bucket_id <> '' AND bucket_id IS NOT NULL
		GROUP BY bucket_id
	`).Scan(&rows).Error; err != nil {
		return 0, err
	}

	now := clock()
	updated := 0
	// Reset all buckets first so deleted-only buckets drop to zero.
	if err := tx.Model(&ossmodel.Bucket{}).
		Where("1 = 1").
		Updates(map[string]any{
			"used_bytes":   0,
			"object_count": 0,
			"updated_at":   now,
		}).Error; err != nil {
		return 0, err
	}
	for _, r := range rows {
		if err := tx.Model(&ossmodel.Bucket{}).
			Where("id = ?", r.BucketID).
			Updates(map[string]any{
				"used_bytes":   r.Total,
				"object_count": r.ObjectCount,
				"updated_at":   now,
			}).Error; err != nil {
			return updated, err
		}
		updated++
	}
	return updated, nil
}

// readSchemaVersion returns the schema_version stored in oss_meta,
// or "" if the row is missing.
func readSchemaVersion(db *gorm.DB) (string, error) {
	var m ossmodel.Meta
	err := db.Where("key = ?", ossmodel.MetaKeySchemaVersion).First(&m).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil
		}
		return "", err
	}
	return m.Value, nil
}

func writeSchemaVersion(tx *gorm.DB, now time.Time, version string) error {
	m := ossmodel.Meta{
		Key:       ossmodel.MetaKeySchemaVersion,
		Value:     version,
		UpdatedAt: now,
	}
	// Upsert: try update first, fall back to create.
	res := tx.Model(&ossmodel.Meta{}).
		Where("key = ?", ossmodel.MetaKeySchemaVersion).
		Updates(map[string]any{"value": version, "updated_at": now})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return tx.Create(&m).Error
	}
	return nil
}
