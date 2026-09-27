package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

type resetObjectOwnerFixture struct{}

func (resetObjectOwnerFixture) InspectResetObject(
	context.Context,
	ResolvedResetObjectTarget,
) (ResetObjectInspection, error) {
	return ResetObjectInspection{}, errors.New("unexpected object inspection")
}

func (resetObjectOwnerFixture) DeleteResetObject(
	context.Context,
	ResolvedResetObjectTarget,
) error {
	return errors.New("unexpected object deletion")
}

func (resetObjectOwnerFixture) VerifyResetObjectDeleted(
	context.Context,
	ResolvedResetObjectTarget,
) error {
	return errors.New("unexpected object verification")
}

type acceptingResetObjectOwnerFixture struct {
	inspected []ResolvedResetObjectTarget
	verified  []ResolvedResetObjectTarget
}

func (o *acceptingResetObjectOwnerFixture) InspectResetObject(
	_ context.Context,
	target ResolvedResetObjectTarget,
) (ResetObjectInspection, error) {
	o.inspected = append(o.inspected, target)

	return ResetObjectInspection{
		Backend:                 target.Backend,
		MetadataDigest:          sha256Hex([]byte(target.OwnerPTID + "\x00" + target.StorageKey)),
		BlobDigest:              sha256Hex([]byte(target.StorageKey)),
		ReferenceClassification: ResetReferenceSharedCASSafe,
	}, nil
}

func (*acceptingResetObjectOwnerFixture) DeleteResetObject(
	context.Context,
	ResolvedResetObjectTarget,
) error {
	return nil
}

func (o *acceptingResetObjectOwnerFixture) VerifyResetObjectDeleted(
	_ context.Context,
	target ResolvedResetObjectTarget,
) error {
	o.verified = append(o.verified, target)
	return nil
}

func TestGORMSecureContentResetStorePrepareManifest(t *testing.T) {
	t.Run("accepts the reviewed pre-activation private Post shape", func(t *testing.T) {
		database, store := openSecureContentResetStore(t)
		rewritePrivatePostSchema(
			t,
			database,
			func(ddl string) string {
				ddl = strings.Replace(
					ddl,
					"CREATE TABLE `social_private_posts` (",
					"CREATE TABLE `social_private_posts` (`id` integer PRIMARY KEY,",
					1,
				)
				ddl = strings.ReplaceAll(ddl, " NOT NULL", "")
				return strings.Replace(
					ddl,
					",PRIMARY KEY (`post_id`)",
					"",
					1,
				)
			},
			nil,
		)
		addRetiredPrivatePostColumns(t, database)
		if err := database.Exec(
			"CREATE INDEX idx_spri_created ON social_private_posts(created_at)",
		).Error; err != nil {
			t.Fatal(err)
		}

		if _, err := store.PrepareManifest(
			context.Background(),
			resetScopeFixture(),
			resetObjectOwnerFixture{},
			resetObjectOwnerFixture{},
		); err != nil {
			t.Fatalf("PrepareManifest() error = %v", err)
		}
	})

	t.Run("drains Post rows before resolving attachment owners", func(t *testing.T) {
		database, store := openSecureContentResetStore(t)
		actor := dbmodel.Actor{
			ID:                1,
			PTID:              "ptid:alice",
			PreferredUsername: "alice",
			FederatedHandle:   "@alice@example.test",
			Email:             "alice@example.test",
			PasswordHash:      "hash",
		}
		if err := database.Create(&actor).Error; err != nil {
			t.Fatal(err)
		}
		now := time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC)
		post := dbmodel.SocialPublicPost{
			ID:              101,
			AuthorID:        actor.ID,
			Type:            "IMAGE",
			AudienceKind:    "PUBLIC",
			AttachmentsJSON: `["public-object-key"]`,
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		if err := database.Create(&post).Error; err != nil {
			t.Fatal(err)
		}
		sqlDatabase, err := database.DB()
		if err != nil {
			t.Fatal(err)
		}
		sqlDatabase.SetMaxOpenConns(1)

		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if _, err := store.PrepareManifest(
			ctx,
			resetScopeFixture(),
			resetObjectOwnerFixture{},
			&acceptingResetObjectOwnerFixture{},
		); err != nil {
			t.Fatalf("PrepareManifest() error = %v", err)
		}
	})

	t.Run("admits verified garbage-collected object tombstones", func(t *testing.T) {
		database, store := openSecureContentResetStore(t)
		now := time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC)
		storageKey := "social-private/objects/aa/object"
		partStorageKey := "social-private/parts/aa/part"
		blobDigest := make([]byte, 32)
		upload := dbmodel.SocialPrivateObjectUpload{
			UploadID:                   "upload-garbage-collected",
			Generation:                 1,
			PlanID:                     "plan-garbage-collected",
			ObjectID:                   "object-garbage-collected",
			ContentID:                  "content-garbage-collected",
			UploaderPTID:               "ptid:alice",
			UploaderDeviceID:           "device-alice",
			UploadSpecBytes:            []byte("upload-spec"),
			UploadSpecSHA256:           make([]byte, 32),
			DescriptorCommitmentSHA256: make([]byte, 32),
			BeginCommandID:             "begin-garbage-collected",
			BeginCommandBytes:          []byte("begin-command"),
			BeginCommandSHA256:         make([]byte, 32),
			ReceivedChunkBitmap:        []byte{1},
			State:                      dbmodel.SocialPrivateObjectGarbageCollected,
			FinalStorageKey:            storageKey,
			ExpiresAt:                  now,
			CreatedAt:                  now,
			UpdatedAt:                  now,
			TombstonedAt:               &now,
		}
		if err := database.Create(&upload).Error; err != nil {
			t.Fatal(err)
		}
		part := dbmodel.SocialPrivateObjectChunk{
			UploadID:               upload.UploadID,
			Generation:             upload.Generation,
			ChunkIndex:             0,
			Size:                   42,
			CiphertextSHA256:       blobDigest,
			IdempotencyKey:         "part-garbage-collected",
			CanonicalCommandSHA256: make([]byte, 32),
			StorageKey:             partStorageKey,
			State:                  dbmodel.SocialPrivateObjectPartStored,
			StoredAt:               &now,
			CreatedAt:              now,
			UpdatedAt:              now,
		}
		if err := database.Create(&part).Error; err != nil {
			t.Fatal(err)
		}
		object := dbmodel.SocialPrivateObjectAttachment{
			ObjectID:                 upload.ObjectID,
			UploadID:                 upload.UploadID,
			UploadGeneration:         upload.Generation,
			ContentID:                upload.ContentID,
			UploaderPTID:             upload.UploaderPTID,
			UploaderDeviceID:         upload.UploaderDeviceID,
			CanonicalDescriptorBytes: []byte("descriptor"),
			DescriptorSHA256:         make([]byte, 32),
			StorageKey:               storageKey,
			TotalCiphertextSize:      84,
			CiphertextSHA256:         blobDigest,
			State:                    dbmodel.SocialPrivateObjectGarbageCollected,
			CreatedAt:                now,
			UpdatedAt:                now,
			ExpiresAt:                now,
			TombstonedAt:             &now,
		}
		if err := database.Create(&object).Error; err != nil {
			t.Fatal(err)
		}

		socialOwner := &acceptingResetObjectOwnerFixture{}
		prepared, err := store.PrepareManifest(
			context.Background(),
			resetScopeFixture(),
			socialOwner,
			resetObjectOwnerFixture{},
		)
		if err != nil {
			t.Fatalf("PrepareManifest() error = %v", err)
		}
		if len(socialOwner.inspected) != 0 ||
			len(socialOwner.verified) != 2 {
			t.Fatalf(
				"garbage-collected target inspected=%d verified=%d",
				len(socialOwner.inspected),
				len(socialOwner.verified),
			)
		}
		if len(prepared.Manifest.CanonicalPrivateObjectTargets) != 2 ||
			len(prepared.ObjectTargets) != 2 {
			t.Fatalf(
				"garbage-collected targets manifest=%d resolved=%d",
				len(prepared.Manifest.CanonicalPrivateObjectTargets),
				len(prepared.ObjectTargets),
			)
		}
	})

	t.Run("rejects an unreviewed pre-activation default", func(t *testing.T) {
		database, store := openSecureContentResetStore(t)
		rewritePrivatePostSchema(
			t,
			database,
			func(ddl string) string {
				ddl = strings.Replace(
					ddl,
					"CREATE TABLE `social_private_posts` (",
					"CREATE TABLE `social_private_posts` (`id` integer PRIMARY KEY,",
					1,
				)
				ddl = strings.ReplaceAll(ddl, " NOT NULL", "")
				ddl = strings.Replace(
					ddl,
					"DEFAULT 0",
					"DEFAULT 1",
					1,
				)
				return strings.Replace(
					ddl,
					",PRIMARY KEY (`post_id`)",
					"",
					1,
				)
			},
			nil,
		)
		addRetiredPrivatePostColumns(t, database)

		_, err := store.PrepareManifest(
			context.Background(),
			resetScopeFixture(),
			resetObjectOwnerFixture{},
			resetObjectOwnerFixture{},
		)
		if ResetCodeOf(err) != ResetCodeSchemaTargetUnreviewed {
			t.Fatalf("PrepareManifest() error = %v", err)
		}
	})

	t.Run("rejects an unreviewed pre-activation index shape", func(t *testing.T) {
		database, store := openSecureContentResetStore(t)
		addRetiredPrivatePostColumns(t, database)
		if err := database.Exec(
			"CREATE INDEX idx_spri_created ON " +
				"social_private_posts(created_at, comments_count)",
		).Error; err != nil {
			t.Fatal(err)
		}

		_, err := store.PrepareManifest(
			context.Background(),
			resetScopeFixture(),
			resetObjectOwnerFixture{},
			resetObjectOwnerFixture{},
		)
		if ResetCodeOf(err) != ResetCodeSchemaTargetUnreviewed {
			t.Fatalf("PrepareManifest() error = %v", err)
		}
	})

	t.Run("rejects an unknown private Post column", func(t *testing.T) {
		database, store := openSecureContentResetStore(t)
		if err := database.Exec(
			"ALTER TABLE social_private_posts ADD COLUMN rogue_secret TEXT",
		).Error; err != nil {
			t.Fatal(err)
		}

		_, err := store.PrepareManifest(
			context.Background(),
			resetScopeFixture(),
			resetObjectOwnerFixture{},
			resetObjectOwnerFixture{},
		)
		if ResetCodeOf(err) != ResetCodeSchemaTargetUnreviewed {
			t.Fatalf("PrepareManifest() error = %v", err)
		}
	})

	t.Run("rejects an inbound foreign key edge", func(t *testing.T) {
		database, store := openSecureContentResetStore(t)
		if err := database.Exec(`
CREATE TABLE rogue_private_reference (
	id INTEGER PRIMARY KEY,
	private_post_id TEXT,
	FOREIGN KEY(private_post_id) REFERENCES social_private_posts(post_id)
)`).Error; err != nil {
			t.Fatal(err)
		}

		_, err := store.PrepareManifest(
			context.Background(),
			resetScopeFixture(),
			resetObjectOwnerFixture{},
			resetObjectOwnerFixture{},
		)
		if ResetCodeOf(err) != ResetCodeForeignKeyUnreviewed {
			t.Fatalf("PrepareManifest() error = %v", err)
		}
	})

	t.Run("preserves distinct legacy OSS owner and key pairs", func(t *testing.T) {
		database, store := openSecureContentResetStore(t)
		addRetiredPrivatePostColumns(t, database)
		now := time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC)
		for index, actor := range []dbmodel.Actor{
			{
				ID:                1,
				PTID:              "ptid:alice",
				PreferredUsername: "alice",
				FederatedHandle:   "@alice@example.test",
				Email:             "alice@example.test",
				PasswordHash:      "hash",
			},
			{
				ID:                2,
				PTID:              "ptid:bob",
				PreferredUsername: "bob",
				FederatedHandle:   "@bob@example.test",
				Email:             "bob@example.test",
				PasswordHash:      "hash",
			},
		} {
			if err := database.Create(&actor).Error; err != nil {
				t.Fatal(err)
			}
			postID := fmt.Sprintf("legacy-post-%d", index+1)
			post := canonicalPrivatePostFixture(postID, actor.PTID, now)
			if err := database.Create(&post).Error; err != nil {
				t.Fatal(err)
			}
			if err := database.Table("social_private_posts").
				Where("post_id = ?", postID).
				Updates(map[string]any{
					"id":               index + 1,
					"author_id":        actor.ID,
					"type":             "IMAGE",
					"attachments_json": `["shared-cas-key"]`,
				}).Error; err != nil {
				t.Fatal(err)
			}
		}

		legacyOwner := &acceptingResetObjectOwnerFixture{}
		prepared, err := store.PrepareManifest(
			context.Background(),
			resetScopeFixture(),
			resetObjectOwnerFixture{},
			legacyOwner,
		)
		if err != nil {
			t.Fatal(err)
		}
		if len(prepared.Manifest.LegacyOSSObjectTargets) != 2 ||
			len(prepared.ObjectTargets) != 2 ||
			len(legacyOwner.inspected) != 2 {
			t.Fatalf(
				"legacy targets manifest=%d resolved=%d inspected=%d, want 2 each",
				len(prepared.Manifest.LegacyOSSObjectTargets),
				len(prepared.ObjectTargets),
				len(legacyOwner.inspected),
			)
		}
		if prepared.ObjectTargets[0].OwnerPTID ==
			prepared.ObjectTargets[1].OwnerPTID {
			t.Fatal("same OSS key under two owners collapsed into one target")
		}
		if err := store.SaveAuditedManifest(
			context.Background(),
			prepared,
		); err != nil {
			t.Fatal(err)
		}
		persisted, err := store.AllObjectTargets(
			context.Background(),
			prepared.Manifest.ResetID,
		)
		if err != nil {
			t.Fatal(err)
		}
		if len(persisted) != 2 {
			t.Fatalf("persisted legacy targets = %d, want 2", len(persisted))
		}
		if err := store.MarkObjectDeleted(
			context.Background(),
			persisted[0],
			now,
		); err != nil {
			t.Fatal(err)
		}
		pending, err := store.PendingObjectTargets(
			context.Background(),
			prepared.Manifest.ResetID,
		)
		if err != nil {
			t.Fatal(err)
		}
		if len(pending) != 1 ||
			pending[0].OwnerPTID == persisted[0].OwnerPTID {
			t.Fatalf("pending targets after one delete = %#v", pending)
		}
	})
}

func TestAddRawObjectReferenceRejectsConflictingSourceDigests(t *testing.T) {
	references := make(map[string]*rawObjectReference)
	first := rawObjectReference{
		OwnerDomain:        ResetObjectDomainOSS,
		OwnerPTID:          "ptid:alice",
		Backend:            "oss",
		StorageKey:         "shared-key",
		ExpectedBlobDigest: stringsRepeat("a", 64),
		SourceRows:         []string{stringsRepeat("1", 64)},
	}
	if err := addRawObjectReference(references, first); err != nil {
		t.Fatal(err)
	}
	differentOwner := first
	differentOwner.OwnerPTID = "ptid:bob"
	differentOwner.ExpectedBlobDigest = stringsRepeat("b", 64)
	if err := addRawObjectReference(references, differentOwner); err != nil {
		t.Fatalf("different owner identity must remain independent: %v", err)
	}
	if len(references) != 2 {
		t.Fatalf("object references = %d, want 2 exact owner identities", len(references))
	}
	tombstone := first
	tombstone.ExpectedAbsent = true
	tombstone.SourceRows = []string{stringsRepeat("2", 64)}
	if err := addRawObjectReference(references, tombstone); err != nil {
		t.Fatal(err)
	}
	if references[rawObjectReferenceIdentity(first)].ExpectedAbsent {
		t.Fatal("a live source row was weakened by a garbage-collected tombstone")
	}

	conflicting := first
	conflicting.ExpectedBlobDigest = stringsRepeat("c", 64)
	err := addRawObjectReference(references, conflicting)
	if ResetCodeOf(err) != ResetCodeObjectDigestMismatch {
		t.Fatalf("conflicting source digest error = %v", err)
	}
}

func TestGORMSecureContentResetStoreSourceReplacement(t *testing.T) {
	t.Run("atomically supersedes a different-source PREPARED journal", func(t *testing.T) {
		_, store := openSecureContentResetStore(t)
		now := time.Date(2026, 9, 20, 3, 0, 0, 0, time.UTC)
		first := prepareResetFixture(t, store, resetScopeFixture())
		firstInvocation := resetInvocationFixture(first.Manifest, now)
		if _, replay, err := store.AcceptInvocation(
			context.Background(),
			firstInvocation,
			&first,
			now,
		); err != nil || replay {
			t.Fatalf("first AcceptInvocation() replay=%v error=%v", replay, err)
		}

		nextIdentity := resetScopeFixture()
		nextIdentity.ResetID = "reset-four-2"
		nextIdentity.SourceCommit = stringsRepeat("c", 40)
		nextIdentity.CreatedAt = now.Add(time.Minute)
		next := prepareResetFixture(t, store, nextIdentity)
		nextInvocation := resetInvocationFixture(next.Manifest, now.Add(time.Minute))
		nextInvocation.InvocationID = "invocation-four-2"
		nextInvocation.InvocationDigest, _ = nextInvocation.CalculatedDigest()
		journal, replay, err := store.AcceptInvocation(
			context.Background(),
			nextInvocation,
			&next,
			now.Add(time.Minute),
		)
		if err != nil || replay {
			t.Fatalf("next AcceptInvocation() replay=%v error=%v", replay, err)
		}
		if journal.CurrentState != ResetStatePrepared {
			t.Fatalf("new journal state = %s, want PREPARED", journal.CurrentState)
		}

		superseded, found, err := store.LoadJournal(
			context.Background(),
			first.Manifest.ResetID,
		)
		if err != nil || !found {
			t.Fatalf("LoadJournal() found=%v error=%v", found, err)
		}
		if superseded.CurrentState != ResetStateSuperseded ||
			superseded.Failure == nil ||
			superseded.Failure.Code != ResetCodeSourceSuperseded {
			t.Fatalf("superseded journal = %#v", superseded)
		}
		if len(superseded.Transitions) != 1 ||
			superseded.Transitions[0].FromState != ResetStatePrepared ||
			superseded.Transitions[0].ToState != ResetStateSuperseded {
			t.Fatalf("superseded transitions = %#v", superseded.Transitions)
		}
		replayed, exactReplay, err := store.AcceptInvocation(
			context.Background(),
			firstInvocation,
			nil,
			now.Add(2*time.Minute),
		)
		if err != nil || !exactReplay ||
			replayed.CurrentState != ResetStateSuperseded {
			t.Fatalf(
				"superseded replay state=%s replay=%v error=%v",
				replayed.CurrentState,
				exactReplay,
				err,
			)
		}
		freshReplay := firstInvocation
		freshReplay.InvocationID = "invocation-four-after-superseded"
		freshReplay.InvocationDigest, _ = freshReplay.CalculatedDigest()
		_, _, err = store.AcceptInvocation(
			context.Background(),
			freshReplay,
			nil,
			now.Add(3*time.Minute),
		)
		if ResetCodeOf(err) != ResetCodeJournalStateConflict {
			t.Fatalf("fresh superseded invocation error = %v", err)
		}
		if err := store.RecordFailure(
			context.Background(),
			first.Manifest.ResetID,
			ResetCodePartialFailure,
			now.Add(4*time.Minute),
		); err != nil {
			t.Fatal(err)
		}
		unchanged, _, err := store.LoadJournal(
			context.Background(),
			first.Manifest.ResetID,
		)
		if err != nil ||
			unchanged.Failure == nil ||
			unchanged.Failure.Code != ResetCodeSourceSuperseded {
			t.Fatalf("terminal supersession failure changed: %#v error=%v", unchanged, err)
		}
	})

	t.Run("rejects same-source and identity-mismatched manifests", func(t *testing.T) {
		tests := []struct {
			name   string
			mutate func(*ResetScopeIdentity)
		}{
			{
				name: "same source",
				mutate: func(identity *ResetScopeIdentity) {
					identity.ResetID = "reset-four-same-source"
				},
			},
			{
				name: "different workspace",
				mutate: func(identity *ResetScopeIdentity) {
					identity.ResetID = "reset-four-other-workspace"
					identity.SourceCommit = stringsRepeat("c", 40)
					identity.WorkspaceID = "workspace-2"
				},
			},
		}
		for _, test := range tests {
			t.Run(test.name, func(t *testing.T) {
				_, store := openSecureContentResetStore(t)
				now := time.Date(2026, 9, 20, 3, 0, 0, 0, time.UTC)
				first := prepareResetFixture(t, store, resetScopeFixture())
				if _, _, err := store.AcceptInvocation(
					context.Background(),
					resetInvocationFixture(first.Manifest, now),
					&first,
					now,
				); err != nil {
					t.Fatal(err)
				}

				nextIdentity := resetScopeFixture()
				test.mutate(&nextIdentity)
				nextIdentity.CreatedAt = now.Add(time.Minute)
				next := prepareResetFixture(t, store, nextIdentity)
				invocation := resetInvocationFixture(next.Manifest, now.Add(time.Minute))
				invocation.InvocationID = "invocation-next"
				invocation.InvocationDigest, _ = invocation.CalculatedDigest()
				_, _, err := store.AcceptInvocation(
					context.Background(),
					invocation,
					&next,
					now.Add(time.Minute),
				)
				if ResetCodeOf(err) != ResetCodeManifestConflict {
					t.Fatalf("AcceptInvocation() error = %v", err)
				}
				current, _, err := store.LoadJournal(
					context.Background(),
					first.Manifest.ResetID,
				)
				if err != nil || current.CurrentState != ResetStatePrepared {
					t.Fatalf("original journal state=%s error=%v", current.CurrentState, err)
				}
			})
		}
	})

	t.Run("rejects supersession after database commit", func(t *testing.T) {
		_, store := openSecureContentResetStore(t)
		now := time.Date(2026, 9, 20, 3, 0, 0, 0, time.UTC)
		first := prepareResetFixture(t, store, resetScopeFixture())
		if _, _, err := store.AcceptInvocation(
			context.Background(),
			resetInvocationFixture(first.Manifest, now),
			&first,
			now,
		); err != nil {
			t.Fatal(err)
		}
		if err := store.CommitDatabase(
			context.Background(),
			first.Manifest.ResetID,
			now.Add(time.Minute),
		); err != nil {
			t.Fatal(err)
		}

		nextIdentity := resetScopeFixture()
		nextIdentity.ResetID = "reset-four-after-commit"
		nextIdentity.SourceCommit = stringsRepeat("c", 40)
		nextIdentity.CreatedAt = now.Add(2 * time.Minute)
		_, err := store.PrepareManifest(
			context.Background(),
			nextIdentity,
			resetObjectOwnerFixture{},
			resetObjectOwnerFixture{},
		)
		if ResetCodeOf(err) != ResetCodeManifestConflict {
			t.Fatalf("PrepareManifest() error = %v", err)
		}
		current, _, err := store.LoadJournal(
			context.Background(),
			first.Manifest.ResetID,
		)
		if err != nil ||
			current.CurrentState != ResetStateDatabaseSchemaCommitted {
			t.Fatalf("original journal state=%s error=%v", current.CurrentState, err)
		}
	})

	t.Run("replaces one exact failed post-deploy predecessor", func(t *testing.T) {
		_, store := openSecureContentResetStore(t)
		now := time.Date(2026, 9, 20, 3, 0, 0, 0, time.UTC)
		first := prepareResetFixture(t, store, resetScopeFixture())
		target := ResolvedResetObjectTarget{
			ResetID:                 first.Manifest.ResetID,
			OwnerDomain:             ResetObjectDomainSocial,
			Backend:                 "social-private",
			StorageKey:              "social-private/recovery-target",
			ExpectedMetadataDigest:  stringsRepeat("d", 64),
			ExpectedBlobDigest:      stringsRepeat("e", 64),
			SourceRowDigest:         stringsRepeat("f", 64),
			ReferenceClassification: ResetReferenceCanonicalPrivate,
		}
		first.Manifest.CanonicalPrivateObjectTargets = []ObjectResetTarget{{
			OwnerDomain:             target.OwnerDomain,
			OwnerIdentityDigest:     sha256Hex([]byte(target.OwnerPTID)),
			Backend:                 target.Backend,
			StorageKeyDigest:        sha256Hex([]byte(target.StorageKey)),
			MetadataDigest:          target.ExpectedMetadataDigest,
			BlobDigest:              target.ExpectedBlobDigest,
			SourceRowDigest:         target.SourceRowDigest,
			ReferenceClassification: target.ReferenceClassification,
		}}
		first.Manifest.ManifestDigest, _ = first.Manifest.CalculatedDigest()
		if err := store.db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Where(
				"reset_id = ?",
				first.Manifest.ResetID,
			).Delete(&secureContentResetManifestModel{}).Error; err != nil {
				return err
			}
			if err := tx.Where(
				"reset_id = ?",
				first.Manifest.ResetID,
			).Delete(&secureContentResetObjectTargetModel{}).Error; err != nil {
				return err
			}
			return savePreparedManifest(tx, PreparedSecureContentReset{
				Manifest:      first.Manifest,
				ObjectTargets: []ResolvedResetObjectTarget{target},
			})
		}); err != nil {
			t.Fatal(err)
		}
		invocation := resetInvocationFixture(first.Manifest, now)
		if _, _, err := store.AcceptInvocation(
			context.Background(),
			invocation,
			&first,
			now,
		); err != nil {
			t.Fatal(err)
		}
		if err := store.CommitDatabase(
			context.Background(),
			first.Manifest.ResetID,
			now.Add(time.Minute),
		); err != nil {
			t.Fatal(err)
		}
		if err := store.MarkObjectDeleted(
			context.Background(),
			target,
			now.Add(2*time.Minute),
		); err != nil {
			t.Fatal(err)
		}
		if err := store.AdvanceJournal(
			context.Background(),
			first.Manifest.ResetID,
			ResetStateDatabaseSchemaCommitted,
			ResetStateObjectsDeleted,
			now.Add(2*time.Minute),
		); err != nil {
			t.Fatal(err)
		}
		if err := store.AdvanceJournal(
			context.Background(),
			first.Manifest.ResetID,
			ResetStateObjectsDeleted,
			ResetStateStationDeployed,
			now.Add(3*time.Minute),
		); err != nil {
			t.Fatal(err)
		}
		if err := store.RecordFailure(
			context.Background(),
			first.Manifest.ResetID,
			ResetCodeSchemaTargetUnreviewed,
			now.Add(4*time.Minute),
		); err != nil {
			t.Fatal(err)
		}

		nextIdentity := resetScopeFixture()
		nextIdentity.ResetID = "reset-four-recovery"
		nextIdentity.SourceCommit = stringsRepeat("c", 40)
		nextIdentity.CreatedAt = now.Add(5 * time.Minute)
		next := prepareResetFixture(t, store, nextIdentity)
		if next.Manifest.RecoveryPredecessor == nil ||
			next.Manifest.RecoveryPredecessor.ResetID != first.Manifest.ResetID {
			t.Fatalf(
				"recovery predecessor = %#v",
				next.Manifest.RecoveryPredecessor,
			)
		}
		nextInvocation := resetInvocationFixture(
			next.Manifest,
			now.Add(5*time.Minute),
		)
		nextInvocation.InvocationID = "invocation-four-recovery"
		nextInvocation.InvocationDigest, _ = nextInvocation.CalculatedDigest()
		if _, replay, err := store.AcceptInvocation(
			context.Background(),
			nextInvocation,
			&next,
			now.Add(5*time.Minute),
		); err != nil || replay {
			t.Fatalf("recovery admission replay=%v error=%v", replay, err)
		}
		replaced, _, err := store.LoadJournal(
			context.Background(),
			first.Manifest.ResetID,
		)
		if err != nil ||
			replaced.CurrentState != ResetStateRecoveryReplaced ||
			replaced.Failure == nil ||
			replaced.Failure.Code != ResetCodeSchemaTargetUnreviewed {
			t.Fatalf("replaced journal = %#v error=%v", replaced, err)
		}
		persistedFirst, err := store.Manifest(
			context.Background(),
			first.Manifest.ResetID,
		)
		if err != nil ||
			persistedFirst.ManifestDigest != first.Manifest.ManifestDigest {
			t.Fatalf(
				"predecessor manifest digest=%s want=%s error=%v",
				persistedFirst.ManifestDigest,
				first.Manifest.ManifestDigest,
				err,
			)
		}
		nextIdentity.RecoveryPredecessor = next.Manifest.RecoveryPredecessor
		resumed, err := store.PrepareManifest(
			context.Background(),
			nextIdentity,
			resetObjectOwnerFixture{},
			resetObjectOwnerFixture{},
		)
		if err != nil ||
			resumed.Manifest.ManifestDigest != next.Manifest.ManifestDigest {
			t.Fatalf(
				"recovery resume manifest=%s want=%s error=%v",
				resumed.Manifest.ManifestDigest,
				next.Manifest.ManifestDigest,
				err,
			)
		}

		socialOwner := &acceptingResetObjectOwnerFixture{}
		if _, err := store.PostAudit(
			context.Background(),
			next.Manifest,
			socialOwner,
			resetObjectOwnerFixture{},
		); err != nil {
			t.Fatal(err)
		}
		var receipt secureContentResetReplacementModel
		if err := store.db.Where(
			"predecessor_reset_id = ?",
			first.Manifest.ResetID,
		).First(&receipt).Error; err != nil {
			t.Fatal(err)
		}
		if err := store.db.Model(&secureContentResetReplacementModel{}).
			Where("predecessor_reset_id = ?", first.Manifest.ResetID).
			Update(
				"predecessor_journal_digest",
				stringsRepeat("0", 64),
			).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := store.PostAudit(
			context.Background(),
			next.Manifest,
			socialOwner,
			resetObjectOwnerFixture{},
		); ResetCodeOf(err) != ResetCodeJournalStateConflict {
			t.Fatalf("altered replacement receipt error=%v", err)
		}
		if err := store.db.Model(&secureContentResetReplacementModel{}).
			Where("predecessor_reset_id = ?", first.Manifest.ResetID).
			Update(
				"predecessor_journal_digest",
				receipt.PredecessorJournalDigest,
			).Error; err != nil {
			t.Fatal(err)
		}
		if err := store.db.Delete(&receipt).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := store.PostAudit(
			context.Background(),
			next.Manifest,
			socialOwner,
			resetObjectOwnerFixture{},
		); ResetCodeOf(err) != ResetCodeJournalStateConflict {
			t.Fatalf("missing replacement receipt error=%v", err)
		}
		if err := store.db.Create(&receipt).Error; err != nil {
			t.Fatal(err)
		}
		if len(socialOwner.verified) != 1 ||
			socialOwner.verified[0].ResetID != first.Manifest.ResetID {
			t.Fatalf(
				"predecessor object verification = %#v",
				socialOwner.verified,
			)
		}
		if err := store.CommitDatabase(
			context.Background(),
			next.Manifest.ResetID,
			now.Add(6*time.Minute),
		); err != nil {
			t.Fatal(err)
		}
		if err := store.AdvanceJournal(
			context.Background(),
			next.Manifest.ResetID,
			ResetStateDatabaseSchemaCommitted,
			ResetStateObjectsDeleted,
			now.Add(7*time.Minute),
		); err != nil {
			t.Fatal(err)
		}
		if err := store.AdvanceJournal(
			context.Background(),
			next.Manifest.ResetID,
			ResetStateObjectsDeleted,
			ResetStateStationDeployed,
			now.Add(8*time.Minute),
		); err != nil {
			t.Fatal(err)
		}
		if err := store.RecordFailure(
			context.Background(),
			next.Manifest.ResetID,
			ResetCodeJournalStateConflict,
			now.Add(9*time.Minute),
		); err != nil {
			t.Fatal(err)
		}
		thirdIdentity := resetScopeFixture()
		thirdIdentity.ResetID = "reset-four-recovery-chain"
		thirdIdentity.SourceCommit = stringsRepeat("d", 40)
		thirdIdentity.CreatedAt = now.Add(10 * time.Minute)
		third := prepareResetFixture(t, store, thirdIdentity)
		if third.Manifest.RecoveryPredecessor == nil ||
			third.Manifest.RecoveryPredecessor.FailureCode !=
				ResetCodeSourceSuperseded {
			t.Fatalf(
				"recovery-chain source defect predecessor = %#v",
				third.Manifest.RecoveryPredecessor,
			)
		}
		thirdInvocation := resetInvocationFixture(
			third.Manifest,
			now.Add(10*time.Minute),
		)
		thirdInvocation.InvocationID = "invocation-four-recovery-chain"
		thirdInvocation.InvocationDigest, _ = thirdInvocation.CalculatedDigest()
		if _, replay, err := store.AcceptInvocation(
			context.Background(),
			thirdInvocation,
			&third,
			now.Add(10*time.Minute),
		); err != nil || replay {
			t.Fatalf("chained recovery admission replay=%v error=%v", replay, err)
		}
		chainOwner := &acceptingResetObjectOwnerFixture{}
		if _, err := store.PostAudit(
			context.Background(),
			third.Manifest,
			chainOwner,
			resetObjectOwnerFixture{},
		); err != nil {
			t.Fatal(err)
		}
		if len(chainOwner.verified) != 1 ||
			chainOwner.verified[0].ResetID != first.Manifest.ResetID {
			t.Fatalf("recovery chain verification = %#v", chainOwner.verified)
		}
		storageKeyDigest := sha256Hex([]byte(target.StorageKey))
		if err := store.db.Model(&secureContentResetObjectTargetModel{}).
			Where(
				"reset_id = ? AND storage_key_digest = ?",
				first.Manifest.ResetID,
				storageKeyDigest,
			).
			Update("storage_key_digest", stringsRepeat("0", 64)).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := store.PostAudit(
			context.Background(),
			third.Manifest,
			socialOwner,
			resetObjectOwnerFixture{},
		); ResetCodeOf(err) != ResetCodeObjectDigestMismatch {
			t.Fatalf("altered predecessor target error = %v", err)
		}
		if err := store.db.Model(&secureContentResetObjectTargetModel{}).
			Where(
				"reset_id = ? AND storage_key_digest = ?",
				first.Manifest.ResetID,
				stringsRepeat("0", 64),
			).
			Update("storage_key_digest", storageKeyDigest).Error; err != nil {
			t.Fatal(err)
		}
		if err := store.db.Where(
			"reset_id = ?",
			first.Manifest.ResetID,
		).Delete(&secureContentResetObjectTargetModel{}).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := store.PostAudit(
			context.Background(),
			third.Manifest,
			socialOwner,
			resetObjectOwnerFixture{},
		); ResetCodeOf(err) != ResetCodeObjectDigestMismatch {
			t.Fatalf("missing predecessor target error = %v", err)
		}
	})

	t.Run("replaces an unfailed OBJECTS_DELETED handoff", func(t *testing.T) {
		_, store := openSecureContentResetStore(t)
		now := time.Date(2026, 9, 20, 3, 0, 0, 0, time.UTC)
		first := prepareResetFixture(t, store, resetScopeFixture())
		if _, _, err := store.AcceptInvocation(
			context.Background(),
			resetInvocationFixture(first.Manifest, now),
			&first,
			now,
		); err != nil {
			t.Fatal(err)
		}
		if err := store.CommitDatabase(
			context.Background(),
			first.Manifest.ResetID,
			now.Add(time.Minute),
		); err != nil {
			t.Fatal(err)
		}
		if err := store.AdvanceJournal(
			context.Background(),
			first.Manifest.ResetID,
			ResetStateDatabaseSchemaCommitted,
			ResetStateObjectsDeleted,
			now.Add(2*time.Minute),
		); err != nil {
			t.Fatal(err)
		}

		nextIdentity := resetScopeFixture()
		nextIdentity.ResetID = "reset-four-objects-deleted"
		nextIdentity.SourceCommit = stringsRepeat("c", 40)
		nextIdentity.CreatedAt = now.Add(3 * time.Minute)
		next := prepareResetFixture(t, store, nextIdentity)
		if next.Manifest.RecoveryPredecessor == nil ||
			next.Manifest.RecoveryPredecessor.State != ResetStateObjectsDeleted ||
			next.Manifest.RecoveryPredecessor.FailureCode !=
				ResetCodeSourceSuperseded {
			t.Fatalf(
				"OBJECTS_DELETED recovery predecessor = %#v",
				next.Manifest.RecoveryPredecessor,
			)
		}
		invocation := resetInvocationFixture(
			next.Manifest,
			now.Add(3*time.Minute),
		)
		invocation.InvocationID = "invocation-four-objects-deleted"
		invocation.InvocationDigest, _ = invocation.CalculatedDigest()
		if _, replay, err := store.AcceptInvocation(
			context.Background(),
			invocation,
			&next,
			now.Add(3*time.Minute),
		); err != nil || replay {
			t.Fatalf("OBJECTS_DELETED replacement replay=%v error=%v", replay, err)
		}
		replaced, _, err := store.LoadJournal(
			context.Background(),
			first.Manifest.ResetID,
		)
		if err != nil ||
			replaced.CurrentState != ResetStateRecoveryReplaced ||
			replaced.Failure != nil {
			t.Fatalf("OBJECTS_DELETED predecessor = %#v error=%v", replaced, err)
		}
		var receipt secureContentResetReplacementModel
		if err := store.db.Where(
			"predecessor_reset_id = ?",
			first.Manifest.ResetID,
		).First(&receipt).Error; err != nil {
			t.Fatal(err)
		}
		if receipt.PredecessorFailureCode != "" ||
			receipt.TerminalFailureCode != "" ||
			ResetCode(receipt.ReplacementReason) != ResetCodeSourceSuperseded ||
			receipt.ProvenanceMode != replacementProvenanceAdmission {
			t.Fatalf("OBJECTS_DELETED replacement receipt = %#v", receipt)
		}
	})

	t.Run("replaces an OBJECTS_DELETED partial failure", func(t *testing.T) {
		_, store := openSecureContentResetStore(t)
		now := time.Date(2026, 9, 20, 3, 0, 0, 0, time.UTC)
		first := prepareResetFixture(t, store, resetScopeFixture())
		if _, _, err := store.AcceptInvocation(
			context.Background(),
			resetInvocationFixture(first.Manifest, now),
			&first,
			now,
		); err != nil {
			t.Fatal(err)
		}
		if err := store.CommitDatabase(
			context.Background(),
			first.Manifest.ResetID,
			now.Add(time.Minute),
		); err != nil {
			t.Fatal(err)
		}
		if err := store.AdvanceJournal(
			context.Background(),
			first.Manifest.ResetID,
			ResetStateDatabaseSchemaCommitted,
			ResetStateObjectsDeleted,
			now.Add(2*time.Minute),
		); err != nil {
			t.Fatal(err)
		}
		if err := store.RecordFailure(
			context.Background(),
			first.Manifest.ResetID,
			ResetCodePartialFailure,
			now.Add(3*time.Minute),
		); err != nil {
			t.Fatal(err)
		}

		nextIdentity := resetScopeFixture()
		nextIdentity.ResetID = "reset-four-objects-deleted-partial"
		nextIdentity.SourceCommit = stringsRepeat("c", 40)
		nextIdentity.CreatedAt = now.Add(4 * time.Minute)
		next := prepareResetFixture(t, store, nextIdentity)
		if next.Manifest.RecoveryPredecessor == nil ||
			next.Manifest.RecoveryPredecessor.State != ResetStateObjectsDeleted ||
			next.Manifest.RecoveryPredecessor.FailureCode !=
				ResetCodeSourceSuperseded {
			t.Fatalf(
				"OBJECTS_DELETED partial-failure recovery predecessor = %#v",
				next.Manifest.RecoveryPredecessor,
			)
		}
		invocation := resetInvocationFixture(
			next.Manifest,
			now.Add(4*time.Minute),
		)
		invocation.InvocationID = "invocation-four-objects-deleted-partial"
		invocation.InvocationDigest, _ = invocation.CalculatedDigest()
		if _, replay, err := store.AcceptInvocation(
			context.Background(),
			invocation,
			&next,
			now.Add(4*time.Minute),
		); err != nil || replay {
			t.Fatalf("OBJECTS_DELETED partial-failure replacement replay=%v error=%v", replay, err)
		}
		replaced, _, err := store.LoadJournal(
			context.Background(),
			first.Manifest.ResetID,
		)
		if err != nil ||
			replaced.Failure == nil ||
			replaced.Failure.Code != ResetCodePartialFailure {
			t.Fatalf("OBJECTS_DELETED partial-failure predecessor = %#v error=%v", replaced, err)
		}
		var receipt secureContentResetReplacementModel
		if err := store.db.Where(
			"predecessor_reset_id = ?",
			first.Manifest.ResetID,
		).First(&receipt).Error; err != nil {
			t.Fatal(err)
		}
		if ResetCode(receipt.PredecessorFailureCode) != ResetCodePartialFailure ||
			ResetCode(receipt.TerminalFailureCode) != ResetCodePartialFailure ||
			ResetCode(receipt.ReplacementReason) != ResetCodeSourceSuperseded ||
			receipt.ProvenanceMode != replacementProvenanceAdmission {
			t.Fatalf("OBJECTS_DELETED partial-failure receipt = %#v", receipt)
		}
		if _, err := store.PostAudit(
			context.Background(),
			next.Manifest,
			resetObjectOwnerFixture{},
			resetObjectOwnerFixture{},
		); err != nil {
			t.Fatalf("OBJECTS_DELETED partial-failure post-audit error=%v", err)
		}
		if err := store.db.Model(&secureContentResetJournalModel{}).
			Where("reset_id = ?", first.Manifest.ResetID).
			Updates(map[string]any{
				"failure_code": string(ResetCodeSourceSuperseded),
				"failure_at":   now.Add(4 * time.Minute),
			}).Error; err != nil {
			t.Fatal(err)
		}
		if err := store.db.Model(&secureContentResetReplacementModel{}).
			Where("predecessor_reset_id = ?", first.Manifest.ResetID).
			Updates(map[string]any{
				"terminal_failure_code": string(ResetCodeSourceSuperseded),
				"provenance_mode":       replacementProvenanceMigration,
			}).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := store.PostAudit(
			context.Background(),
			next.Manifest,
			resetObjectOwnerFixture{},
			resetObjectOwnerFixture{},
		); err != nil {
			t.Fatalf("persisted migration receipt post-audit error=%v", err)
		}
		if err := store.db.Model(&secureContentResetReplacementModel{}).
			Where("predecessor_reset_id = ?", first.Manifest.ResetID).
			Update(
				"replacement_reason",
				string(ResetCodeSchemaTargetUnreviewed),
			).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := store.PostAudit(
			context.Background(),
			next.Manifest,
			resetObjectOwnerFixture{},
			resetObjectOwnerFixture{},
		); ResetCodeOf(err) != ResetCodeJournalStateConflict {
			t.Fatalf("altered migration receipt error=%v", err)
		}
	})

	t.Run("rejects unapproved post-deploy failures without recovery ancestry", func(t *testing.T) {
		for _, code := range []ResetCode{
			ResetCodePartialFailure,
			ResetCodeJournalStateConflict,
		} {
			t.Run(string(code), func(t *testing.T) {
				store, _, now := failedPostDeployResetFixture(t, code)
				nextIdentity := resetScopeFixture()
				nextIdentity.ResetID = "reset-four-wrong-failure"
				nextIdentity.SourceCommit = stringsRepeat("c", 40)
				nextIdentity.CreatedAt = now.Add(5 * time.Minute)
				if _, err := store.PrepareManifest(
					context.Background(),
					nextIdentity,
					resetObjectOwnerFixture{},
					resetObjectOwnerFixture{},
				); ResetCodeOf(err) != ResetCodeManifestConflict {
					t.Fatalf("PrepareManifest() error = %v", err)
				}
			})
		}
	})

	t.Run("journal digest race rolls back replacement", func(t *testing.T) {
		store, first, now := failedPostDeployResetFixture(
			t,
			ResetCodeSchemaTargetUnreviewed,
		)
		nextIdentity := resetScopeFixture()
		nextIdentity.ResetID = "reset-four-journal-race"
		nextIdentity.SourceCommit = stringsRepeat("c", 40)
		nextIdentity.CreatedAt = now.Add(5 * time.Minute)
		next := prepareResetFixture(t, store, nextIdentity)

		retry := resetInvocationFixture(first.Manifest, now.Add(6*time.Minute))
		retry.InvocationID = "invocation-four-journal-race"
		retry.InvocationDigest, _ = retry.CalculatedDigest()
		if _, replay, err := store.AcceptInvocation(
			context.Background(),
			retry,
			nil,
			now.Add(6*time.Minute),
		); err != nil || replay {
			t.Fatalf("predecessor retry replay=%v error=%v", replay, err)
		}

		nextInvocation := resetInvocationFixture(
			next.Manifest,
			now.Add(7*time.Minute),
		)
		nextInvocation.InvocationID = "invocation-four-successor-race"
		nextInvocation.InvocationDigest, _ = nextInvocation.CalculatedDigest()
		if _, _, err := store.AcceptInvocation(
			context.Background(),
			nextInvocation,
			&next,
			now.Add(7*time.Minute),
		); ResetCodeOf(err) != ResetCodeManifestConflict {
			t.Fatalf("AcceptInvocation() error = %v", err)
		}
		previous, _, err := store.LoadJournal(
			context.Background(),
			first.Manifest.ResetID,
		)
		if err != nil || previous.CurrentState != ResetStateStationDeployed {
			t.Fatalf("predecessor state=%s error=%v", previous.CurrentState, err)
		}
		if _, found, err := store.LoadJournal(
			context.Background(),
			next.Manifest.ResetID,
		); err != nil || found {
			t.Fatalf("successor journal found=%v error=%v", found, err)
		}
	})

	t.Run("prepared source replacement inherits recovery ancestry", func(t *testing.T) {
		store, first, now := failedPostDeployResetFixture(
			t,
			ResetCodeSchemaTargetUnreviewed,
		)
		nextIdentity := resetScopeFixture()
		nextIdentity.ResetID = "reset-four-recovery-prepared"
		nextIdentity.SourceCommit = stringsRepeat("c", 40)
		nextIdentity.CreatedAt = now.Add(5 * time.Minute)
		next := prepareResetFixture(t, store, nextIdentity)
		nextInvocation := resetInvocationFixture(
			next.Manifest,
			now.Add(5*time.Minute),
		)
		nextInvocation.InvocationID = "invocation-four-recovery-prepared"
		nextInvocation.InvocationDigest, _ = nextInvocation.CalculatedDigest()
		if _, _, err := store.AcceptInvocation(
			context.Background(),
			nextInvocation,
			&next,
			now.Add(5*time.Minute),
		); err != nil {
			t.Fatal(err)
		}

		latestIdentity := resetScopeFixture()
		latestIdentity.ResetID = "reset-four-recovery-latest"
		latestIdentity.SourceCommit = stringsRepeat("d", 40)
		latestIdentity.CreatedAt = now.Add(6 * time.Minute)
		latest := prepareResetFixture(t, store, latestIdentity)
		if latest.Manifest.RecoveryPredecessor == nil ||
			latest.Manifest.RecoveryPredecessor.ResetID != first.Manifest.ResetID {
			t.Fatalf(
				"inherited recovery predecessor = %#v",
				latest.Manifest.RecoveryPredecessor,
			)
		}
		latestInvocation := resetInvocationFixture(
			latest.Manifest,
			now.Add(6*time.Minute),
		)
		latestInvocation.InvocationID = "invocation-four-recovery-latest"
		latestInvocation.InvocationDigest, _ = latestInvocation.CalculatedDigest()
		if _, replay, err := store.AcceptInvocation(
			context.Background(),
			latestInvocation,
			&latest,
			now.Add(6*time.Minute),
		); err != nil || replay {
			t.Fatalf("latest recovery admission replay=%v error=%v", replay, err)
		}
		superseded, _, err := store.LoadJournal(
			context.Background(),
			next.Manifest.ResetID,
		)
		if err != nil || superseded.CurrentState != ResetStateSuperseded {
			t.Fatalf("prepared successor state=%s error=%v", superseded.CurrentState, err)
		}
	})
}

func TestCanonicalPrivatePostSchemaRejectsDefinitionDrift(t *testing.T) {
	tests := []struct {
		name        string
		mutateTable func(string) string
		mutateIndex func(string) string
	}{
		{
			name: "column type",
			mutateTable: func(ddl string) string {
				return strings.Replace(
					ddl,
					"`content_id` text NOT NULL",
					"`content_id` integer NOT NULL",
					1,
				)
			},
		},
		{
			name: "column nullability",
			mutateTable: func(ddl string) string {
				return strings.Replace(
					ddl,
					"`author_ptid` text NOT NULL",
					"`author_ptid` text",
					1,
				)
			},
		},
		{
			name: "column default",
			mutateTable: func(ddl string) string {
				return strings.Replace(
					ddl,
					"`comments_count` integer NOT NULL DEFAULT 0",
					"`comments_count` integer NOT NULL DEFAULT 1",
					1,
				)
			},
		},
		{
			name: "primary key",
			mutateTable: func(ddl string) string {
				return strings.Replace(
					ddl,
					",PRIMARY KEY (`post_id`)",
					"",
					1,
				)
			},
		},
		{
			name: "index uniqueness",
			mutateIndex: func(ddl string) string {
				if strings.Contains(
					ddl,
					"`uidx_social_private_post_content`",
				) {
					return strings.Replace(ddl, "CREATE UNIQUE INDEX", "CREATE INDEX", 1)
				}

				return ddl
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			database, _ := openSecureContentResetStore(t)
			if err := validateCanonicalPrivatePostSchema(database); err != nil {
				t.Fatalf("canonical fixture: %v", err)
			}
			rewritePrivatePostSchema(
				t,
				database,
				test.mutateTable,
				test.mutateIndex,
			)
			err := validateCanonicalPrivatePostSchema(database)
			if ResetCodeOf(err) != ResetCodeSchemaTargetUnreviewed {
				t.Fatalf("schema validation error = %v", err)
			}
		})
	}
}

func TestGORMSecureContentResetStoreResumesCompletionAfterPostAuditCrashFailpoint(
	t *testing.T,
) {
	database, store := openSecureContentResetStore(t)
	now := time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC)
	prepared, err := store.PrepareManifest(
		context.Background(),
		resetScopeFixture(),
		resetObjectOwnerFixture{},
		resetObjectOwnerFixture{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveAuditedManifest(context.Background(), prepared); err != nil {
		t.Fatal(err)
	}
	invocation := resetInvocationFixture(prepared.Manifest, now)
	if _, _, err := store.AcceptInvocation(
		context.Background(),
		invocation,
		&prepared,
		now,
	); err != nil {
		t.Fatal(err)
	}
	if err := store.CommitDatabase(
		context.Background(),
		prepared.Manifest.ResetID,
		now.Add(time.Minute),
	); err != nil {
		t.Fatal(err)
	}
	if err := store.AdvanceJournal(
		context.Background(),
		prepared.Manifest.ResetID,
		ResetStateDatabaseSchemaCommitted,
		ResetStateObjectsDeleted,
		now.Add(2*time.Minute),
	); err != nil {
		t.Fatal(err)
	}
	if err := store.AdvanceJournal(
		context.Background(),
		prepared.Manifest.ResetID,
		ResetStateObjectsDeleted,
		ResetStateStationDeployed,
		now.Add(3*time.Minute),
	); err != nil {
		t.Fatal(err)
	}
	schemaDigest, err := store.PostAudit(
		context.Background(),
		prepared.Manifest,
		resetObjectOwnerFixture{},
		resetObjectOwnerFixture{},
	)
	if err != nil {
		t.Fatal(err)
	}
	deployment := ResetDeploymentProof{
		SourceCommit:             prepared.Manifest.SourceCommit,
		StationServiceID:         "station-service",
		StationPeerID:            "station-peer",
		StationRuntimeIdentity:   "station-runtime",
		ServiceAttestationDigest: stringsRepeat("c", 64),
		CapturedAt:               now.Add(3*time.Minute + 30*time.Second),
	}
	staleDeployment := deployment
	staleDeployment.CapturedAt = now.Add(2 * time.Minute)
	if err := store.RecordPostAuditPassed(
		context.Background(),
		prepared.Manifest,
		staleDeployment,
		schemaDigest,
		now.Add(4*time.Minute),
	); ResetCodeOf(err) != ResetCodePartialFailure {
		t.Fatalf("stale deployment proof error = %v", err)
	}
	if err := store.RecordPostAuditPassed(
		context.Background(),
		prepared.Manifest,
		deployment,
		schemaDigest,
		now.Add(4*time.Minute),
	); err != nil {
		t.Fatal(err)
	}

	// Failpoint: the process terminates after POST_AUDIT_PASSED commits but
	// before Complete runs. A fresh store must finish from durable evidence.
	restarted, err := NewGORMSecureContentResetStore(database)
	if err != nil {
		t.Fatal(err)
	}
	attestation, journal, err := restarted.Complete(
		context.Background(),
		prepared.Manifest,
		now.Add(5*time.Minute),
	)
	if err != nil {
		t.Fatal(err)
	}
	if journal.CurrentState != ResetStateComplete {
		t.Fatalf("journal state = %s, want COMPLETE", journal.CurrentState)
	}
	if attestation.StationRuntimeIdentity != deployment.StationRuntimeIdentity ||
		attestation.CanonicalSchemaDigest != schemaDigest {
		t.Fatalf("attestation did not use durable post-audit evidence: %#v", attestation)
	}
	replayed, err := restarted.CompletedAttestation(
		context.Background(),
		prepared.Manifest.ResetID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if replayed != attestation {
		t.Fatalf("completed attestation replay changed: %#v", replayed)
	}
}

func TestGORMSecureContentResetStoreValidatePostAuditEvidenceRejectsMismatch(
	t *testing.T,
) {
	_, store, manifest, deployment, schemaDigest, _ :=
		postAuditPassedResetFixture(t)
	if err := store.ValidatePostAuditEvidence(
		context.Background(),
		manifest,
		deployment,
		schemaDigest,
	); err != nil {
		t.Fatalf("matching post-audit evidence: %v", err)
	}

	mismatchedDeployment := deployment
	mismatchedDeployment.StationRuntimeIdentity = "drifted-runtime"
	if err := store.ValidatePostAuditEvidence(
		context.Background(),
		manifest,
		mismatchedDeployment,
		schemaDigest,
	); ResetCodeOf(err) != ResetCodeJournalStateConflict {
		t.Fatalf("mismatched deployment evidence error = %v", err)
	}
	if err := store.ValidatePostAuditEvidence(
		context.Background(),
		manifest,
		deployment,
		stringsRepeat("d", 64),
	); ResetCodeOf(err) != ResetCodeJournalStateConflict {
		t.Fatalf("mismatched schema evidence error = %v", err)
	}
}

func TestGORMSecureContentResetStoreResolveCompletedAttestation(t *testing.T) {
	database, store, manifest, _, _, now := postAuditPassedResetFixture(t)
	attestation, completed, err := store.Complete(
		context.Background(),
		manifest,
		now.Add(5*time.Minute),
	)
	if err != nil {
		t.Fatal(err)
	}

	resolvedManifest, resolvedJournal, persisted, err :=
		store.ResolveCompletedAttestation(context.Background(), attestation)
	if err != nil {
		t.Fatal(err)
	}
	if resolvedManifest.ManifestDigest != manifest.ManifestDigest ||
		resolvedJournal.CurrentState != ResetStateComplete ||
		persisted != attestation {
		t.Fatalf(
			"resolved artifacts manifest=%s journal=%s attestation=%#v",
			resolvedManifest.ManifestDigest,
			resolvedJournal.CurrentState,
			persisted,
		)
	}
	resolvedJournalDigest, err := resolvedJournal.CalculatedDigest()
	if err != nil {
		t.Fatal(err)
	}
	if !equalDigest(
		resolvedJournalDigest,
		attestation.CompletedJournalDigest,
	) {
		t.Fatalf(
			"resolved journal digest = %s, want %s",
			resolvedJournalDigest,
			attestation.CompletedJournalDigest,
		)
	}
	if completed.CurrentState != resolvedJournal.CurrentState {
		t.Fatalf(
			"resolved journal state = %s, want %s",
			resolvedJournal.CurrentState,
			completed.CurrentState,
		)
	}

	tampered := attestation
	tampered.StationRuntimeIdentity = "drifted-runtime"
	if _, _, _, err := store.ResolveCompletedAttestation(
		context.Background(),
		tampered,
	); ResetCodeOf(err) != ResetCodeJournalStateConflict {
		t.Fatalf("tampered supplied attestation error = %v", err)
	}

	if err := database.Model(&secureContentResetJournalModel{}).
		Where("reset_id = ?", manifest.ResetID).
		Update("current_state", string(ResetStatePostAuditPassed)).Error; err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := store.ResolveCompletedAttestation(
		context.Background(),
		attestation,
	); ResetCodeOf(err) != ResetCodeJournalStateConflict {
		t.Fatalf("incomplete journal error = %v", err)
	}
	if err := database.Model(&secureContentResetJournalModel{}).
		Where("reset_id = ?", manifest.ResetID).
		Update("current_state", string(ResetStateComplete)).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Model(&secureContentResetJournalModel{}).
		Where("reset_id = ?", manifest.ResetID).
		Update("post_audit_schema_digest", stringsRepeat("e", 64)).Error; err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := store.ResolveCompletedAttestation(
		context.Background(),
		attestation,
	); ResetCodeOf(err) != ResetCodeJournalStateConflict {
		t.Fatalf("persisted post-audit evidence mismatch error = %v", err)
	}
	if err := database.Model(&secureContentResetJournalModel{}).
		Where("reset_id = ?", manifest.ResetID).
		Update(
			"post_audit_schema_digest",
			attestation.CanonicalSchemaDigest,
		).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Model(&secureContentResetTransitionModel{}).
		Where(
			"reset_id = ? AND to_state = ?",
			manifest.ResetID,
			string(ResetStateComplete),
		).
		Update("transition_at", now.Add(6*time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := store.ResolveCompletedAttestation(
		context.Background(),
		attestation,
	); ResetCodeOf(err) != ResetCodeJournalStateConflict {
		t.Fatalf("journal digest mismatch error = %v", err)
	}
}

func TestGORMSecureContentResetStoreCommitDatabase(t *testing.T) {
	database, store := openSecureContentResetStore(t)
	rewritePrivatePostSchema(
		t,
		database,
		func(ddl string) string {
			ddl = strings.Replace(
				ddl,
				"`comments_count` integer NOT NULL DEFAULT 0",
				"`comments_count` integer DEFAULT 0",
				1,
			)
			return strings.Replace(
				ddl,
				"`reactions_count` integer NOT NULL DEFAULT 0",
				"`reactions_count` integer DEFAULT 0",
				1,
			)
		},
		nil,
	)
	addRetiredPrivatePostColumns(t, database)
	if err := database.Exec(`
CREATE TABLE social_private_audience_grants (
	id INTEGER PRIMARY KEY,
	post_id TEXT NOT NULL
)`).Error; err != nil {
		t.Fatal(err)
	}

	now := time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC)
	publicPost := dbmodel.SocialPublicPost{
		ID:           101,
		AuthorID:     1,
		Type:         "TEXT",
		AudienceKind: "PUBLIC",
		TextBody:     "public-preserved",
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := database.Create(&publicPost).Error; err != nil {
		t.Fatal(err)
	}
	privatePost := dbmodel.SocialPrivateContentPost{
		PostID:                    "post-private",
		ContentID:                 "content-private",
		AuthorPTID:                "ptid:alice",
		Generation:                1,
		AudienceSnapshotID:        "snapshot-private",
		Kind:                      "TEXT",
		EncryptedPayloadBytes:     []byte("ciphertext"),
		EncryptedPayloadSHA256:    make([]byte, 32),
		ObjectDescriptorSetSHA256: make([]byte, 32),
		LifecycleState:            "ACTIVE",
		CreatedAt:                 now,
		UpdatedAt:                 now,
	}
	if err := database.Create(&privatePost).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Exec(
		`INSERT INTO social_comments
			(id, post_id, post_class, author_id, text_body, created_at, updated_at)
		 VALUES
			(201, 101, 'public', 1, 'public-comment', ?, ?),
			(202, 202, 'private', 1, 'private-comment', ?, ?)`,
		now,
		now,
		now,
		now,
	).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Exec(
		`INSERT INTO social_reactions
			(post_id, actor_id, kind, post_class, created_at)
		 VALUES
			(101, 1, 'LIKE', 'public', ?),
			(202, 1, 'LIKE', 'private', ?)`,
		now,
		now,
	).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&dbmodel.SocialMomentDelivery{
		ID:           301,
		ViewerID:     2,
		PostID:       202,
		AuthorID:     1,
		AudienceKind: "FRIENDS",
		DeliveredAt:  now,
	}).Error; err != nil {
		t.Fatal(err)
	}

	prepared, err := store.PrepareManifest(
		context.Background(),
		resetScopeFixture(),
		resetObjectOwnerFixture{},
		resetObjectOwnerFixture{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveAuditedManifest(context.Background(), prepared); err != nil {
		t.Fatal(err)
	}
	invocation := resetInvocationFixture(prepared.Manifest, now)
	if _, replay, err := store.AcceptInvocation(
		context.Background(),
		invocation,
		&prepared,
		now,
	); err != nil || replay {
		t.Fatalf("AcceptInvocation() replay=%v error=%v", replay, err)
	}
	if err := store.CommitDatabase(
		context.Background(),
		prepared.Manifest.ResetID,
		now.Add(time.Minute),
	); err != nil {
		t.Fatal(err)
	}

	journal, found, err := store.LoadJournal(
		context.Background(),
		prepared.Manifest.ResetID,
	)
	if err != nil || !found {
		t.Fatalf("LoadJournal() found=%v error=%v", found, err)
	}
	if journal.CurrentState != ResetStateDatabaseSchemaCommitted {
		t.Fatalf("journal state = %s", journal.CurrentState)
	}
	if database.Migrator().HasTable("social_private_audience_grants") {
		t.Fatal("retired audience-grants table remains")
	}
	for _, column := range RetiredPrivatePostColumns() {
		if database.Migrator().HasColumn("social_private_posts", column) {
			t.Fatalf("retired private Post column %q remains", column)
		}
	}
	if err := validateCanonicalPrivatePostSchema(database); err != nil {
		t.Fatal(err)
	}
	assertResetRowCount(t, database, "social_private_posts", "", 0)
	assertResetRowCount(t, database, "social_comments", "post_class = 'private'", 0)
	assertResetRowCount(t, database, "social_reactions", "post_class = 'private'", 0)
	assertResetRowCount(t, database, "social_moment_deliveries", "", 0)
	assertResetRowCount(t, database, "social_public_posts", "", 1)
	assertResetRowCount(t, database, "social_comments", "post_class = 'public'", 1)
	assertResetRowCount(t, database, "social_reactions", "post_class = 'public'", 1)

	after, _, err := tableRowsDigest(database, "social_public_posts", "")
	if err != nil {
		t.Fatal(err)
	}
	if after != prepared.Manifest.PublicSnapshotBefore.PublicPostRowsDigest {
		t.Fatal("public Post snapshot changed")
	}
}

func TestGORMSecureContentResetStoreRejectsTargetDriftBeforeMutation(
	t *testing.T,
) {
	database, store := openSecureContentResetStore(t)
	now := time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC)
	prepared, err := store.PrepareManifest(
		context.Background(),
		resetScopeFixture(),
		resetObjectOwnerFixture{},
		resetObjectOwnerFixture{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveAuditedManifest(
		context.Background(),
		prepared,
	); err != nil {
		t.Fatal(err)
	}
	invocation := resetInvocationFixture(prepared.Manifest, now)
	if _, replay, err := store.AcceptInvocation(
		context.Background(),
		invocation,
		&prepared,
		now,
	); err != nil || replay {
		t.Fatalf("AcceptInvocation() replay=%v error=%v", replay, err)
	}
	if err := database.Create(&dbmodel.SocialMomentDelivery{
		ID:           401,
		ViewerID:     2,
		PostID:       402,
		AuthorID:     1,
		AudienceKind: "FRIENDS",
		DeliveredAt:  now,
	}).Error; err != nil {
		t.Fatal(err)
	}

	err = store.CommitDatabase(
		context.Background(),
		prepared.Manifest.ResetID,
		now.Add(time.Minute),
	)
	if ResetCodeOf(err) != ResetCodeManifestConflict {
		t.Fatalf("CommitDatabase() error = %v", err)
	}
	assertResetRowCount(t, database, "social_moment_deliveries", "", 1)
	journal, found, err := store.LoadJournal(
		context.Background(),
		prepared.Manifest.ResetID,
	)
	if err != nil || !found {
		t.Fatalf("LoadJournal() found=%v error=%v", found, err)
	}
	if journal.CurrentState != ResetStatePrepared {
		t.Fatalf("journal state = %s, want PREPARED", journal.CurrentState)
	}
}

func TestGORMSecureContentResetStoreExistingStateDoesNotCreateControlSchema(
	t *testing.T,
) {
	database, err := gorm.Open(
		sqlite.Open(
			"file:"+t.Name()+"?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		),
		&gorm.Config{Logger: gormlogger.Default.LogMode(gormlogger.Silent)},
	)
	if err != nil {
		t.Fatal(err)
	}
	store, err := NewGORMSecureContentResetStore(database)
	if err != nil {
		t.Fatal(err)
	}
	state, found, err := store.ExistingResetState(
		context.Background(),
		"reset-four-1",
	)
	if err != nil {
		t.Fatal(err)
	}
	if found || state != "" {
		t.Fatalf("ExistingResetState() state=%q found=%v", state, found)
	}
	if database.Migrator().HasTable(&secureContentResetManifestModel{}) ||
		database.Migrator().HasTable(&secureContentResetJournalModel{}) {
		t.Fatal("read-only reset state lookup created control tables")
	}
}

func openSecureContentResetStore(
	t *testing.T,
) (*gorm.DB, *GORMSecureContentResetStore) {
	t.Helper()

	dsn := fmt.Sprintf(
		"file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		t.Name(),
	)
	database, err := gorm.Open(
		sqlite.Open(dsn),
		&gorm.Config{Logger: gormlogger.Default.LogMode(gormlogger.Silent)},
	)
	if err != nil {
		t.Fatal(err)
	}
	models := append(
		dbmodel.SocialPrivateContentModels(),
		&dbmodel.SocialPublicPost{},
		&dbmodel.SocialComment{},
		&dbmodel.SocialReaction{},
		&dbmodel.SocialMomentDelivery{},
		&dbmodel.Actor{},
		&ossmodel.FileMeta{},
	)
	if err := database.AutoMigrate(models...); err != nil {
		t.Fatal(err)
	}
	store, err := NewGORMSecureContentResetStore(database)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.MigrateControlSchema(context.Background()); err != nil {
		t.Fatal(err)
	}

	return database, store
}

func postAuditPassedResetFixture(
	t *testing.T,
) (
	*gorm.DB,
	*GORMSecureContentResetStore,
	SecureContentResetManifestV1,
	ResetDeploymentProof,
	string,
	time.Time,
) {
	t.Helper()

	database, store := openSecureContentResetStore(t)
	now := time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC)
	prepared, err := store.PrepareManifest(
		context.Background(),
		resetScopeFixture(),
		resetObjectOwnerFixture{},
		resetObjectOwnerFixture{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveAuditedManifest(context.Background(), prepared); err != nil {
		t.Fatal(err)
	}
	invocation := resetInvocationFixture(prepared.Manifest, now)
	if _, _, err := store.AcceptInvocation(
		context.Background(),
		invocation,
		&prepared,
		now,
	); err != nil {
		t.Fatal(err)
	}
	if err := store.CommitDatabase(
		context.Background(),
		prepared.Manifest.ResetID,
		now.Add(time.Minute),
	); err != nil {
		t.Fatal(err)
	}
	if err := store.AdvanceJournal(
		context.Background(),
		prepared.Manifest.ResetID,
		ResetStateDatabaseSchemaCommitted,
		ResetStateObjectsDeleted,
		now.Add(2*time.Minute),
	); err != nil {
		t.Fatal(err)
	}
	if err := store.AdvanceJournal(
		context.Background(),
		prepared.Manifest.ResetID,
		ResetStateObjectsDeleted,
		ResetStateStationDeployed,
		now.Add(3*time.Minute),
	); err != nil {
		t.Fatal(err)
	}
	schemaDigest, err := store.PostAudit(
		context.Background(),
		prepared.Manifest,
		resetObjectOwnerFixture{},
		resetObjectOwnerFixture{},
	)
	if err != nil {
		t.Fatal(err)
	}
	deployment := ResetDeploymentProof{
		SourceCommit:             prepared.Manifest.SourceCommit,
		StationServiceID:         "station-service",
		StationPeerID:            "station-peer",
		StationRuntimeIdentity:   "station-runtime",
		ServiceAttestationDigest: stringsRepeat("c", 64),
		CapturedAt:               now.Add(3*time.Minute + 30*time.Second),
	}
	if err := store.RecordPostAuditPassed(
		context.Background(),
		prepared.Manifest,
		deployment,
		schemaDigest,
		now.Add(4*time.Minute),
	); err != nil {
		t.Fatal(err)
	}

	return database, store, prepared.Manifest, deployment, schemaDigest, now
}

func addRetiredPrivatePostColumns(t *testing.T, database *gorm.DB) {
	t.Helper()

	for _, column := range RetiredPrivatePostColumns() {
		if database.Migrator().HasColumn("social_private_posts", column) {
			continue
		}
		definition := "TEXT"
		switch column {
		case "id", "author_id", "views_count":
			definition = "INTEGER"
		case "edited_at":
			definition = "DATETIME"
		}
		if err := database.Exec(
			"ALTER TABLE social_private_posts ADD COLUMN " +
				quoteIdentifier(column) + " " + definition,
		).Error; err != nil {
			t.Fatalf("add retired column %s: %v", column, err)
		}
	}
}

func canonicalPrivatePostFixture(
	postID string,
	authorPTID string,
	now time.Time,
) dbmodel.SocialPrivateContentPost {
	return dbmodel.SocialPrivateContentPost{
		PostID:                    postID,
		ContentID:                 "content-" + postID,
		AuthorPTID:                authorPTID,
		Generation:                1,
		AudienceSnapshotID:        "snapshot-" + postID,
		Kind:                      "IMAGE",
		EncryptedPayloadBytes:     []byte("ciphertext"),
		EncryptedPayloadSHA256:    make([]byte, 32),
		ObjectDescriptorSetSHA256: make([]byte, 32),
		LifecycleState:            "ACTIVE",
		CreatedAt:                 now,
		UpdatedAt:                 now,
	}
}

func rewritePrivatePostSchema(
	t *testing.T,
	database *gorm.DB,
	mutateTable func(string) string,
	mutateIndex func(string) string,
) {
	t.Helper()

	var tableDDL string
	if err := database.Raw(
		"SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
		"social_private_posts",
	).Scan(&tableDDL).Error; err != nil {
		t.Fatal(err)
	}
	var indexes []struct {
		Name string `gorm:"column:name"`
		SQL  string `gorm:"column:sql"`
	}
	if err := database.Raw(
		"SELECT name, sql FROM sqlite_master "+
			"WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL "+
			"ORDER BY name",
		"social_private_posts",
	).Scan(&indexes).Error; err != nil {
		t.Fatal(err)
	}
	if mutateTable != nil {
		tableDDL = mutateTable(tableDDL)
	}
	if err := database.Migrator().DropTable(
		&dbmodel.SocialPrivateContentPost{},
	); err != nil {
		t.Fatal(err)
	}
	if err := database.Exec(tableDDL).Error; err != nil {
		t.Fatal(err)
	}
	for _, index := range indexes {
		indexDDL := index.SQL
		if mutateIndex != nil {
			indexDDL = mutateIndex(indexDDL)
		}
		if err := database.Exec(indexDDL).Error; err != nil {
			t.Fatalf("recreate index %s: %v", index.Name, err)
		}
	}
}

func resetScopeFixture() ResetScopeIdentity {
	return ResetScopeIdentity{
		SchemaVersion:         SecureContentResetSchemaVersion,
		ResetID:               "reset-four-1",
		ResetIntent:           ResetIntentSchemaActivation,
		SourceCommit:          stringsRepeat("a", 40),
		WorkspaceID:           "workspace-1",
		ProfileID:             "four",
		DeploymentEnvironment: "station-four",
		DestructiveScope:      "station-four-social-private",
		CreatedAt:             time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC),
	}
}

func prepareResetFixture(
	t *testing.T,
	store *GORMSecureContentResetStore,
	identity ResetScopeIdentity,
) PreparedSecureContentReset {
	t.Helper()
	prepared, err := store.PrepareManifest(
		context.Background(),
		identity,
		resetObjectOwnerFixture{},
		resetObjectOwnerFixture{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveAuditedManifest(
		context.Background(),
		prepared,
	); err != nil {
		t.Fatal(err)
	}

	return prepared
}

func failedPostDeployResetFixture(
	t *testing.T,
	code ResetCode,
) (*GORMSecureContentResetStore, PreparedSecureContentReset, time.Time) {
	t.Helper()
	_, store := openSecureContentResetStore(t)
	now := time.Date(2026, 9, 20, 3, 0, 0, 0, time.UTC)
	prepared := prepareResetFixture(t, store, resetScopeFixture())
	if _, _, err := store.AcceptInvocation(
		context.Background(),
		resetInvocationFixture(prepared.Manifest, now),
		&prepared,
		now,
	); err != nil {
		t.Fatal(err)
	}
	if err := store.CommitDatabase(
		context.Background(),
		prepared.Manifest.ResetID,
		now.Add(time.Minute),
	); err != nil {
		t.Fatal(err)
	}
	if err := store.AdvanceJournal(
		context.Background(),
		prepared.Manifest.ResetID,
		ResetStateDatabaseSchemaCommitted,
		ResetStateObjectsDeleted,
		now.Add(2*time.Minute),
	); err != nil {
		t.Fatal(err)
	}
	if err := store.AdvanceJournal(
		context.Background(),
		prepared.Manifest.ResetID,
		ResetStateObjectsDeleted,
		ResetStateStationDeployed,
		now.Add(3*time.Minute),
	); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordFailure(
		context.Background(),
		prepared.Manifest.ResetID,
		code,
		now.Add(4*time.Minute),
	); err != nil {
		t.Fatal(err)
	}

	return store, prepared, now
}

func resetInvocationFixture(
	manifest SecureContentResetManifestV1,
	now time.Time,
) SecureContentResetInvocationV1 {
	invocation := SecureContentResetInvocationV1{
		SchemaVersion:         SecureContentResetSchemaVersion,
		InvocationID:          "invocation-four-1",
		ResetID:               manifest.ResetID,
		ResetIntent:           manifest.ResetIntent,
		ResetManifestDigest:   manifest.ManifestDigest,
		PlanID:                SecureContentResetPlanID,
		TaskID:                "W12A",
		DeclarationDigest:     stringsRepeat("b", 64),
		SourceCommit:          manifest.SourceCommit,
		WorkspaceID:           manifest.WorkspaceID,
		ProfileID:             manifest.ProfileID,
		DeploymentEnvironment: manifest.DeploymentEnvironment,
		DestructiveScope:      manifest.DestructiveScope,
		IssuedAt:              now,
		ExpiresAt:             now.Add(30 * time.Minute),
	}
	invocation.InvocationDigest, _ = invocation.CalculatedDigest()

	return invocation
}

func assertResetRowCount(
	t *testing.T,
	database *gorm.DB,
	table string,
	predicate string,
	expected int64,
) {
	t.Helper()

	_, count, err := tableRowsDigest(database, table, predicate)
	if err != nil {
		t.Fatal(err)
	}
	if count != expected {
		t.Fatalf("%s row count = %d, want %d", table, count, expected)
	}
}

func stringsRepeat(value string, count int) string {
	result := ""
	for range count {
		result += value
	}

	return result
}
