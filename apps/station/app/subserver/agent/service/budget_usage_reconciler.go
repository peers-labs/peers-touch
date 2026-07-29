package service

import (
	"context"
	"math"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"gorm.io/gorm"
)

const budgetUsageMoneyTolerance = 0.000001

type BudgetUsageReconciliation struct {
	TaskID          string
	UsageCount      int
	ExpectedMoney   float64
	ActualMoney     float64
	Mismatches      []BudgetUsageMismatch
	MissingPricings []BudgetUsageMissingPricing
}

type BudgetUsageMismatch struct {
	BudgetUsageID         string
	ExpectedMoney         float64
	ActualMoney           float64
	PricingSource         string
	ProviderBillingSource string
}

type BudgetUsageMissingPricing struct {
	BudgetUsageID string
	ProviderID    string
	Model         string
	TotalTokens   int64
}

func (r BudgetUsageReconciliation) Balanced() bool {
	return len(r.Mismatches) == 0 && len(r.MissingPricings) == 0
}

type BudgetUsageReconciler struct {
	db *gorm.DB
}

func NewBudgetUsageReconciler(db *gorm.DB) *BudgetUsageReconciler {
	return &BudgetUsageReconciler{db: db}
}

func (r *BudgetUsageReconciler) ReconcileTask(ctx context.Context, taskID string) (BudgetUsageReconciliation, error) {
	result := BudgetUsageReconciliation{TaskID: strings.TrimSpace(taskID)}
	if r == nil || r.db == nil || result.TaskID == "" {
		return result, nil
	}
	var usages []persistence.TaskBudgetUsage
	if err := r.db.WithContext(ctx).
		Where("task_id = ?", result.TaskID).
		Order("created_at ASC, budget_usage_id ASC").
		Find(&usages).Error; err != nil {
		return result, err
	}
	result.UsageCount = len(usages)
	for _, usage := range usages {
		expected := budgetUsageExpectedMoney(usage)
		result.ExpectedMoney += expected
		result.ActualMoney += usage.UsedMoney
		if usage.TotalTokens > 0 &&
			strings.TrimSpace(usage.PricingSource) == "" &&
			strings.TrimSpace(usage.ProviderBillingSource) == "" &&
			usage.InputTokenPrice <= 0 &&
			usage.OutputTokenPrice <= 0 &&
			usage.ProviderBilledMoney <= 0 {
			result.MissingPricings = append(result.MissingPricings, BudgetUsageMissingPricing{
				BudgetUsageID: usage.BudgetUsageID,
				ProviderID:    usage.ProviderID,
				Model:         usage.Model,
				TotalTokens:   usage.TotalTokens,
			})
			continue
		}
		if math.Abs(expected-usage.UsedMoney) > budgetUsageMoneyTolerance {
			result.Mismatches = append(result.Mismatches, BudgetUsageMismatch{
				BudgetUsageID:         usage.BudgetUsageID,
				ExpectedMoney:         expected,
				ActualMoney:           usage.UsedMoney,
				PricingSource:         usage.PricingSource,
				ProviderBillingSource: usage.ProviderBillingSource,
			})
		}
	}
	return result, nil
}

func budgetUsageExpectedMoney(usage persistence.TaskBudgetUsage) float64 {
	return float64(usage.InputTokens)*usage.InputTokenPrice + float64(usage.OutputTokens)*usage.OutputTokenPrice
}
