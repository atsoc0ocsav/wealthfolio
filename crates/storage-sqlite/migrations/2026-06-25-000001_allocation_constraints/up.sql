ALTER TABLE allocation_targets
  ADD COLUMN max_turnover_pct TEXT DEFAULT NULL;

CREATE TABLE rebalance_sell_constraints (
    id TEXT PRIMARY KEY NOT NULL,
    target_id TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('asset', 'account')),
    entity_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    FOREIGN KEY (target_id) REFERENCES allocation_targets(id) ON DELETE CASCADE,
    UNIQUE(target_id, entity_type, entity_id)
);

CREATE INDEX idx_rebalance_sell_constraints_target
ON rebalance_sell_constraints(target_id);
