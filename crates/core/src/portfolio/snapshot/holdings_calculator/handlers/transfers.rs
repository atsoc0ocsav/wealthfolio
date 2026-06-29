//! Transfer handlers (TRANSFER_IN / TRANSFER_OUT). `impl HoldingsCalculator`.
use super::super::economics::*;
use super::super::{HoldingsCalculator, ProjectionRun, SideEffectBuffer};
use crate::activities::Activity;
use crate::errors::Result;
use crate::portfolio::economic_events::{ActivityEconomicsResolver, TransferBoundary};
use crate::portfolio::snapshot::AccountStateSnapshot;
use log::warn;
use rust_decimal::Decimal;

impl HoldingsCalculator {
    /// Handle TRANSFER_IN activity.
    /// Books cash/asset inflow in ACTIVITY currency.
    /// Transfers always affect account-level net_contribution; portfolio boundary is handled by aggregation.
    pub(crate) fn handle_transfer_in(
        &self,
        activity: &Activity,
        state: &mut AccountStateSnapshot,
        account_currency: &str,
        asset_cache: &mut AssetCache,
        run: &ProjectionRun,
        buffer: &mut SideEffectBuffer,
    ) -> Result<()> {
        let activity_currency = &activity.currency;
        let activity_amount = activity.amt();
        let asset_id = activity.asset_id.as_deref().unwrap_or("");

        if asset_id.is_empty() {
            // Cash transfer: book in ACTIVITY currency
            let net_amount = activity_amount - activity.fee_amt();
            add_cash(state, activity_currency, net_amount);

            let activity_date = self.activity_local_date(activity);
            let amount_acct = self.convert_to_account_currency(
                activity_amount,
                activity,
                account_currency,
                "TransferIn Cash",
            );

            let base_ccy = self.base_currency.read().unwrap();
            let amount_base = match self.fx_service.convert_currency_for_date(
                activity_amount,
                activity_currency,
                &base_ccy,
                activity_date,
            ) {
                Ok(c) => c,
                Err(e) => {
                    warn!(
                        "Holdings Calc (NetContrib TransferIn Cash {}): Failed conversion {}: {}.",
                        activity.id, activity_currency, e
                    );
                    Decimal::ZERO
                }
            };

            state.net_contribution += amount_acct;
            state.net_contribution_base += amount_base;
        } else {
            // Asset transfer
            let activity_date = self.activity_local_date(activity);

            let position = self.get_or_create_position_mut_cached(
                state,
                asset_id,
                activity_currency,
                activity.activity_date,
                asset_cache,
            )?;

            let position_currency = position.currency.clone();
            let needs_conversion =
                !position_currency.is_empty() && position_currency != activity.currency;
            let asset_info = asset_cache
                .get(asset_id)
                .cloned()
                .unwrap_or_else(|| AssetPositionInfo::fallback(activity_currency));

            // Try lot-level transfer: peek cached lots from the paired
            // TRANSFER_OUT. Stage the cache removal in the buffer so it is only
            // committed if this TRANSFER_IN succeeds — a failed TRANSFER_IN must
            // not consume the cached lots.
            let cached_lots = activity.source_group_id.as_ref().and_then(|group_id| {
                let lots = run.transfer_lots_cache.get(group_id).cloned();
                if lots.is_some() {
                    buffer.transfer_cache_removals.push(group_id.clone());
                }
                lots
            });

            let (cost_basis_asset_curr, added_lots) = if let Some(lots) = cached_lots {
                // Lot-level transfer: lots are already in the asset's position currency
                // (same asset = same listing currency), so no FX conversion needed.
                let cost_basis = position.add_transferred_lots(
                    &activity.id,
                    &lots,
                    None,
                    asset_info.allows_negative_lots,
                )?;
                let added_lots: Vec<crate::portfolio::snapshot::Lot> = position
                    .lots
                    .iter()
                    .filter(|lot| lot.source_activity_id.as_deref() == Some(activity.id.as_str()))
                    .cloned()
                    .collect();
                (cost_basis, added_lots)
            } else {
                // Fallback: no cached lots (external transfer or no source_group_id).
                // Use the activity's unit_price as the acquisition price.
                if activity.source_group_id.is_some() {
                    warn!(
                        "TransferIn {} has source_group_id but no cached lots from paired TransferOut. \
                         Using unit_price fallback (cost basis may be inaccurate).",
                        activity.id
                    );
                }
                let compiled_economics =
                    ActivityEconomicsResolver::compile_activity_with_unit_multiplier(
                        activity,
                        None,
                        TransferBoundary::External,
                        asset_info.contract_multiplier,
                    );
                let lot_unit_price = if activity.qty().is_zero() {
                    Decimal::ZERO
                } else {
                    compiled_economics.lot_cost_basis_value / activity.qty()
                };
                let (unit_price_for_lot, fee_for_lot, fx_rate_used) = if needs_conversion {
                    let (converted_price, converted_fee, fx_rate) = self
                        .convert_to_position_currency(
                            lot_unit_price,
                            activity.fee_amt(),
                            activity,
                            &position_currency,
                            account_currency,
                        )?;
                    (converted_price, converted_fee, fx_rate)
                } else {
                    (lot_unit_price, activity.fee_amt(), None)
                };

                let book_basis = self.lot_book_basis_for_activity(
                    activity,
                    &position_currency,
                    account_currency,
                );
                let cost_basis = position.add_lot_values(
                    activity.id.clone(),
                    activity.qty(),
                    unit_price_for_lot,
                    fee_for_lot,
                    activity.activity_date,
                    fx_rate_used,
                    Some(activity.id.clone()),
                    book_basis,
                )?;
                let added_lots: Vec<crate::portfolio::snapshot::Lot> = position
                    .lots
                    .iter()
                    .filter(|lot| lot.source_activity_id.as_deref() == Some(activity.id.as_str()))
                    .cloned()
                    .collect();
                (cost_basis, added_lots)
            };

            // Book fee in ACTIVITY currency
            add_cash(state, activity_currency, -activity.fee_amt());

            let cost_basis_acct = if added_lots.is_empty() {
                self.convert_position_amount_to_account_currency(
                    cost_basis_asset_curr,
                    &position_currency,
                    activity,
                    account_currency,
                    "Net Deposit TransferIn Asset",
                )
            } else {
                self.lots_cost_basis_in_currency(
                    &added_lots,
                    &position_currency,
                    account_currency,
                    activity_date,
                    &activity.id,
                )
            };
            let base_ccy = self.base_currency.read().unwrap().clone();
            let cost_basis_base = if added_lots.is_empty() {
                match self.fx_service.convert_currency_for_date(
                    cost_basis_asset_curr,
                    &position_currency,
                    &base_ccy,
                    activity_date,
                ) {
                    Ok(converted) => converted,
                    Err(e) => {
                        warn!(
                            "Holdings Calc (NetContribBase TransferIn Asset {}): Failed conversion: {}.",
                            activity.id, e
                        );
                        cost_basis_asset_curr
                    }
                }
            } else {
                self.lots_cost_basis_in_currency(
                    &added_lots,
                    &position_currency,
                    &base_ccy,
                    activity_date,
                    &activity.id,
                )
            };

            state.net_contribution += cost_basis_acct;
            state.net_contribution_base += cost_basis_base;
        }
        Ok(())
    }

    /// Handle TRANSFER_OUT activity.
    /// Books cash/asset outflow in ACTIVITY currency.
    /// Transfers always affect account-level net_contribution; portfolio boundary is handled by aggregation.
    pub(crate) fn handle_transfer_out(
        &self,
        activity: &Activity,
        state: &mut AccountStateSnapshot,
        account_currency: &str,
        _asset_cache: &mut AssetCache,
        run: &ProjectionRun,
        buffer: &mut SideEffectBuffer,
    ) -> Result<()> {
        let activity_currency = &activity.currency;
        let activity_date = self.activity_local_date(activity);
        // Use absolute value - activity type dictates direction
        let activity_amount = -activity.amt().abs();
        let asset_id = activity.asset_id.as_deref().unwrap_or("");

        if asset_id.is_empty() {
            // Cash transfer: book outflow in ACTIVITY currency (amount + fee)
            let net_amount = activity_amount - activity.fee_amt();
            add_cash(state, activity_currency, net_amount);

            let amount_acct = self.convert_to_account_currency(
                activity_amount,
                activity,
                account_currency,
                "TransferOut Cash",
            );

            let base_ccy = self.base_currency.read().unwrap();
            let amount_base = match self.fx_service.convert_currency_for_date(
                activity_amount,
                activity_currency,
                &base_ccy,
                activity_date,
            ) {
                Ok(c) => c,
                Err(e) => {
                    warn!(
                        "Holdings Calc (NetContrib TransferOut Cash {}): Failed conversion {}: {}.",
                        activity.id, activity_currency, e
                    );
                    Decimal::ZERO
                }
            };

            state.net_contribution += amount_acct;
            state.net_contribution_base += amount_base;
        } else {
            // Asset transfer
            let activity_date = self.activity_local_date(activity);

            // Book fee in ACTIVITY currency
            add_cash(state, activity_currency, -activity.fee_amt());

            if let Some(position) = state.positions.get_mut(asset_id) {
                let position_currency = position.currency.clone();
                if position_currency.is_empty() {
                    warn!(
                        "Position {} being transferred out has no currency set.",
                        position.id
                    );
                }

                let reduction = if position.quantity.is_sign_negative() {
                    position.reduce_negative_lots_fifo(activity.qty())?
                } else {
                    position.reduce_lots_fifo(activity.qty())?
                };
                let cost_basis_removed = reduction.cost_basis_removed;
                self.record_lot_disposals(
                    &state.account_id,
                    asset_id,
                    activity,
                    &reduction.removed_lots,
                    cost_basis_removed,
                    reduction.quantity_reduced,
                    &position_currency,
                    run,
                    buffer,
                );

                // Record fully consumed lots as closed
                let close_date = activity_date.to_string();
                for lot in &reduction.fully_consumed_lots {
                    self.record_lot_closure(
                        &state.account_id,
                        asset_id,
                        lot,
                        &close_date,
                        &activity.id,
                        &position_currency,
                        run,
                        buffer,
                    );
                }

                if !position_currency.is_empty() && cost_basis_removed != Decimal::ZERO {
                    let cost_basis_removed_acct = self.lots_cost_basis_in_currency(
                        &reduction.removed_lots,
                        &position_currency,
                        account_currency,
                        activity_date,
                        &activity.id,
                    );

                    let base_ccy = self.base_currency.read().unwrap().clone();
                    let cost_basis_removed_base = self.lots_cost_basis_in_currency(
                        &reduction.removed_lots,
                        &position_currency,
                        &base_ccy,
                        activity_date,
                        &activity.id,
                    );

                    state.net_contribution -= cost_basis_removed_acct;
                    state.net_contribution_base -= cost_basis_removed_base;
                }

                // Stage removed lots for the paired TRANSFER_IN (lot-level
                // transfer). Committed to the cache only if this TRANSFER_OUT
                // succeeds.
                if let Some(ref group_id) = activity.source_group_id {
                    if !reduction.removed_lots.is_empty() {
                        buffer
                            .transfer_cache_inserts
                            .push((group_id.clone(), reduction.removed_lots));
                    }
                }
            } else {
                warn!(
                    "Attempted to TransferOut non-existent position {} via activity {}. Fee applied only.",
                    asset_id, activity.id
                );
            }
        }
        Ok(())
    }
}
