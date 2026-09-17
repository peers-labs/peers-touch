package persistence

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMigrateEvaluationAggregate(t *testing.T) {
	t.Run("migrates legacy dataset and removes retired table", func(t *testing.T) {
		db := openEvaluationTestDB(t, "evaluation-migration")
		if err := db.AutoMigrate(&legacyEcosystemEvalDataset{}); err != nil {
			t.Fatalf("create legacy schema: %v", err)
		}
		now := time.Date(2026, 9, 17, 8, 0, 0, 0, time.UTC)
		legacy := &legacyEcosystemEvalDataset{
			ID:             "legacy-dataset",
			Name:           "Legacy",
			Description:    "migrated",
			ItemsJSON:      `[{"id":"case-1","input":"question","expectedOutput":"answer","tags":["smoke"]}]`,
			OwnerActorPTID: "ptid:actor-1",
			CreatedAt:      now,
			UpdatedAt:      now,
		}
		if err := db.Create(legacy).Error; err != nil {
			t.Fatalf("seed legacy dataset: %v", err)
		}

		if err := MigrateEvaluationAggregate(db); err != nil {
			t.Fatalf("migrate evaluation aggregate: %v", err)
		}
		if db.Migrator().HasTable(&legacyEcosystemEvalDataset{}) {
			t.Fatal("legacy evaluation table still exists")
		}
		var dataset EvaluationDataset
		if err := db.First(&dataset, "dataset_id = ?", legacy.ID).Error; err != nil {
			t.Fatalf("load migrated dataset: %v", err)
		}
		if dataset.PTID != legacy.OwnerActorPTID || dataset.Revision != 1 {
			t.Fatalf("unexpected migrated dataset: %+v", dataset)
		}
		var testCase EvaluationTestCase
		if err := db.First(&testCase, "dataset_id = ?", legacy.ID).Error; err != nil {
			t.Fatalf("load migrated test case: %v", err)
		}
		if testCase.Expected != "answer" || testCase.Input != "question" {
			t.Fatalf("unexpected migrated test case: %+v", testCase)
		}
	})

	t.Run("fails closed for malformed legacy cases", func(t *testing.T) {
		db := openEvaluationTestDB(t, "evaluation-migration-invalid")
		if err := db.AutoMigrate(&legacyEcosystemEvalDataset{}); err != nil {
			t.Fatalf("create legacy schema: %v", err)
		}
		if err := db.Create(&legacyEcosystemEvalDataset{
			ID:             "legacy-invalid",
			Name:           "Invalid",
			ItemsJSON:      `{`,
			OwnerActorPTID: "ptid:actor-1",
		}).Error; err != nil {
			t.Fatalf("seed malformed legacy dataset: %v", err)
		}

		if err := MigrateEvaluationAggregate(db); err == nil {
			t.Fatal("malformed legacy dataset migration succeeded")
		}
		if !db.Migrator().HasTable(&legacyEcosystemEvalDataset{}) {
			t.Fatal("legacy table was dropped after failed migration")
		}
	})

	t.Run("derives globally unique case IDs across datasets", func(t *testing.T) {
		db := openEvaluationTestDB(t, "evaluation-migration-case-identity")
		if err := db.AutoMigrate(&legacyEcosystemEvalDataset{}); err != nil {
			t.Fatalf("create legacy schema: %v", err)
		}
		now := time.Date(2026, 9, 17, 8, 15, 0, 0, time.UTC)
		for _, datasetID := range []string{"legacy-dataset-a", "legacy-dataset-b"} {
			if err := db.Create(&legacyEcosystemEvalDataset{
				ID:             datasetID,
				Name:           datasetID,
				ItemsJSON:      `[{"id":"case-1","input":"question","expected_output":"answer"}]`,
				OwnerActorPTID: "ptid:actor-1",
				CreatedAt:      now,
				UpdatedAt:      now,
			}).Error; err != nil {
				t.Fatalf("seed legacy dataset %s: %v", datasetID, err)
			}
		}

		if err := MigrateEvaluationAggregate(db); err != nil {
			t.Fatalf("migrate evaluation aggregate: %v", err)
		}
		var cases []EvaluationTestCase
		if err := db.Order("dataset_id ASC").Find(&cases).Error; err != nil {
			t.Fatalf("load migrated cases: %v", err)
		}
		if len(cases) != 2 {
			t.Fatalf("migrated case count = %d, want 2", len(cases))
		}
		if cases[0].CaseID == cases[1].CaseID {
			t.Fatalf(
				"duplicate JSON-local case ID was reused across datasets: %q",
				cases[0].CaseID,
			)
		}
		for index := range cases {
			expectedID := evaluationMigrationID(
				"case",
				cases[index].PTID,
				cases[index].DatasetID,
				"id:case-1",
			)
			if cases[index].CaseID != expectedID {
				t.Fatalf(
					"case ID = %q, want %q",
					cases[index].CaseID,
					expectedID,
				)
			}
		}
	})
}

func TestEvaluationRepositoryEnsureAttempt(t *testing.T) {
	db := openEvaluationTestDB(t, "evaluation-attempt-claim")
	if err := MigrateEvaluationAggregate(db); err != nil {
		t.Fatalf("migrate evaluation schema: %v", err)
	}
	repository := NewEvaluationRepository(db)
	now := time.Date(2026, 9, 17, 8, 30, 0, 0, time.UTC)

	for _, attempt := range []*EvaluationCaseAttempt{
		{
			AttemptID:      "attempt-1",
			RunID:          "run-1",
			CaseID:         "case-1",
			Attempt:        1,
			PTID:           "ptid:actor-1",
			IdempotencyKey: "attempt-key-1",
			Status:         int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_PENDING),
			CreatedAt:      now,
			UpdatedAt:      now,
		},
		{
			AttemptID:      "attempt-2",
			RunID:          "run-1",
			CaseID:         "case-2",
			Attempt:        1,
			PTID:           "ptid:actor-1",
			IdempotencyKey: "attempt-key-2",
			Status:         int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_PENDING),
			CreatedAt:      now,
			UpdatedAt:      now,
		},
	} {
		if _, created, err := repository.EnsureAttempt(
			context.Background(),
			attempt,
		); err != nil {
			t.Fatalf("ensure unclaimed attempt %s: %v", attempt.AttemptID, err)
		} else if !created {
			t.Fatalf("attempt %s was not created", attempt.AttemptID)
		}
	}

	claimed, err := repository.ClaimAttempt(
		context.Background(),
		"attempt-1",
		"claim-1",
		now,
		now.Add(time.Minute),
		int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_PENDING),
	)
	if err != nil || !claimed {
		t.Fatalf("claim first attempt: claimed=%t err=%v", claimed, err)
	}
	competingClaim, err := repository.ClaimAttempt(
		context.Background(),
		"attempt-1",
		"claim-2",
		now,
		now.Add(time.Minute),
		int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_PENDING),
	)
	if err != nil {
		t.Fatalf("attempt competing claim: %v", err)
	}
	if competingClaim {
		t.Fatal("active scheduler claim was replaced before expiry")
	}
	if _, err := repository.UpdateAttempt(
		context.Background(),
		"attempt-1",
		[]int32{int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_PENDING)},
		map[string]interface{}{
			"status": int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_CANCELLED),
		},
	); err != nil {
		t.Fatalf("cancel claimed attempt: %v", err)
	}
	bound, err := repository.BindAttemptTurn(
		context.Background(),
		"attempt-1",
		"claim-1",
		"turn-late",
		"conversation-late",
		now,
		int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_PENDING),
		int32(model.EvaluationAttemptStatus_EVALUATION_ATTEMPT_STATUS_RUNNING),
	)
	if err != nil {
		t.Fatalf("bind cancelled attempt: %v", err)
	}
	if bound {
		t.Fatal("cancelled scheduler claim admitted a late Turn")
	}
}

func openEvaluationTestDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+name+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open evaluation test database: %v", err)
	}
	return db
}
