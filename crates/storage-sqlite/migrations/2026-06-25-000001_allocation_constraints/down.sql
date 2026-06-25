DROP TABLE IF EXISTS rebalance_sell_constraints;

ALTER TABLE allocation_targets DROP COLUMN max_turnover_pct;
