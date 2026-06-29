mod model;
pub mod repository;

pub(crate) use model::{AllocationTargetDB, AllocationTargetWeightDB, AllocationTargetConstraintDB};
pub use repository::AllocationTargetRepository;
