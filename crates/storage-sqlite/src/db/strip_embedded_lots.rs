//! One-time startup data migration for the `holdings_snapshots` bloat fix
//! (STEP 3).
//!
//! Existing instances carry `holdings_snapshots.positions` JSON that still
//! embeds per-position tax lots (written before STEP 2 stopped serializing
//! them), and their `snapshot_positions.cost_basis_base` /
//! `cost_basis_account` scalars are `NULL` (the columns were added by migration
//! `2026-07-02-000001`). This migration upgrades such an instance to the new
//! compact format **without** requiring a manual full rebuild, preserving
//! valuations exactly:
//!
//! 1. **Guard / idempotency** — do nothing unless some `positions` JSON still
//!    embeds a lot object (`positions LIKE '%"lots":[{%'`). A second run finds
//!    no such rows and is a pure no-op: no backup, no writes, no `VACUUM`.
//! 2. **Auto-backup first** — before any destructive write, snapshot the DB via
//!    the existing self-contained `VACUUM INTO` backup facility
//!    ([`super::backup_database_from_path`]). If the backup cannot be created,
//!    the migration aborts and strips nothing.
//! 3. **Backfill** — for each position that still embeds lots, derive
//!    `cost_basis_account` / `cost_basis_base` from the embedded lots using the
//!    exact same arithmetic as write-time precompute
//!    ([`compute_position_cost_basis_from_lots`]), then persist the scalars into
//!    `snapshot_positions` (only where currently `NULL`).
//! 4. **Strip** — rewrite each such `positions` JSON without the embedded lots
//!    (matching what STEP-2 writes now produce), leaving everything else intact.
//! 5. **Vacuum** — once, after the backfill+strip transaction commits, and only
//!    when at least one snapshot was migrated, to reclaim the freed space.
//!
//! The backfill converts each embedded lot at its acquisition-date FX using
//! the per-lot stored FX carried in the lots (`fxRateToBase` / `fxRateToAccount`)
//! first, and — when a very old lot lacks a stored rate — an **offline** FX
//! fallback that resolves the acquisition-date rate from the LOCAL stored rate
//! data (the `quotes` table for `kind='FX'` assets) via the same
//! [`FxService`]/[`compute_position_cost_basis_from_lots`] path write-time
//! precompute uses. No network access is ever performed. Because both this
//! backfill and write-time precompute share [`compute_position_cost_basis_from_lots`]
//! **and** the same local FX rate source/semantics (normalization, inversion,
//! nearest-date via the currency converter), a backfilled scalar is identical to
//! a write-time recompute / full rebuild. If a rate genuinely cannot be resolved
//! locally, the scalar is left `NULL` (never fabricated), matching prior
//! behavior.
//!
//! [`FxService`]: wealthfolio_core::fx::FxService

use std::collections::HashMap;
use std::sync::Arc;

use chrono::NaiveDate;
use diesel::connection::SimpleConnection;
use diesel::prelude::*;
use diesel::sql_query;
use diesel::sql_types::Text;
use log::{info, warn};
use rust_decimal::Decimal;

use wealthfolio_core::errors::{DatabaseError, Error, Result};
use wealthfolio_core::fx::{FxService, FxServiceTrait};
use wealthfolio_core::portfolio::snapshot::{compute_position_cost_basis_from_lots, Position};

use super::{backup_database_from_path, create_backup_path, get_connection, DbPool, WriteHandle};
use crate::errors::StorageError;
use crate::fx::FxRepository;

/// LIKE pattern matching a `positions` JSON blob that still embeds at least one
/// lot object (`"lots":[{`). STEP-2 writes omit the `lots` key entirely, and a
/// position with no lots serializes `"lots":[]`; neither matches this pattern.
/// SQLite `LIKE` treats only `%` and `_` as wildcards, so `[` and `{` are
/// literal here.
const EMBEDDED_LOTS_LIKE: &str = "%\"lots\":[{%";

/// Outcome of a [`strip_embedded_lots_migration`] run. Exposed so callers (app
/// startup, offline verification) can log/inspect exactly what happened.
#[derive(Debug, Clone, Default)]
pub struct StripEmbeddedLotsOutcome {
    /// Whether the migration found work to do. `false` means a pure no-op run
    /// (no backup, no writes, no vacuum).
    pub needed: bool,
    /// Number of `holdings_snapshots` rows whose `positions` JSON was stripped.
    pub snapshots_migrated: usize,
    /// Number of `snapshot_positions` rows that had at least one cost-basis
    /// scalar backfilled from `NULL`.
    pub positions_backfilled: usize,
    /// Path to the backup created before the destructive write, if any.
    pub backup_path: Option<String>,
    /// Whether `VACUUM` ran (only when at least one snapshot was migrated).
    pub vacuumed: bool,
}

#[derive(QueryableByName)]
struct SnapshotRow {
    #[diesel(sql_type = Text)]
    id: String,
    #[diesel(sql_type = Text)]
    account_id: String,
    #[diesel(sql_type = Text)]
    positions: String,
}

#[derive(QueryableByName)]
struct CurrencyRow {
    #[diesel(sql_type = Text)]
    value: String,
}

/// A single position's backfill payload (already computed offline).
struct PositionBackfill {
    asset_id: String,
    cost_basis_account: Option<Decimal>,
    cost_basis_base: Option<Decimal>,
}

/// Precomputed plan for one snapshot: the stripped JSON plus the per-position
/// scalars to persist. Built outside the transaction so all fallible domain
/// work (JSON parse, FX arithmetic) happens before any write.
struct SnapshotPlan {
    id: String,
    stripped_json: String,
    backfills: Vec<PositionBackfill>,
}

/// Run the STEP-3 `holdings_snapshots` lot-strip migration against the database
/// backing `pool`.
///
/// * `pool` — connection pool for the live database (schema migrations must
///   have already run).
/// * `source_db_path` — filesystem path to the SQLite database file, used as
///   the backup source (matches what `db::get_db_path` returns in production).
/// * `app_data_dir` — data root; the pre-migration backup is written under
///   `<app_data_dir>/backups/` using the standard backup filename.
///
/// Returns a [`StripEmbeddedLotsOutcome`] describing what happened. Safe to call
/// on every startup: it is a no-op once all snapshots are in the compact format.
/// Intended to be invoked once at startup **after** `db::run_migrations`, and is
/// also directly invocable for offline verification against a copy of an
/// existing `.db` file.
pub fn strip_embedded_lots_migration(
    pool: &DbPool,
    source_db_path: &str,
    app_data_dir: &str,
) -> Result<StripEmbeddedLotsOutcome> {
    let mut conn = get_connection(pool)?;

    // 1) GUARD / idempotency: only proceed if some positions JSON still embeds
    //    lots. On a clean/compact DB this returns nothing and we do nothing.
    let candidates: Vec<SnapshotRow> =
        sql_query("SELECT id, account_id, positions FROM holdings_snapshots WHERE positions LIKE ?")
            .bind::<Text, _>(EMBEDDED_LOTS_LIKE)
            .load(&mut conn)
            .map_err(StorageError::from)?;

    if candidates.is_empty() {
        return Ok(StripEmbeddedLotsOutcome::default());
    }

    info!(
        "holdings_snapshots lot-strip migration: {} snapshot(s) still embed lots; backing up before rewrite.",
        candidates.len()
    );

    // 2) AUTO-BACKUP FIRST. Abort (strip nothing) if the backup fails.
    let backup_path = create_backup_path(app_data_dir)?;
    backup_database_from_path(source_db_path, &backup_path)?;
    info!(
        "holdings_snapshots lot-strip migration: backup created at {}",
        backup_path
    );

    // 3) BACKFILL (compute) — done fully offline before touching the DB.
    let base_currency = fetch_base_currency(&mut conn)?;
    // Offline FX resolver over the SAME local rate source write-time precompute
    // uses: core's `FxService` backed by the storage-sqlite `FxRepository`
    // reading the local `quotes`/`assets` (kind='FX') tables. `initialize()`
    // builds the in-memory currency converter from the local historical rates,
    // so acquisition-date resolution uses identical normalization, inversion,
    // and nearest-date semantics as `HoldingsCalculator::precompute_position_cost_basis`.
    // `None` when the FX subsystem cannot be brought up (then only same-currency
    // identity is derivable, exactly as before this hardening).
    let fx_service = build_offline_fx_service(pool);
    let mut account_currencies: HashMap<String, String> = HashMap::new();
    let mut plans: Vec<SnapshotPlan> = Vec::with_capacity(candidates.len());

    for row in &candidates {
        let account_currency = match account_currencies.get(&row.account_id) {
            Some(currency) => currency.clone(),
            None => {
                let currency = fetch_account_currency(&mut conn, &row.account_id)?;
                account_currencies.insert(row.account_id.clone(), currency.clone());
                currency
            }
        };

        let mut positions: HashMap<String, Position> = match serde_json::from_str(&row.positions) {
            Ok(map) => map,
            Err(e) => {
                warn!(
                    "holdings_snapshots lot-strip migration: skipping snapshot {} with unparseable positions JSON: {}",
                    row.id, e
                );
                continue;
            }
        };

        let mut backfills = Vec::new();
        let mut stripped_any = false;

        for pos in positions.values_mut() {
            if pos.account_id.is_empty() {
                pos.account_id = row.account_id.clone();
            }
            if pos.lots.is_empty() {
                continue;
            }
            stripped_any = true;

            // Fallback for lots that lack stored per-lot FX: same-currency
            // identity first, else resolve the acquisition-date rate from the
            // LOCAL stored FX data via `fx_service` (offline, no network). Lots
            // that DO carry stored FX never reach this fallback —
            // `Lot::stored_fx_rate_to` resolves them inside
            // `compute_position_cost_basis_from_lots`, the shared arithmetic
            // with write-time precompute. When the rate cannot be resolved
            // locally the helper yields `None`, leaving the scalar `NULL`.
            let cost_basis_account = compute_position_cost_basis_from_lots(
                pos,
                &account_currency,
                |from, to, date| resolve_fx_fallback(fx_service.as_ref(), from, to, date),
            );
            let cost_basis_base = compute_position_cost_basis_from_lots(
                pos,
                &base_currency,
                |from, to, date| resolve_fx_fallback(fx_service.as_ref(), from, to, date),
            );

            // Mirror the scalars into the Position so the stripped JSON matches
            // the STEP-2 write shape and the JSON-fallback read path stays
            // correct even if the relational row is ever missing.
            pos.cost_basis_account = cost_basis_account;
            pos.cost_basis_base = cost_basis_base;

            backfills.push(PositionBackfill {
                asset_id: pos.asset_id.clone(),
                cost_basis_account,
                cost_basis_base,
            });
        }

        if !stripped_any {
            continue;
        }

        // 4) STRIP: re-serialize without embedded lots. `Position.lots` is
        //    `#[serde(skip_serializing)]`, so the lots are dropped and every
        //    other field is preserved byte-for-byte via the serde round-trip.
        let stripped_json = serde_json::to_string(&positions).map_err(|e| {
            Error::Database(DatabaseError::QueryFailed(format!(
                "Failed to re-serialize stripped positions for snapshot {}: {}",
                row.id, e
            )))
        })?;

        plans.push(SnapshotPlan {
            id: row.id.clone(),
            stripped_json,
            backfills,
        });
    }

    // Persist backfill + strip atomically. VACUUM is issued separately because
    // it cannot run inside a transaction.
    let (snapshots_migrated, positions_backfilled) = conn
        .transaction::<_, diesel::result::Error, _>(|tx| {
            let mut snapshots_migrated = 0usize;
            let mut positions_backfilled = 0usize;

            for plan in &plans {
                for backfill in &plan.backfills {
                    let mut updated = false;

                    // Only write columns we could trust-compute, and only where
                    // the scalar is still NULL so we never clobber an existing
                    // value (idempotent).
                    if let Some(value) = backfill.cost_basis_account {
                        let n = sql_query(
                            "UPDATE snapshot_positions SET cost_basis_account = ? \
                             WHERE snapshot_id = ? AND asset_id = ? AND cost_basis_account IS NULL",
                        )
                        .bind::<Text, _>(value.to_string())
                        .bind::<Text, _>(&plan.id)
                        .bind::<Text, _>(&backfill.asset_id)
                        .execute(tx)?;
                        updated |= n > 0;
                    }

                    if let Some(value) = backfill.cost_basis_base {
                        let n = sql_query(
                            "UPDATE snapshot_positions SET cost_basis_base = ? \
                             WHERE snapshot_id = ? AND asset_id = ? AND cost_basis_base IS NULL",
                        )
                        .bind::<Text, _>(value.to_string())
                        .bind::<Text, _>(&plan.id)
                        .bind::<Text, _>(&backfill.asset_id)
                        .execute(tx)?;
                        updated |= n > 0;
                    }

                    if updated {
                        positions_backfilled += 1;
                    }
                }

                sql_query("UPDATE holdings_snapshots SET positions = ? WHERE id = ?")
                    .bind::<Text, _>(&plan.stripped_json)
                    .bind::<Text, _>(&plan.id)
                    .execute(tx)?;

                snapshots_migrated += 1;
            }

            Ok((snapshots_migrated, positions_backfilled))
        })
        .map_err(StorageError::from)?;

    // 5) VACUUM once, after commit, only when something actually changed.
    let mut vacuumed = false;
    if snapshots_migrated > 0 {
        conn.batch_execute("VACUUM;").map_err(StorageError::from)?;
        vacuumed = true;
    }

    info!(
        "holdings_snapshots lot-strip migration complete: {} snapshot(s) stripped, {} position scalar(s) backfilled, vacuumed={}",
        snapshots_migrated, positions_backfilled, vacuumed
    );

    Ok(StripEmbeddedLotsOutcome {
        needed: true,
        snapshots_migrated,
        positions_backfilled,
        backup_path: Some(backup_path),
        vacuumed,
    })
}

/// Read the app base currency from `app_settings`. Defaults to `USD` when the
/// key is absent (should not happen on an initialized instance).
fn fetch_base_currency(conn: &mut SqliteConnection) -> Result<String> {
    let rows: Vec<CurrencyRow> = sql_query(
        "SELECT setting_value AS value FROM app_settings WHERE setting_key = 'base_currency'",
    )
    .load(conn)
    .map_err(StorageError::from)?;
    Ok(rows
        .into_iter()
        .next()
        .map(|row| row.value)
        .unwrap_or_else(|| "USD".to_string()))
}

/// Read an account's currency from `accounts`. Returns an empty string when the
/// account is unknown (defensive; cost-basis-account then only backfills for
/// positions whose lots carry a matching stored FX rate).
fn fetch_account_currency(conn: &mut SqliteConnection, account_id: &str) -> Result<String> {
    let rows: Vec<CurrencyRow> = sql_query("SELECT currency AS value FROM accounts WHERE id = ?")
        .bind::<Text, _>(account_id)
        .load(conn)
        .map_err(StorageError::from)?;
    Ok(rows.into_iter().next().map(|row| row.value).unwrap_or_default())
}

/// Build an **offline** [`FxService`] over `pool`, backed by the storage-sqlite
/// [`FxRepository`] reading the local `quotes`/`assets` (kind='FX') tables — the
/// exact same rate source write-time precompute reads. `initialize()` loads all
/// local historical rates into the in-memory currency converter so subsequent
/// acquisition-date lookups use identical normalization / inversion /
/// nearest-date semantics.
///
/// The repository is constructed with a [`WriteHandle::detached`] because this
/// resolver only ever performs reads (`get_historical_exchange_rates`,
/// `get_latest_exchange_rate*`); no writer actor / Tokio runtime is required, so
/// this is safe from the synchronous startup migration and its tests.
///
/// Returns `None` (and logs) if the converter cannot be initialized, in which
/// case the backfill falls back to same-currency identity only — the exact
/// behavior prior to this hardening, so no scalar is ever fabricated.
fn build_offline_fx_service(pool: &DbPool) -> Option<FxService> {
    let repository = Arc::new(FxRepository::new(Arc::new(pool.clone()), WriteHandle::detached()));
    let service = FxService::new(repository);
    match service.initialize() {
        Ok(()) => Some(service),
        Err(e) => {
            warn!(
                "holdings_snapshots lot-strip migration: offline FX resolver unavailable ({}); \
                 falling back to same-currency identity only for lots lacking stored FX.",
                e
            );
            None
        }
    }
}

/// Acquisition-date FX fallback for a lot with no stored per-lot rate. Mirrors
/// write-time precompute's fallback: same-currency identity (`1`), otherwise the
/// local stored rate for `(from, to)` at `date` resolved by `fx_service`
/// (offline). Returns `None` when the rate cannot be resolved locally, leaving
/// the scalar `NULL` rather than guessing.
///
/// `from`/`to` arrive already normalized from
/// [`compute_position_cost_basis_from_lots`]; `FxService::get_exchange_rate_for_date`
/// normalizes idempotently, so the resolved value matches precompute exactly.
fn resolve_fx_fallback(
    fx_service: Option<&FxService>,
    from: &str,
    to: &str,
    date: NaiveDate,
) -> Option<Decimal> {
    if from == to {
        return Some(Decimal::ONE);
    }
    fx_service.and_then(|svc| svc.get_exchange_rate_for_date(from, to, date).ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{create_pool, run_migrations};
    use diesel::sql_query;
    use std::path::Path;

    struct TestDb {
        _dir: tempfile::TempDir,
        app_data_dir: String,
        db_path: String,
        pool: DbPool,
    }

    fn setup_db() -> TestDb {
        let dir = tempfile::tempdir().expect("tempdir");
        let app_data_dir = dir.path().to_string_lossy().to_string();
        let db_path = dir
            .path()
            .join("app.db")
            .to_string_lossy()
            .to_string();
        run_migrations(&db_path).expect("run migrations");
        let pool = (*create_pool(&db_path).expect("create pool")).clone();
        TestDb {
            _dir: dir,
            app_data_dir,
            db_path,
            pool,
        }
    }

    fn exec(pool: &DbPool, sql: &str) {
        let mut conn = get_connection(pool).expect("conn");
        sql_query(sql).execute(&mut conn).expect("exec sql");
    }

    fn scalar_text(pool: &DbPool, sql: &str) -> Option<String> {
        let mut conn = get_connection(pool).expect("conn");
        let rows: Vec<CurrencyRow> = sql_query(sql).load(&mut conn).expect("load");
        rows.into_iter().next().map(|r| r.value)
    }

    fn nullable_scalar(pool: &DbPool, sql: &str) -> Option<String> {
        // COALESCE NULL to a sentinel so a missing/NULL value is distinguishable.
        let coalesced = scalar_text(pool, sql);
        coalesced.filter(|v| v != "__NULL__")
    }

    fn seed_common(pool: &DbPool) {
        exec(
            pool,
            "INSERT INTO app_settings (setting_key, setting_value) VALUES ('base_currency', 'USD')",
        );
        exec(
            pool,
            "INSERT INTO accounts (id, name, account_type, currency, is_default, is_active, created_at, updated_at, is_archived, tracking_mode) \
             VALUES ('acc1', 'Test', 'REGULAR', 'USD', 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 'TRANSACTIONS')",
        );
        exec(
            pool,
            "INSERT INTO assets (id, kind, name, display_code, notes, metadata, is_active, quote_mode, quote_ccy, instrument_type, instrument_symbol, instrument_exchange_mic, provider_config, created_at, updated_at) \
             VALUES ('EUSTX', 'INVESTMENT', 'Euro Stock', 'EUSTX', NULL, NULL, 1, 'MANUAL', 'EUR', NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        );
    }

    /// OLD-format positions JSON for a single EUR position (asset EUSTX) with
    /// two cross-currency lots carrying stored acquisition FX to USD that differ
    /// per lot (1.1 and 1.3), so a correct backfill must NOT collapse to a
    /// single valuation-date rate.
    ///
    /// Compact (no whitespace) to mirror `serde_json::to_string` output — which
    /// is what the writer persists and what the `"lots":[{` guard matches.
    fn old_positions_json() -> String {
        concat!(
            r#"{"EUSTX":{"#,
            r#""id":"POS-EUSTX-acc1","accountId":"acc1","assetId":"EUSTX","#,
            r#""quantity":"15","averageCost":"100","totalCostBasis":"1500","#,
            r#""currency":"EUR","inceptionDate":"2025-01-02T12:00:00Z","#,
            r#""lots":[{"#,
            r#""id":"buy-1","positionId":"POS-EUSTX-acc1","#,
            r#""acquisitionDate":"2025-01-02T12:00:00Z","quantity":"10","#,
            r#""costBasis":"1000","acquisitionPrice":"100","acquisitionFees":"0","#,
            r#""fxRateToPosition":null,"fxRateToAccount":"1.1","accountCurrency":"USD","#,
            r#""fxRateToBase":"1.1","baseCurrency":"USD"},{"#,
            r#""id":"buy-2","positionId":"POS-EUSTX-acc1","#,
            r#""acquisitionDate":"2025-03-02T12:00:00Z","quantity":"5","#,
            r#""costBasis":"500","acquisitionPrice":"100","acquisitionFees":"0","#,
            r#""fxRateToPosition":null,"fxRateToAccount":"1.3","accountCurrency":"USD","#,
            r#""fxRateToBase":"1.3","baseCurrency":"USD"}],"#,
            r#""createdAt":"2025-01-02T12:00:00Z","lastUpdated":"2025-03-02T12:00:00Z"}}"#
        )
        .to_string()
    }

    fn seed_old_snapshot(pool: &DbPool) {
        let positions = old_positions_json().replace('\'', "''");
        exec(
            pool,
            &format!(
                "INSERT INTO holdings_snapshots \
                 (id, account_id, snapshot_date, currency, positions, cash_balances, cost_basis, net_contribution, calculated_at, net_contribution_base, cash_total_account_currency, cash_total_base_currency, source) \
                 VALUES ('snap1', 'acc1', '2025-03-02', 'USD', '{positions}', '{{}}', '1750', '0', '2025-03-02T00:00:00.000Z', '0', '0', '0', 'CALCULATED')"
            ),
        );
        // Relational sibling row with NULL cost-basis scalars (as an existing
        // instance would have after the additive column migration).
        exec(
            pool,
            "INSERT INTO snapshot_positions \
             (snapshot_id, asset_id, quantity, average_cost, total_cost_basis, currency, inception_date, is_alternative, contract_multiplier, created_at, last_updated, cost_basis_base, cost_basis_account) \
             VALUES ('snap1', 'EUSTX', '15', '100', '1500', 'EUR', '2025-01-02T12:00:00Z', 0, '1', '2025-01-02T12:00:00Z', '2025-03-02T12:00:00Z', NULL, NULL)",
        );
    }

    fn backups_count(app_data_dir: &str) -> usize {
        let dir = Path::new(app_data_dir).join("backups");
        match std::fs::read_dir(&dir) {
            Ok(entries) => entries
                .filter_map(|e| e.ok())
                .filter(|e| {
                    e.file_name()
                        .to_str()
                        .map(crate::db::is_valid_backup_filename)
                        .unwrap_or(false)
                })
                .count(),
            Err(_) => 0,
        }
    }

    #[test]
    fn parity_backfills_cross_currency_without_collapsing() {
        let db = setup_db();
        seed_common(&db.pool);
        seed_old_snapshot(&db.pool);

        // The value valuation would derive by walking the embedded lots BEFORE
        // the strip == what precompute yields == what we must backfill. Compute
        // it via the shared helper on the same lots for an apples-to-apples
        // parity assertion.
        let positions: HashMap<String, Position> =
            serde_json::from_str(&old_positions_json()).unwrap();
        let pos = positions.get("EUSTX").unwrap();
        let identity = |from: &str, to: &str, _d: chrono::NaiveDate| {
            (from == to).then_some(Decimal::ONE)
        };
        let expected_base = compute_position_cost_basis_from_lots(pos, "USD", identity).unwrap();
        let expected_account = compute_position_cost_basis_from_lots(pos, "USD", identity).unwrap();
        // 1000*1.1 + 500*1.3 = 1750; a valuation-date-FX collapse would differ.
        assert_eq!(expected_base, Decimal::from(1750));

        let outcome =
            strip_embedded_lots_migration(&db.pool, &db.db_path, &db.app_data_dir).unwrap();
        assert!(outcome.needed);
        assert_eq!(outcome.snapshots_migrated, 1);
        assert_eq!(outcome.positions_backfilled, 1);
        assert!(outcome.vacuumed);
        assert!(outcome.backup_path.is_some());

        // (a) backfilled scalars equal the precompute result.
        let stored_base = nullable_scalar(
            &db.pool,
            "SELECT COALESCE(cost_basis_base, '__NULL__') AS value FROM snapshot_positions WHERE snapshot_id = 'snap1' AND asset_id = 'EUSTX'",
        )
        .expect("cost_basis_base backfilled");
        let stored_account = nullable_scalar(
            &db.pool,
            "SELECT COALESCE(cost_basis_account, '__NULL__') AS value FROM snapshot_positions WHERE snapshot_id = 'snap1' AND asset_id = 'EUSTX'",
        )
        .expect("cost_basis_account backfilled");
        assert_eq!(Decimal::from_str_exact(&stored_base).unwrap(), expected_base);
        assert_eq!(
            Decimal::from_str_exact(&stored_account).unwrap(),
            expected_account
        );

        // (b) cross-currency did NOT collapse to a single valuation-date rate.
        assert_eq!(Decimal::from_str_exact(&stored_base).unwrap(), Decimal::from(1750));
        assert_ne!(Decimal::from_str_exact(&stored_base).unwrap(), Decimal::from(2250));

        // (c) positions JSON no longer embeds lots.
        let stripped = scalar_text(
            &db.pool,
            "SELECT positions AS value FROM holdings_snapshots WHERE id = 'snap1'",
        )
        .unwrap();
        assert!(
            !stripped.contains("\"lots\":[{"),
            "stripped JSON must not embed lots, got: {stripped}"
        );
        assert!(
            !stripped.contains("\"lots\""),
            "stripped JSON must omit the lots key entirely, got: {stripped}"
        );

        // (d) a subsequent cost-basis read equals the pre-strip lot-walk value.
        // Valuation prefers the relational scalar; it now matches expected_base.
        let reloaded: HashMap<String, Position> = serde_json::from_str(&stripped).unwrap();
        let reloaded_pos = reloaded.get("EUSTX").unwrap();
        assert!(reloaded_pos.lots.is_empty());
        assert_eq!(reloaded_pos.cost_basis_base, Some(expected_base));
        assert_eq!(reloaded_pos.cost_basis_account, Some(expected_account));
    }

    #[test]
    fn idempotent_second_run_is_a_no_op() {
        let db = setup_db();
        seed_common(&db.pool);
        seed_old_snapshot(&db.pool);

        let first =
            strip_embedded_lots_migration(&db.pool, &db.db_path, &db.app_data_dir).unwrap();
        assert!(first.needed);
        assert!(first.vacuumed);
        assert_eq!(backups_count(&db.app_data_dir), 1);

        let second =
            strip_embedded_lots_migration(&db.pool, &db.db_path, &db.app_data_dir).unwrap();
        assert!(!second.needed, "second run must find no work");
        assert_eq!(second.snapshots_migrated, 0);
        assert_eq!(second.positions_backfilled, 0);
        assert!(!second.vacuumed, "second run must not vacuum");
        assert!(second.backup_path.is_none(), "second run must not back up");
        assert_eq!(
            backups_count(&db.app_data_dir),
            1,
            "second run must not create another backup"
        );
    }

    #[test]
    fn noop_on_already_compact_db_skips_backup_and_vacuum() {
        let db = setup_db();
        seed_common(&db.pool);
        // NEW-format snapshot: positions JSON without any embedded lots.
        exec(
            &db.pool,
            "INSERT INTO holdings_snapshots \
             (id, account_id, snapshot_date, currency, positions, cash_balances, cost_basis, net_contribution, calculated_at, net_contribution_base, cash_total_account_currency, cash_total_base_currency, source) \
             VALUES ('snapNew', 'acc1', '2025-03-02', 'USD', '{\"EUSTX\":{\"id\":\"POS-EUSTX-acc1\",\"accountId\":\"acc1\",\"assetId\":\"EUSTX\",\"quantity\":\"15\",\"averageCost\":\"100\",\"totalCostBasis\":\"1500\",\"currency\":\"EUR\",\"inceptionDate\":\"2025-01-02T12:00:00Z\",\"createdAt\":\"2025-01-02T12:00:00Z\",\"lastUpdated\":\"2025-03-02T12:00:00Z\",\"costBasisAccount\":\"1750\",\"costBasisBase\":\"1750\"}}', '{}', '1750', '0', '2025-03-02T00:00:00.000Z', '0', '0', '0', 'CALCULATED')",
        );

        let outcome =
            strip_embedded_lots_migration(&db.pool, &db.db_path, &db.app_data_dir).unwrap();
        assert!(!outcome.needed);
        assert!(!outcome.vacuumed);
        assert!(outcome.backup_path.is_none());
        assert_eq!(
            backups_count(&db.app_data_dir),
            0,
            "no-op run must not create a backup"
        );
    }

    #[test]
    fn backup_failure_aborts_without_stripping() {
        let db = setup_db();
        seed_common(&db.pool);
        seed_old_snapshot(&db.pool);

        // Force create_backup_path to fail: place a FILE where the backups
        // directory would be created.
        let backups_path = Path::new(&db.app_data_dir).join("backups");
        std::fs::write(&backups_path, b"not a directory").unwrap();

        let result = strip_embedded_lots_migration(&db.pool, &db.db_path, &db.app_data_dir);
        assert!(result.is_err(), "backup failure must abort the migration");

        // Nothing stripped: positions JSON still embeds lots.
        let positions = scalar_text(
            &db.pool,
            "SELECT positions AS value FROM holdings_snapshots WHERE id = 'snap1'",
        )
        .unwrap();
        assert!(
            positions.contains("\"lots\":[{"),
            "positions must still embed lots after aborted migration"
        );

        // Scalars still NULL.
        let base = nullable_scalar(
            &db.pool,
            "SELECT COALESCE(cost_basis_base, '__NULL__') AS value FROM snapshot_positions WHERE snapshot_id = 'snap1' AND asset_id = 'EUSTX'",
        );
        assert!(base.is_none(), "cost_basis_base must remain NULL after abort");
    }

    /// Insert a non-FX INVESTMENT asset (so positions can reference it).
    fn seed_asset(pool: &DbPool, id: &str, quote_ccy: &str) {
        exec(
            pool,
            &format!(
                "INSERT INTO assets (id, kind, name, display_code, notes, metadata, is_active, quote_mode, quote_ccy, instrument_type, instrument_symbol, instrument_exchange_mic, provider_config, created_at, updated_at) \
                 VALUES ('{id}', 'INVESTMENT', '{id}', '{id}', NULL, NULL, 1, 'MANUAL', '{quote_ccy}', NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
        );
    }

    /// Populate the LOCAL FX rate table (an `assets` row of kind='FX' plus a
    /// `quotes` row) for `from`->`to` on `day`, exactly as market-data sync
    /// would. This is the same source `FxService`/precompute read from.
    fn seed_fx_rate(pool: &DbPool, from: &str, to: &str, day: &str, rate: &str) {
        let asset_id = format!("FX-{from}{to}");
        // `instrument_key` is a STORED generated column
        // (`instrument_type||':'||instrument_symbol||'/'||quote_ccy` for FX), so
        // it is derived from the columns below and must not be inserted directly.
        exec(
            pool,
            &format!(
                "INSERT OR IGNORE INTO assets (id, kind, name, display_code, notes, metadata, is_active, quote_mode, quote_ccy, instrument_type, instrument_symbol, instrument_exchange_mic, provider_config, created_at, updated_at) \
                 VALUES ('{asset_id}', 'FX', '{from}/{to}', '{from}{to}', NULL, NULL, 1, 'MANUAL', '{to}', 'FX', '{from}', NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
        );
        exec(
            pool,
            &format!(
                "INSERT INTO quotes (id, asset_id, day, source, open, high, low, close, adjclose, volume, currency, notes, created_at, timestamp) \
                 VALUES ('{asset_id}_{day}_MANUAL', '{asset_id}', '{day}', 'MANUAL', '{rate}', '{rate}', '{rate}', '{rate}', '{rate}', '0', '{from}', NULL, '{day}T12:00:00Z', '{day}T12:00:00Z')"
            ),
        );
    }

    /// Snapshot embedding three positions: (1) cross-currency EUR with lots
    /// that LACK stored FX, (2) same-currency USD control, (3) cross-currency
    /// EUR with stored per-lot FX. All `snapshot_positions` scalars start NULL.
    fn seed_localfx_snapshot(pool: &DbPool) {
        let positions = concat!(
            r#"{"#,
            // (1) EUR, NO stored FX -> must resolve via local FX table.
            r#""EUSTX":{"id":"POS-EUSTX-acc1","accountId":"acc1","assetId":"EUSTX","#,
            r#""quantity":"15","averageCost":"100","totalCostBasis":"1500","#,
            r#""currency":"EUR","inceptionDate":"2025-01-02T12:00:00Z","lots":[{"#,
            r#""id":"eu-buy-1","positionId":"POS-EUSTX-acc1","acquisitionDate":"2025-01-02T12:00:00Z","#,
            r#""quantity":"10","costBasis":"1000","acquisitionPrice":"100","acquisitionFees":"0","#,
            r#""fxRateToPosition":null,"fxRateToAccount":null,"accountCurrency":null,"#,
            r#""fxRateToBase":null,"baseCurrency":null},{"#,
            r#""id":"eu-buy-2","positionId":"POS-EUSTX-acc1","acquisitionDate":"2025-03-02T12:00:00Z","#,
            r#""quantity":"5","costBasis":"500","acquisitionPrice":"100","acquisitionFees":"0","#,
            r#""fxRateToPosition":null,"fxRateToAccount":null,"accountCurrency":null,"#,
            r#""fxRateToBase":null,"baseCurrency":null}],"#,
            r#""createdAt":"2025-01-02T12:00:00Z","lastUpdated":"2025-03-02T12:00:00Z"},"#,
            // (2) USD, identity control (no stored FX needed).
            r#""USTX":{"id":"POS-USTX-acc1","accountId":"acc1","assetId":"USTX","#,
            r#""quantity":"10","averageCost":"100","totalCostBasis":"1000","#,
            r#""currency":"USD","inceptionDate":"2025-01-02T12:00:00Z","lots":[{"#,
            r#""id":"us-buy-1","positionId":"POS-USTX-acc1","acquisitionDate":"2025-01-02T12:00:00Z","#,
            r#""quantity":"10","costBasis":"1000","acquisitionPrice":"100","acquisitionFees":"0","#,
            r#""fxRateToPosition":null,"fxRateToAccount":null,"accountCurrency":null,"#,
            r#""fxRateToBase":null,"baseCurrency":null}],"#,
            r#""createdAt":"2025-01-02T12:00:00Z","lastUpdated":"2025-01-02T12:00:00Z"},"#,
            // (3) EUR WITH stored per-lot FX (1.4) — must be used verbatim,
            // NOT the local FX table (which would yield 1.05 on this date).
            r#""EUSTX2":{"id":"POS-EUSTX2-acc1","accountId":"acc1","assetId":"EUSTX2","#,
            r#""quantity":"10","averageCost":"100","totalCostBasis":"1000","#,
            r#""currency":"EUR","inceptionDate":"2025-01-02T12:00:00Z","lots":[{"#,
            r#""id":"eu2-buy-1","positionId":"POS-EUSTX2-acc1","acquisitionDate":"2025-01-02T12:00:00Z","#,
            r#""quantity":"10","costBasis":"1000","acquisitionPrice":"100","acquisitionFees":"0","#,
            r#""fxRateToPosition":null,"fxRateToAccount":"1.4","accountCurrency":"USD","#,
            r#""fxRateToBase":"1.4","baseCurrency":"USD"}],"#,
            r#""createdAt":"2025-01-02T12:00:00Z","lastUpdated":"2025-01-02T12:00:00Z"}}"#
        )
        .replace('\'', "''");

        exec(
            pool,
            &format!(
                "INSERT INTO holdings_snapshots \
                 (id, account_id, snapshot_date, currency, positions, cash_balances, cost_basis, net_contribution, calculated_at, net_contribution_base, cash_total_account_currency, cash_total_base_currency, source) \
                 VALUES ('snapLocalFx', 'acc1', '2025-03-02', 'USD', '{positions}', '{{}}', '0', '0', '2025-03-02T00:00:00.000Z', '0', '0', '0', 'CALCULATED')"
            ),
        );
        for (asset, currency) in [("EUSTX", "EUR"), ("USTX", "USD"), ("EUSTX2", "EUR")] {
            exec(
                pool,
                &format!(
                    "INSERT INTO snapshot_positions \
                     (snapshot_id, asset_id, quantity, average_cost, total_cost_basis, currency, inception_date, is_alternative, contract_multiplier, created_at, last_updated, cost_basis_base, cost_basis_account) \
                     VALUES ('snapLocalFx', '{asset}', '10', '100', '1000', '{currency}', '2025-01-02T12:00:00Z', 0, '1', '2025-01-02T12:00:00Z', '2025-03-02T12:00:00Z', NULL, NULL)"
                ),
            );
        }
    }

    fn scalar_for(pool: &DbPool, asset: &str, column: &str) -> Option<Decimal> {
        nullable_scalar(
            pool,
            &format!(
                "SELECT COALESCE({column}, '__NULL__') AS value FROM snapshot_positions \
                 WHERE snapshot_id = 'snapLocalFx' AND asset_id = '{asset}'"
            ),
        )
        .map(|v| Decimal::from_str_exact(&v).unwrap())
    }

    /// The core hardening: a cross-currency position whose embedded lots LACK
    /// stored FX is backfilled from the LOCAL acquisition-date FX rate (not a
    /// valuation-date collapse, not NULL), while a same-currency control uses
    /// identity and a lot WITH stored FX still uses its stored rate unchanged.
    #[test]
    fn backfills_cross_currency_from_local_fx_when_lots_lack_stored_fx() {
        let db = setup_db();
        seed_common(&db.pool);
        seed_asset(&db.pool, "USTX", "USD");
        seed_asset(&db.pool, "EUSTX2", "EUR");
        // Local EUR->USD rates on the two acquisition dates. Distinct per date
        // so a correct per-lot resolution cannot collapse to one rate.
        seed_fx_rate(&db.pool, "EUR", "USD", "2025-01-02", "1.05");
        seed_fx_rate(&db.pool, "EUR", "USD", "2025-03-02", "1.20");
        seed_localfx_snapshot(&db.pool);

        let r1 = Decimal::from_str_exact("1.05").unwrap();
        let r2 = Decimal::from_str_exact("1.20").unwrap();
        // (1) EUR position: 1000*1.05 + 500*1.20 = 1650 in USD (account & base).
        let expected_eu = Decimal::from(1000) * r1 + Decimal::from(500) * r2;
        // A valuation-date-FX collapse (single rate for both lots) would differ.
        let collapse_eu = (Decimal::from(1000) + Decimal::from(500)) * r2; // 1800

        let outcome =
            strip_embedded_lots_migration(&db.pool, &db.db_path, &db.app_data_dir).unwrap();
        assert!(outcome.needed);
        assert_eq!(outcome.snapshots_migrated, 1);
        assert_eq!(outcome.positions_backfilled, 3);
        assert!(outcome.vacuumed);

        // (1) cross-currency, NO stored FX: resolved from the local FX table,
        // per-lot, non-NULL, not collapsed.
        let eu_base = scalar_for(&db.pool, "EUSTX", "cost_basis_base")
            .expect("EUSTX cost_basis_base must be backfilled, not NULL");
        let eu_account = scalar_for(&db.pool, "EUSTX", "cost_basis_account")
            .expect("EUSTX cost_basis_account must be backfilled, not NULL");
        assert_eq!(eu_base, expected_eu);
        assert_eq!(eu_account, expected_eu);
        assert_ne!(eu_base, collapse_eu, "must not collapse to a single valuation-date rate");

        // (2) same-currency control: identity -> 1000.
        assert_eq!(
            scalar_for(&db.pool, "USTX", "cost_basis_base").unwrap(),
            Decimal::from(1000)
        );
        assert_eq!(
            scalar_for(&db.pool, "USTX", "cost_basis_account").unwrap(),
            Decimal::from(1000)
        );

        // (3) stored-FX happy path: uses the stored 1.4 (=> 1400), NOT the
        // local table rate (which would give 1000*1.05 = 1050).
        let stored_base = scalar_for(&db.pool, "EUSTX2", "cost_basis_base").unwrap();
        assert_eq!(stored_base, Decimal::from(1400));
        assert_ne!(
            stored_base,
            Decimal::from(1000) * r1,
            "stored per-lot FX must win over the local FX table"
        );
        assert_eq!(
            scalar_for(&db.pool, "EUSTX2", "cost_basis_account").unwrap(),
            Decimal::from(1400)
        );

        // Lots stripped from the JSON.
        let stripped = scalar_text(
            &db.pool,
            "SELECT positions AS value FROM holdings_snapshots WHERE id = 'snapLocalFx'",
        )
        .unwrap();
        assert!(
            !stripped.contains("\"lots\""),
            "stripped JSON must omit the lots key entirely, got: {stripped}"
        );
    }
}
