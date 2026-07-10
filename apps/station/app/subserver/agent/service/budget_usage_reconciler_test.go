package service

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestBudgetUsageReconcilerBalancesCatalogSnapshot(t *testing.T) {
	db := openBudgetUsageReconcilerDB(t, "budget_usage_reconciler_balanced")
	if err := db.Create(&persistence.TaskBudgetUsage{
		BudgetUsageID:    "usage-balanced",
		TaskID:           "task-1",
		InputTokens:      12,
		OutputTokens:     34,
		TotalTokens:      46,
		UsedMoney:        0.08,
		InputTokenPrice:  0.001,
		OutputTokenPrice: 0.002,
		PricingSource:    "provider.config.pricing",
		Source:           "station.direct_run",
		CreatedAt:        time.Now(),
	}).Error; err != nil {
		t.Fatalf("seed budget usage: %v", err)
	}

	result, err := NewBudgetUsageReconciler(db).ReconcileTask(context.Background(), "task-1")
	if err != nil {
		t.Fatalf("reconcile budget usage: %v", err)
	}
	if !result.Balanced() || result.UsageCount != 1 || result.ExpectedMoney < 0.0799 || result.ExpectedMoney > 0.0801 {
		t.Fatalf("expected balanced reconciliation, got %+v", result)
	}
}

func TestBudgetUsageReconcilerReportsPricingMismatch(t *testing.T) {
	db := openBudgetUsageReconcilerDB(t, "budget_usage_reconciler_mismatch")
	if err := db.Create(&persistence.TaskBudgetUsage{
		BudgetUsageID:    "usage-mismatch",
		TaskID:           "task-1",
		InputTokens:      10,
		OutputTokens:     10,
		TotalTokens:      20,
		UsedMoney:        0.01,
		InputTokenPrice:  0.001,
		OutputTokenPrice: 0.002,
		PricingSource:    "provider.config.pricing",
		Source:           "station.direct_run",
		CreatedAt:        time.Now(),
	}).Error; err != nil {
		t.Fatalf("seed budget usage: %v", err)
	}

	result, err := NewBudgetUsageReconciler(db).ReconcileTask(context.Background(), "task-1")
	if err != nil {
		t.Fatalf("reconcile budget usage: %v", err)
	}
	if result.Balanced() || len(result.Mismatches) != 1 {
		t.Fatalf("expected mismatch reconciliation, got %+v", result)
	}
	mismatch := result.Mismatches[0]
	if mismatch.BudgetUsageID != "usage-mismatch" || mismatch.ExpectedMoney < 0.0299 || mismatch.ExpectedMoney > 0.0301 || mismatch.PricingSource != "provider.config.pricing" {
		t.Fatalf("unexpected mismatch details: %+v", mismatch)
	}
}

func TestBudgetUsageReconcilerReportsMissingPricingSnapshot(t *testing.T) {
	db := openBudgetUsageReconcilerDB(t, "budget_usage_reconciler_missing_pricing")
	if err := db.Create(&persistence.TaskBudgetUsage{
		BudgetUsageID: "usage-unpriced",
		TaskID:        "task-1",
		ProviderID:    "openai-direct",
		Model:         "gpt-4.1",
		InputTokens:   10,
		OutputTokens:  20,
		TotalTokens:   30,
		UsedMoney:     0,
		Source:        "station.direct_run",
		CreatedAt:     time.Now(),
	}).Error; err != nil {
		t.Fatalf("seed budget usage: %v", err)
	}

	result, err := NewBudgetUsageReconciler(db).ReconcileTask(context.Background(), "task-1")
	if err != nil {
		t.Fatalf("reconcile budget usage: %v", err)
	}
	if result.Balanced() || len(result.MissingPricings) != 1 || len(result.Mismatches) != 0 {
		t.Fatalf("expected missing pricing reconciliation, got %+v", result)
	}
	missing := result.MissingPricings[0]
	if missing.BudgetUsageID != "usage-unpriced" || missing.ProviderID != "openai-direct" || missing.Model != "gpt-4.1" || missing.TotalTokens != 30 {
		t.Fatalf("unexpected missing pricing details: %+v", missing)
	}
}

func TestBudgetUsageReconcilerUsesProviderBillingAsActualMoney(t *testing.T) {
	db := openBudgetUsageReconcilerDB(t, "budget_usage_reconciler_provider_billing")
	if err := db.Create(&persistence.TaskBudgetUsage{
		BudgetUsageID:           "usage-billed",
		TaskID:                  "task-1",
		InputTokens:             10,
		OutputTokens:            10,
		TotalTokens:             20,
		UsedMoney:               0.05,
		EstimatedMoney:          0.03,
		ProviderBilledMoney:     0.05,
		ProviderBillingSource:   "provider.response.invoice",
		ProviderBillingCurrency: "USD",
		InputTokenPrice:         0.001,
		OutputTokenPrice:        0.002,
		PricingSource:           "provider.config.pricing",
		Source:                  "station.direct_run",
		CreatedAt:               time.Now(),
	}).Error; err != nil {
		t.Fatalf("seed budget usage: %v", err)
	}

	result, err := NewBudgetUsageReconciler(db).ReconcileTask(context.Background(), "task-1")
	if err != nil {
		t.Fatalf("reconcile budget usage: %v", err)
	}
	if result.Balanced() || len(result.Mismatches) != 1 || len(result.MissingPricings) != 0 {
		t.Fatalf("expected billed money mismatch reconciliation, got %+v", result)
	}
	mismatch := result.Mismatches[0]
	if mismatch.ExpectedMoney < 0.0299 || mismatch.ExpectedMoney > 0.0301 ||
		mismatch.ActualMoney < 0.0499 || mismatch.ActualMoney > 0.0501 ||
		mismatch.ProviderBillingSource != "provider.response.invoice" {
		t.Fatalf("unexpected billed money mismatch: %+v", mismatch)
	}
}

func TestBudgetUsageReconcilerAcceptsProviderBillingWithoutPricingSnapshot(t *testing.T) {
	db := openBudgetUsageReconcilerDB(t, "budget_usage_reconciler_provider_billing_without_pricing")
	if err := db.Create(&persistence.TaskBudgetUsage{
		BudgetUsageID:           "usage-billed-only",
		TaskID:                  "task-1",
		ProviderID:              "openai-direct",
		Model:                   "gpt-4.1",
		InputTokens:             10,
		OutputTokens:            20,
		TotalTokens:             30,
		UsedMoney:               0.07,
		ProviderBilledMoney:     0.07,
		ProviderBillingSource:   "provider.response.invoice",
		ProviderBillingCurrency: "USD",
		Source:                  "station.direct_run",
		CreatedAt:               time.Now(),
	}).Error; err != nil {
		t.Fatalf("seed budget usage: %v", err)
	}

	result, err := NewBudgetUsageReconciler(db).ReconcileTask(context.Background(), "task-1")
	if err != nil {
		t.Fatalf("reconcile budget usage: %v", err)
	}
	if len(result.MissingPricings) != 0 || len(result.Mismatches) != 1 {
		t.Fatalf("expected provider billing to avoid missing pricing while surfacing catalog mismatch, got %+v", result)
	}
}

func openBudgetUsageReconcilerDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+name+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.Exec(`CREATE TABLE agent_task_budget_usages (
		budget_usage_id text PRIMARY KEY,
		task_id text NOT NULL,
		step_id text,
		event_id text,
		event_seq integer NOT NULL DEFAULT 0,
		budget_id text,
		direct_run_id text,
		provider_id text,
		model text,
		input_tokens integer NOT NULL DEFAULT 0,
		output_tokens integer NOT NULL DEFAULT 0,
		total_tokens integer NOT NULL DEFAULT 0,
		used_money real NOT NULL DEFAULT 0,
                estimated_money real NOT NULL DEFAULT 0,
                provider_billed_money real NOT NULL DEFAULT 0,
                provider_billing_source text,
                provider_billing_currency text,
		input_token_price real NOT NULL DEFAULT 0,
		output_token_price real NOT NULL DEFAULT 0,
		pricing_source text,
		source text,
		payload_json text,
		created_at datetime NOT NULL
	)`).Error; err != nil {
		t.Fatalf("migrate budget usage: %v", err)
	}
	return db
}
