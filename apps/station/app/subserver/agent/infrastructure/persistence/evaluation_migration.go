package persistence

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type legacyEcosystemEvalDataset struct {
	ID             string    `gorm:"column:id"`
	Name           string    `gorm:"column:name"`
	Description    string    `gorm:"column:description"`
	ItemsJSON      string    `gorm:"column:items_json"`
	OwnerActorPTID string    `gorm:"column:owner_actor_ptid"`
	CreatedAt      time.Time `gorm:"column:created_at"`
	UpdatedAt      time.Time `gorm:"column:updated_at"`
}

func (legacyEcosystemEvalDataset) TableName() string {
	return "ecosystem_eval_datasets"
}

type legacyEvaluationItem struct {
	ID                   string   `json:"id"`
	Input                string   `json:"input"`
	ExpectedOutput       string   `json:"expected_output"`
	ExpectedOutputLegacy string   `json:"expectedOutput"`
	Tags                 []string `json:"tags"`
}

// MigrateEvaluationAggregate installs the authoritative Evaluation schema,
// converts the retired ecosystem dataset rows, then drops the legacy table.
// Conversion is fail-closed so malformed source data cannot be silently lost.
func MigrateEvaluationAggregate(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("evaluation aggregate migration requires database")
	}
	models := []interface{}{
		&EvaluationBenchmark{},
		&EvaluationDataset{},
		&EvaluationTestCase{},
		&EvaluationRun{},
		&EvaluationRunCase{},
		&EvaluationCaseAttempt{},
		&EvaluationResult{},
		&EvaluationRunEvent{},
		&EvaluationCommand{},
	}
	if err := db.AutoMigrate(models...); err != nil {
		return fmt.Errorf("migrate evaluation aggregate schema: %w", err)
	}
	if !db.Migrator().HasTable(&legacyEcosystemEvalDataset{}) {
		return nil
	}

	return db.Transaction(func(tx *gorm.DB) error {
		var legacy []legacyEcosystemEvalDataset
		if err := tx.Order("created_at ASC, id ASC").Find(&legacy).Error; err != nil {
			return fmt.Errorf("load legacy evaluation datasets: %w", err)
		}
		for index := range legacy {
			if err := migrateLegacyEvaluationDataset(tx, &legacy[index]); err != nil {
				return err
			}
		}
		if err := tx.Migrator().DropTable(&legacyEcosystemEvalDataset{}); err != nil {
			return fmt.Errorf("drop legacy evaluation dataset table: %w", err)
		}
		return nil
	})
}

func migrateLegacyEvaluationDataset(
	tx *gorm.DB,
	legacy *legacyEcosystemEvalDataset,
) error {
	if legacy == nil {
		return nil
	}
	ptid := strings.TrimSpace(legacy.OwnerActorPTID)
	if ptid == "" {
		return fmt.Errorf("migrate legacy evaluation dataset %s: owner PTID is empty", legacy.ID)
	}
	datasetID := strings.TrimSpace(legacy.ID)
	if datasetID == "" {
		datasetID = evaluationMigrationID("dataset", ptid, legacy.Name)
	}
	var existing EvaluationDataset
	if err := tx.Where("dataset_id = ?", datasetID).First(&existing).Error; err == nil {
		if existing.PTID != ptid {
			return fmt.Errorf(
				"migrate legacy evaluation dataset %s: actor ownership conflicts",
				datasetID,
			)
		}
		return nil
	} else if err != gorm.ErrRecordNotFound {
		return fmt.Errorf("inspect migrated evaluation dataset %s: %w", datasetID, err)
	}

	var items []legacyEvaluationItem
	if raw := strings.TrimSpace(legacy.ItemsJSON); raw != "" {
		if err := json.Unmarshal([]byte(raw), &items); err != nil {
			return fmt.Errorf(
				"decode legacy evaluation dataset %s items: %w",
				datasetID,
				err,
			)
		}
	}
	now := legacy.CreatedAt.UTC()
	if now.IsZero() {
		now = time.Now().UTC()
	}
	updatedAt := legacy.UpdatedAt.UTC()
	if updatedAt.IsZero() {
		updatedAt = now
	}
	benchmarkID := evaluationMigrationID("benchmark", ptid, datasetID)
	benchmark := &EvaluationBenchmark{
		BenchmarkID: benchmarkID,
		PTID:        ptid,
		Name:        strings.TrimSpace(legacy.Name),
		Rubric:      "exact_match",
		Revision:    1,
		CreatedAt:   now,
		UpdatedAt:   updatedAt,
	}
	if benchmark.Name == "" {
		benchmark.Name = datasetID
	}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).
		Create(benchmark).Error; err != nil {
		return fmt.Errorf("migrate legacy evaluation benchmark %s: %w", benchmarkID, err)
	}
	dataset := &EvaluationDataset{
		DatasetID:   datasetID,
		BenchmarkID: benchmarkID,
		PTID:        ptid,
		Name:        benchmark.Name,
		Description: legacy.Description,
		Revision:    1,
		CreatedAt:   now,
		UpdatedAt:   updatedAt,
	}
	if err := tx.Create(dataset).Error; err != nil {
		return fmt.Errorf("migrate legacy evaluation dataset %s: %w", datasetID, err)
	}
	for index := range items {
		item := items[index]
		sourceItemID := strings.TrimSpace(item.ID)
		if sourceItemID == "" {
			sourceItemID = fmt.Sprintf("index:%d", index)
		} else {
			sourceItemID = "id:" + sourceItemID
		}
		caseID := evaluationMigrationID(
			"case",
			ptid,
			datasetID,
			sourceItemID,
		)
		expected := item.ExpectedOutput
		if expected == "" {
			expected = item.ExpectedOutputLegacy
		}
		tagsJSON, err := json.Marshal(item.Tags)
		if err != nil {
			return fmt.Errorf("encode legacy evaluation case %s tags: %w", caseID, err)
		}
		testCase := &EvaluationTestCase{
			CaseID:    caseID,
			DatasetID: datasetID,
			PTID:      ptid,
			Input:     item.Input,
			Expected:  expected,
			TagsJSON:  tagsJSON,
			Revision:  1,
			CreatedAt: now,
			UpdatedAt: updatedAt,
		}
		if err := tx.Create(testCase).Error; err != nil {
			return fmt.Errorf("migrate legacy evaluation case %s: %w", caseID, err)
		}
	}
	return nil
}

func evaluationMigrationID(prefix string, parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return prefix + "_" + hex.EncodeToString(sum[:12])
}
