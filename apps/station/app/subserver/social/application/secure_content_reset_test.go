package application

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type emptyResetObjectOwner struct{}

func (emptyResetObjectOwner) InspectResetObject(
	context.Context,
	infrastructure.ResolvedResetObjectTarget,
) (infrastructure.ResetObjectInspection, error) {
	return infrastructure.ResetObjectInspection{}, fmt.Errorf(
		"unexpected object inspection",
	)
}

func (emptyResetObjectOwner) DeleteResetObject(
	context.Context,
	infrastructure.ResolvedResetObjectTarget,
) error {
	return fmt.Errorf("unexpected object deletion")
}

func (emptyResetObjectOwner) VerifyResetObjectDeleted(
	context.Context,
	infrastructure.ResolvedResetObjectTarget,
) error {
	return fmt.Errorf("unexpected object verification")
}

type resetDeploymentVerifier struct {
	proof infrastructure.ResetDeploymentProof
	err   error
}

func (v resetDeploymentVerifier) VerifyResetDeployment(
	context.Context,
	infrastructure.SecureContentResetManifestV1,
) (infrastructure.ResetDeploymentProof, error) {
	if v.err != nil {
		return infrastructure.ResetDeploymentProof{}, v.err
	}
	return v.proof, nil
}

func TestSecureContentResetOwnerReplaysCompletedAttestation(t *testing.T) {
	now := time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC)
	database, err := gorm.Open(
		sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared&_pragma=foreign_keys(1)"),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)},
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
	store, err := infrastructure.NewGORMSecureContentResetStore(database)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.MigrateControlSchema(context.Background()); err != nil {
		t.Fatal(err)
	}
	sourceCommit := strings.Repeat("a", 40)
	declarationDigest := strings.Repeat("b", 64)
	binding := infrastructure.ResetInvocationBinding{
		SourceCommit:          sourceCommit,
		WorkspaceID:           "workspace-1",
		ProfileID:             "four",
		DeploymentEnvironment: "station-four",
		DestructiveScope:      "station-four-social-private",
		DeclarationDigest:     declarationDigest,
	}
	deployment := infrastructure.ResetDeploymentProof{
		SourceCommit:             sourceCommit,
		StationServiceID:         "station-four",
		StationPeerID:            "peer-four",
		StationRuntimeIdentity:   "runtime-four",
		ServiceAttestationDigest: strings.Repeat("c", 64),
		CapturedAt:               now.Add(time.Minute),
	}
	owner, err := NewSecureContentResetOwner(
		store,
		emptyResetObjectOwner{},
		emptyResetObjectOwner{},
		resetDeploymentVerifier{proof: deployment},
	)
	if err != nil {
		t.Fatal(err)
	}
	owner.clock = func() time.Time { return now }

	request := infrastructure.SecureContentResetAuditRequestV1{
		SchemaVersion:         infrastructure.SecureContentResetSchemaVersion,
		RequestID:             "audit-four",
		ResetID:               "reset-four",
		ResetIntent:           infrastructure.ResetIntentSchemaActivation,
		PlanID:                infrastructure.SecureContentResetPlanID,
		TaskID:                "W12A",
		DeclarationDigest:     declarationDigest,
		SourceCommit:          sourceCommit,
		WorkspaceID:           binding.WorkspaceID,
		ProfileID:             binding.ProfileID,
		DeploymentEnvironment: binding.DeploymentEnvironment,
		DestructiveScope:      binding.DestructiveScope,
		IssuedAt:              now.Add(-time.Minute),
		ExpiresAt:             now.Add(10 * time.Minute),
	}
	request.RequestDigest, err = request.CalculatedDigest()
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := owner.Audit(context.Background(), request, binding)
	if err != nil {
		t.Fatal(err)
	}
	if repeated, err := owner.Audit(
		context.Background(),
		request,
		binding,
	); err != nil || repeated.ManifestDigest != manifest.ManifestDigest {
		t.Fatalf("Audit() replay changed manifest: result=%#v error=%v", repeated, err)
	}

	first := resetInvocation(t, manifest, declarationDigest, "invoke-one", now)
	firstResult, err := owner.Execute(context.Background(), first, binding)
	if err != nil {
		t.Fatal(err)
	}
	if firstResult.State != infrastructure.ResetStateObjectsDeleted ||
		!firstResult.NeedsDeployment {
		t.Fatalf("first result = %#v", firstResult)
	}

	owner.deployment = resetDeploymentVerifier{
		err: errors.New("deployment has not started"),
	}
	owner.clock = func() time.Time { return now.Add(time.Minute) }
	second := resetInvocation(
		t,
		manifest,
		declarationDigest,
		"invoke-two",
		now.Add(time.Minute),
	)
	if _, err := owner.Execute(
		context.Background(),
		second,
		binding,
	); err == nil || !strings.Contains(
		err.Error(),
		"deployment has not started",
	) {
		t.Fatalf("pre-deployment resume error = %v", err)
	}

	owner.deployment = resetDeploymentVerifier{proof: deployment}
	owner.clock = func() time.Time { return now.Add(2 * time.Minute) }
	third := resetInvocation(
		t,
		manifest,
		declarationDigest,
		"invoke-three",
		now.Add(2*time.Minute),
	)
	completed, err := owner.Execute(context.Background(), third, binding)
	if err != nil {
		t.Fatal(err)
	}
	if completed.State != infrastructure.ResetStateComplete ||
		completed.Attestation == nil {
		t.Fatalf("completed result = %#v", completed)
	}

	fourth := resetInvocation(
		t,
		manifest,
		declarationDigest,
		"invoke-four",
		now.Add(3*time.Minute),
	)
	replayed, err := owner.Execute(context.Background(), fourth, binding)
	if err != nil {
		t.Fatal(err)
	}
	if replayed.State != infrastructure.ResetStateComplete ||
		replayed.Attestation == nil ||
		replayed.Attestation.AttestationDigest !=
			completed.Attestation.AttestationDigest {
		t.Fatalf("completed replay = %#v", replayed)
	}
	if replayed.JournalDigest != completed.JournalDigest ||
		len(replayed.Journal.AcceptedInvocations) !=
			len(completed.Journal.AcceptedInvocations) {
		t.Fatalf("completed replay mutated the journal: %#v", replayed)
	}
	if !replayed.ExactReplay {
		t.Fatalf("completed replay was not marked exact: %#v", replayed)
	}
	if err := database.Create(&dbmodel.SocialMomentDelivery{
		ID:           401,
		ViewerID:     2,
		PostID:       402,
		AuthorID:     1,
		AudienceKind: "FRIENDS",
		DeliveredAt:  now.Add(4 * time.Minute),
	}).Error; err != nil {
		t.Fatal(err)
	}
	verified, err := owner.VerifyCanonicalSchema(
		context.Background(),
		*completed.Attestation,
		binding,
	)
	if err != nil {
		t.Fatal(err)
	}
	if verified.AttestationDigest != completed.Attestation.AttestationDigest {
		t.Fatalf("live verification changed the attestation: %#v", verified)
	}
	owner.clock = func() time.Time { return now.Add(4 * time.Minute) }
	conflicting := resetInvocation(
		t,
		manifest,
		declarationDigest,
		"invoke-one",
		now.Add(4*time.Minute),
	)
	if _, err := owner.Execute(
		context.Background(),
		conflicting,
		binding,
	); infrastructure.ResetCodeOf(err) !=
		infrastructure.ResetCodeInvocationConflict {
		t.Fatalf("terminal invocation conflict error = %v", err)
	}
	sealedJournal, found, err := store.LoadJournal(
		context.Background(),
		manifest.ResetID,
	)
	if err != nil || !found {
		t.Fatalf("load sealed journal found=%v error=%v", found, err)
	}
	sealedDigest, err := sealedJournal.CalculatedDigest()
	if err != nil {
		t.Fatal(err)
	}
	if sealedDigest != completed.JournalDigest || sealedJournal.Failure != nil {
		t.Fatalf("terminal conflict mutated sealed journal: %#v", sealedJournal)
	}
	if err := database.Exec(
		"ALTER TABLE social_private_posts ADD COLUMN runtime_drift TEXT",
	).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := owner.VerifyCanonicalSchema(
		context.Background(),
		*completed.Attestation,
		binding,
	); infrastructure.ResetCodeOf(err) !=
		infrastructure.ResetCodeSchemaTargetUnreviewed {
		t.Fatalf("live schema drift error = %v", err)
	}
}

func TestSecureContentResetOwnerReauditsPostAuditResume(t *testing.T) {
	now := time.Date(2026, 9, 19, 8, 0, 0, 0, time.UTC)
	database, err := gorm.Open(
		sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared&_pragma=foreign_keys(1)"),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)},
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
	store, err := infrastructure.NewGORMSecureContentResetStore(database)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.MigrateControlSchema(context.Background()); err != nil {
		t.Fatal(err)
	}
	sourceCommit := strings.Repeat("a", 40)
	declarationDigest := strings.Repeat("b", 64)
	binding := infrastructure.ResetInvocationBinding{
		SourceCommit:          sourceCommit,
		WorkspaceID:           "workspace-1",
		ProfileID:             "four",
		DeploymentEnvironment: "station-four",
		DestructiveScope:      "station-four-social-private",
		DeclarationDigest:     declarationDigest,
	}
	deployment := infrastructure.ResetDeploymentProof{
		SourceCommit:             sourceCommit,
		StationServiceID:         "station-four",
		StationPeerID:            "peer-four",
		StationRuntimeIdentity:   "runtime-four",
		ServiceAttestationDigest: strings.Repeat("c", 64),
		CapturedAt:               now.Add(2 * time.Minute),
	}
	owner, err := NewSecureContentResetOwner(
		store,
		emptyResetObjectOwner{},
		emptyResetObjectOwner{},
		resetDeploymentVerifier{proof: deployment},
	)
	if err != nil {
		t.Fatal(err)
	}
	owner.clock = func() time.Time { return now }
	request := infrastructure.SecureContentResetAuditRequestV1{
		SchemaVersion:         infrastructure.SecureContentResetSchemaVersion,
		RequestID:             "audit-four",
		ResetID:               "reset-four",
		ResetIntent:           infrastructure.ResetIntentSchemaActivation,
		PlanID:                infrastructure.SecureContentResetPlanID,
		TaskID:                "W12A",
		DeclarationDigest:     declarationDigest,
		SourceCommit:          sourceCommit,
		WorkspaceID:           binding.WorkspaceID,
		ProfileID:             binding.ProfileID,
		DeploymentEnvironment: binding.DeploymentEnvironment,
		DestructiveScope:      binding.DestructiveScope,
		IssuedAt:              now.Add(-time.Minute),
		ExpiresAt:             now.Add(10 * time.Minute),
	}
	request.RequestDigest, err = request.CalculatedDigest()
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := owner.Audit(context.Background(), request, binding)
	if err != nil {
		t.Fatal(err)
	}
	first := resetInvocation(t, manifest, declarationDigest, "invoke-one", now)
	firstResult, err := owner.Execute(context.Background(), first, binding)
	if err != nil {
		t.Fatal(err)
	}
	if firstResult.State != infrastructure.ResetStateObjectsDeleted {
		t.Fatalf("first result = %#v", firstResult)
	}
	if err := store.AdvanceJournal(
		context.Background(),
		manifest.ResetID,
		infrastructure.ResetStateObjectsDeleted,
		infrastructure.ResetStateStationDeployed,
		now.Add(time.Minute),
	); err != nil {
		t.Fatal(err)
	}
	schemaDigest, err := store.PostAudit(
		context.Background(),
		manifest,
		emptyResetObjectOwner{},
		emptyResetObjectOwner{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RecordPostAuditPassed(
		context.Background(),
		manifest,
		deployment,
		schemaDigest,
		now.Add(2*time.Minute),
	); err != nil {
		t.Fatal(err)
	}
	if err := database.Exec(
		"ALTER TABLE social_private_posts ADD COLUMN drift TEXT",
	).Error; err != nil {
		t.Fatal(err)
	}

	owner.clock = func() time.Time { return now.Add(3 * time.Minute) }
	resume := resetInvocation(
		t,
		manifest,
		declarationDigest,
		"invoke-resume",
		now.Add(3*time.Minute),
	)
	_, err = owner.Execute(context.Background(), resume, binding)
	if infrastructure.ResetCodeOf(err) !=
		infrastructure.ResetCodeSchemaTargetUnreviewed {
		t.Fatalf("resume drift error = %v", err)
	}
	journal, found, err := store.LoadJournal(context.Background(), manifest.ResetID)
	if err != nil {
		t.Fatal(err)
	}
	if !found || journal.CurrentState != infrastructure.ResetStatePostAuditPassed {
		t.Fatalf("resume advanced drifted journal: %#v", journal)
	}
	if _, err := store.CompletedAttestation(
		context.Background(),
		manifest.ResetID,
	); err == nil {
		t.Fatal("drifted resume unexpectedly sealed an attestation")
	}
}

func resetInvocation(
	t *testing.T,
	manifest infrastructure.SecureContentResetManifestV1,
	declarationDigest string,
	invocationID string,
	issuedAt time.Time,
) infrastructure.SecureContentResetInvocationV1 {
	t.Helper()
	invocation := infrastructure.SecureContentResetInvocationV1{
		SchemaVersion:         infrastructure.SecureContentResetSchemaVersion,
		InvocationID:          invocationID,
		ResetID:               manifest.ResetID,
		ResetIntent:           manifest.ResetIntent,
		ResetManifestDigest:   manifest.ManifestDigest,
		PlanID:                infrastructure.SecureContentResetPlanID,
		TaskID:                "W12A",
		DeclarationDigest:     declarationDigest,
		SourceCommit:          manifest.SourceCommit,
		WorkspaceID:           manifest.WorkspaceID,
		ProfileID:             manifest.ProfileID,
		DeploymentEnvironment: manifest.DeploymentEnvironment,
		DestructiveScope:      manifest.DestructiveScope,
		IssuedAt:              issuedAt,
		ExpiresAt:             issuedAt.Add(10 * time.Minute),
	}
	var err error
	invocation.InvocationDigest, err = invocation.CalculatedDigest()
	if err != nil {
		t.Fatal(err)
	}

	return invocation
}
