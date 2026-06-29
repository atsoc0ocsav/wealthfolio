//! Central projector for transactional sync outbox appends.

use diesel::sqlite::SqliteConnection;
use serde_json::Value;
use wealthfolio_core::errors::Result;
use wealthfolio_core::sync::{SyncEntity, SyncOperation};

use super::repository::{insert_outbox_event, OutboxWriteRequest};
use crate::sync::SyncOutboxModel;

/// Captured mutation that can be projected to a sync outbox request at commit-time.
#[derive(Debug, Clone)]
pub(crate) struct ProjectedChange {
    pub entity: SyncEntity,
    pub subject_id: String,
    pub op: SyncOperation,
    pub payload: Value,
}

impl ProjectedChange {
    pub(crate) fn for_model<T: SyncOutboxModel>(model: &T, op: SyncOperation) -> Result<Self> {
        Ok(Self {
            entity: T::ENTITY,
            subject_id: model.sync_subject_id_owned(),
            op,
            payload: serde_json::to_value(model)?,
        })
    }

    pub(crate) fn delete_for_model<T: SyncOutboxModel>(subject_id: impl Into<String>) -> Self {
        let subject_id = subject_id.into();
        Self {
            entity: T::ENTITY,
            subject_id: subject_id.clone(),
            op: SyncOperation::Delete,
            payload: T::delete_payload(&subject_id),
        }
    }

    fn into_outbox_request(self) -> OutboxWriteRequest {
        OutboxWriteRequest::new(self.entity, self.subject_id, self.op, self.payload)
    }
}

pub(crate) fn flush_projected_outbox(
    conn: &mut SqliteConnection,
    requests: Vec<OutboxWriteRequest>,
    projected_changes: Vec<ProjectedChange>,
) -> Result<usize> {
    let mut inserted_count = 0;
    for request in requests.into_iter().chain(
        projected_changes
            .into_iter()
            .map(ProjectedChange::into_outbox_request),
    ) {
        insert_outbox_event(conn, request)?;
        inserted_count += 1;
    }
    Ok(inserted_count)
}
