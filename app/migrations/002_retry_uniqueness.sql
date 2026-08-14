CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_single_retry
  ON agent_runs(retry_of_run_id) WHERE retry_of_run_id IS NOT NULL;
