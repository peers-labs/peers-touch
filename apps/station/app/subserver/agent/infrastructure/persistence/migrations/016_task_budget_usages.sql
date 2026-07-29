CREATE TABLE IF NOT EXISTS agent_task_budget_usages (
  budget_usage_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  step_id TEXT,
  event_id TEXT,
  event_seq INTEGER NOT NULL DEFAULT 0,
  budget_id TEXT,
  direct_run_id TEXT,
  provider_id TEXT,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  used_money REAL NOT NULL DEFAULT 0,
  estimated_money REAL NOT NULL DEFAULT 0,
  provider_billed_money REAL NOT NULL DEFAULT 0,
  provider_billing_source TEXT,
  provider_billing_currency TEXT,
  input_token_price REAL NOT NULL DEFAULT 0,
  output_token_price REAL NOT NULL DEFAULT 0,
  pricing_source TEXT,
  source TEXT,
  payload_json TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_task_budget_usages_task ON agent_task_budget_usages(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_budget_usages_step ON agent_task_budget_usages(step_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_budget_usages_event ON agent_task_budget_usages(event_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_budget_usages_event_seq ON agent_task_budget_usages(event_seq);
CREATE INDEX IF NOT EXISTS idx_agent_task_budget_usages_budget ON agent_task_budget_usages(budget_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_budget_usages_direct_run ON agent_task_budget_usages(direct_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_budget_usages_provider ON agent_task_budget_usages(provider_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_budget_usages_model ON agent_task_budget_usages(model);
CREATE INDEX IF NOT EXISTS idx_agent_task_budget_usages_total_tokens ON agent_task_budget_usages(total_tokens);
CREATE INDEX IF NOT EXISTS idx_agent_task_budget_usages_billing_source ON agent_task_budget_usages(provider_billing_source);
CREATE INDEX IF NOT EXISTS idx_agent_task_budget_usages_pricing_source ON agent_task_budget_usages(pricing_source);
CREATE INDEX IF NOT EXISTS idx_agent_task_budget_usages_source ON agent_task_budget_usages(source);
CREATE INDEX IF NOT EXISTS idx_agent_task_budget_usages_created ON agent_task_budget_usages(created_at);
