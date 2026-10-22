use crate::contracts::CryptoEndpoint;
use crate::ports::LifecycleCancellation;
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i32)]
pub enum EnginePhase {
    Inactive = 1,
    Starting = 2,
    Active = 3,
    Suspended = 4,
    Stopping = 5,
    Failed = 6,
}

impl TryFrom<i32> for EnginePhase {
    type Error = EngineLifecycleError;

    fn try_from(value: i32) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::Inactive),
            2 => Ok(Self::Starting),
            3 => Ok(Self::Active),
            4 => Ok(Self::Suspended),
            5 => Ok(Self::Stopping),
            6 => Ok(Self::Failed),
            _ => Err(invalid_record("messaging engine phase is invalid")),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EngineLifecycleErrorCode {
    InvalidRecord,
    InvalidTransition,
    StaleLifecycleGeneration,
    LostWorkerLease,
    Cancelled,
}

impl EngineLifecycleErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidRecord => "INVALID_RECORD",
            Self::InvalidTransition => "INVALID_TRANSITION",
            Self::StaleLifecycleGeneration => "STALE_LIFECYCLE_GENERATION",
            Self::LostWorkerLease => "LOST_WORKER_LEASE",
            Self::Cancelled => "CANCELLED",
        }
    }
}

#[derive(Clone, Debug, Error, PartialEq, Eq)]
#[error("{code}: {detail}", code = .code.as_str())]
pub struct EngineLifecycleError {
    pub code: EngineLifecycleErrorCode,
    pub detail: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EngineLifecycleRecord {
    pub endpoint: CryptoEndpoint,
    pub station_peer_id: String,
    pub phase: EnginePhase,
    pub lifecycle_generation: u64,
    pub worker_generation: u64,
    pub consumer_epoch: u64,
    pub updated_at_unix_ms: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EngineFence {
    pub lifecycle_generation: u64,
    pub worker_generation: u64,
}

impl EngineLifecycleRecord {
    pub fn inactive(
        endpoint: CryptoEndpoint,
        station_peer_id: impl Into<String>,
        now_unix_ms: i64,
    ) -> Result<Self, EngineLifecycleError> {
        let record = Self {
            endpoint,
            station_peer_id: station_peer_id.into(),
            phase: EnginePhase::Inactive,
            lifecycle_generation: 0,
            worker_generation: 0,
            consumer_epoch: 0,
            updated_at_unix_ms: now_unix_ms,
        };
        record.validate()?;
        Ok(record)
    }

    pub fn fence(&self) -> EngineFence {
        EngineFence {
            lifecycle_generation: self.lifecycle_generation,
            worker_generation: self.worker_generation,
        }
    }

    pub fn validate(&self) -> Result<(), EngineLifecycleError> {
        self.endpoint.validate().map_err(invalid_record)?;
        if !valid_identifier(&self.station_peer_id) || self.updated_at_unix_ms <= 0 {
            return Err(invalid_record(
                "messaging engine lifecycle record is incomplete",
            ));
        }
        match self.phase {
            EnginePhase::Inactive => {
                if self.worker_generation != 0 || self.consumer_epoch != 0 {
                    return Err(invalid_record(
                        "inactive messaging engine cannot retain worker ownership",
                    ));
                }
            }
            EnginePhase::Starting
            | EnginePhase::Active
            | EnginePhase::Suspended
            | EnginePhase::Stopping
            | EnginePhase::Failed => {
                if self.lifecycle_generation == 0 || self.worker_generation == 0 {
                    return Err(invalid_record(
                        "owned messaging engine lifecycle requires generation fences",
                    ));
                }
            }
        }
        Ok(())
    }
}

pub fn activate_engine(
    current: &EngineLifecycleRecord,
    cancellation: &dyn LifecycleCancellation,
    now_unix_ms: i64,
) -> Result<EngineLifecycleRecord, EngineLifecycleError> {
    current.validate()?;
    ensure_not_cancelled(cancellation)?;
    if !matches!(current.phase, EnginePhase::Inactive | EnginePhase::Failed)
        || now_unix_ms <= current.updated_at_unix_ms
    {
        return Err(invalid_transition(
            "messaging engine cannot acquire a worker from its current phase",
        ));
    }

    let mut activated = current.clone();
    activated.phase = EnginePhase::Starting;
    activated.lifecycle_generation = activated
        .lifecycle_generation
        .checked_add(1)
        .ok_or_else(|| invalid_record("messaging lifecycle generation is exhausted"))?;
    activated.worker_generation = activated
        .worker_generation
        .checked_add(1)
        .ok_or_else(|| invalid_record("messaging worker generation is exhausted"))?;
    activated.consumer_epoch = 0;
    activated.updated_at_unix_ms = now_unix_ms;
    activated.validate()?;
    Ok(activated)
}

pub fn complete_engine_start(
    current: &EngineLifecycleRecord,
    fence: EngineFence,
    initial_consumer_epoch: u64,
    now_unix_ms: i64,
) -> Result<EngineLifecycleRecord, EngineLifecycleError> {
    current.validate()?;
    validate_engine_fence(current, fence)?;
    if current.phase != EnginePhase::Starting || now_unix_ms <= current.updated_at_unix_ms {
        return Err(invalid_transition(
            "messaging engine start cannot complete from its current state",
        ));
    }

    let mut active = current.clone();
    active.phase = EnginePhase::Active;
    active.consumer_epoch = initial_consumer_epoch;
    active.updated_at_unix_ms = now_unix_ms;
    active.validate()?;
    Ok(active)
}

pub fn resume_engine(
    current: &EngineLifecycleRecord,
    fence: EngineFence,
    cancellation: &dyn LifecycleCancellation,
    now_unix_ms: i64,
) -> Result<EngineLifecycleRecord, EngineLifecycleError> {
    current.validate()?;
    validate_engine_fence(current, fence)?;
    ensure_not_cancelled(cancellation)?;
    if current.phase != EnginePhase::Suspended || now_unix_ms <= current.updated_at_unix_ms {
        return Err(invalid_transition(
            "messaging engine cannot resume from its current state",
        ));
    }

    let mut active = current.clone();
    active.phase = EnginePhase::Active;
    active.updated_at_unix_ms = now_unix_ms;
    active.validate()?;
    Ok(active)
}

pub fn suspend_engine(
    current: &EngineLifecycleRecord,
    fence: EngineFence,
    consumer_epoch: u64,
    now_unix_ms: i64,
) -> Result<EngineLifecycleRecord, EngineLifecycleError> {
    current.validate()?;
    validate_engine_fence(current, fence)?;
    if !matches!(current.phase, EnginePhase::Starting | EnginePhase::Active)
        || consumer_epoch < current.consumer_epoch
        || now_unix_ms <= current.updated_at_unix_ms
    {
        return Err(invalid_transition(
            "messaging engine cannot suspend from its current state",
        ));
    }

    let mut suspended = current.clone();
    suspended.phase = EnginePhase::Suspended;
    suspended.consumer_epoch = consumer_epoch;
    suspended.updated_at_unix_ms = now_unix_ms;
    suspended.validate()?;
    Ok(suspended)
}

pub fn begin_engine_stop(
    current: &EngineLifecycleRecord,
    fence: EngineFence,
    now_unix_ms: i64,
) -> Result<EngineLifecycleRecord, EngineLifecycleError> {
    current.validate()?;
    validate_engine_fence(current, fence)?;
    if matches!(current.phase, EnginePhase::Inactive | EnginePhase::Stopping)
        || now_unix_ms <= current.updated_at_unix_ms
    {
        return Err(invalid_transition(
            "messaging engine cannot begin stopping from its current state",
        ));
    }

    let mut stopping = current.clone();
    stopping.phase = EnginePhase::Stopping;
    stopping.updated_at_unix_ms = now_unix_ms;
    stopping.validate()?;
    Ok(stopping)
}

pub fn complete_engine_stop(
    current: &EngineLifecycleRecord,
    fence: EngineFence,
    now_unix_ms: i64,
) -> Result<EngineLifecycleRecord, EngineLifecycleError> {
    current.validate()?;
    validate_engine_fence(current, fence)?;
    if matches!(current.phase, EnginePhase::Inactive) || now_unix_ms <= current.updated_at_unix_ms {
        return Err(invalid_transition(
            "messaging engine stop cannot complete from its current state",
        ));
    }

    let mut stopped = current.clone();
    stopped.phase = EnginePhase::Inactive;
    stopped.worker_generation = 0;
    stopped.consumer_epoch = 0;
    stopped.updated_at_unix_ms = now_unix_ms;
    stopped.validate()?;
    Ok(stopped)
}

pub fn validate_active_engine(
    current: &EngineLifecycleRecord,
    fence: EngineFence,
    cancellation: &dyn LifecycleCancellation,
) -> Result<(), EngineLifecycleError> {
    current.validate()?;
    validate_engine_fence(current, fence)?;
    ensure_not_cancelled(cancellation)?;
    if current.phase != EnginePhase::Active {
        return Err(invalid_transition(
            "messaging engine does not own active work in its current phase",
        ));
    }
    Ok(())
}

pub fn advance_engine_consumer_epoch(
    current: &EngineLifecycleRecord,
    fence: EngineFence,
    consumer_epoch: u64,
) -> Result<EngineLifecycleRecord, EngineLifecycleError> {
    current.validate()?;
    validate_engine_fence(current, fence)?;
    if current.phase != EnginePhase::Active || consumer_epoch < current.consumer_epoch {
        return Err(invalid_transition(
            "messaging engine consumer epoch cannot advance from its current state",
        ));
    }

    let mut advanced = current.clone();
    advanced.consumer_epoch = consumer_epoch;
    advanced.validate()?;
    Ok(advanced)
}

pub fn recover_interrupted_engine(
    current: &EngineLifecycleRecord,
    now_unix_ms: i64,
) -> Result<EngineLifecycleRecord, EngineLifecycleError> {
    current.validate()?;
    if now_unix_ms <= current.updated_at_unix_ms {
        return Err(invalid_transition(
            "messaging engine recovery clock did not advance",
        ));
    }
    if matches!(current.phase, EnginePhase::Inactive | EnginePhase::Failed) {
        return Ok(current.clone());
    }

    let mut recovered = current.clone();
    recovered.phase = EnginePhase::Failed;
    recovered.updated_at_unix_ms = now_unix_ms;
    recovered.validate()?;
    Ok(recovered)
}

pub fn validate_engine_fence(
    current: &EngineLifecycleRecord,
    fence: EngineFence,
) -> Result<(), EngineLifecycleError> {
    if fence.lifecycle_generation != current.lifecycle_generation {
        return Err(EngineLifecycleError {
            code: EngineLifecycleErrorCode::StaleLifecycleGeneration,
            detail: "messaging lifecycle generation no longer owns the engine".to_string(),
        });
    }
    if fence.worker_generation != current.worker_generation {
        return Err(EngineLifecycleError {
            code: EngineLifecycleErrorCode::LostWorkerLease,
            detail: "messaging worker generation no longer owns the engine".to_string(),
        });
    }
    Ok(())
}

fn ensure_not_cancelled(
    cancellation: &dyn LifecycleCancellation,
) -> Result<(), EngineLifecycleError> {
    if cancellation.is_cancelled() {
        Err(EngineLifecycleError {
            code: EngineLifecycleErrorCode::Cancelled,
            detail: "messaging lifecycle cancelled engine activation".to_string(),
        })
    } else {
        Ok(())
    }
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty() && value.trim() == value
}

fn invalid_record(detail: impl Into<String>) -> EngineLifecycleError {
    EngineLifecycleError {
        code: EngineLifecycleErrorCode::InvalidRecord,
        detail: detail.into(),
    }
}

fn invalid_transition(detail: impl Into<String>) -> EngineLifecycleError {
    EngineLifecycleError {
        code: EngineLifecycleErrorCode::InvalidTransition,
        detail: detail.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Cancellation(bool);

    impl LifecycleCancellation for Cancellation {
        fn is_cancelled(&self) -> bool {
            self.0
        }
    }

    fn inactive() -> EngineLifecycleRecord {
        EngineLifecycleRecord::inactive(
            CryptoEndpoint::new("ptid:alice", "device-1").unwrap(),
            "station-1",
            10,
        )
        .unwrap()
    }

    #[test]
    fn activation_acquires_monotonic_lifecycle_and_worker_fences() {
        let starting = activate_engine(&inactive(), &Cancellation(false), 11).unwrap();

        assert_eq!(starting.phase, EnginePhase::Starting);
        assert_eq!(starting.lifecycle_generation, 1);
        assert_eq!(starting.worker_generation, 1);
        assert_eq!(starting.consumer_epoch, 0);
    }

    #[test]
    fn activation_fails_closed_when_lifecycle_is_cancelled() {
        let error = activate_engine(&inactive(), &Cancellation(true), 11).unwrap_err();

        assert_eq!(error.code, EngineLifecycleErrorCode::Cancelled);
    }

    #[test]
    fn stale_fences_cannot_suspend_or_stop_a_new_worker() {
        let starting = activate_engine(&inactive(), &Cancellation(false), 11).unwrap();

        assert_eq!(
            suspend_engine(
                &starting,
                EngineFence {
                    lifecycle_generation: 0,
                    worker_generation: 1,
                },
                1,
                12,
            )
            .unwrap_err()
            .code,
            EngineLifecycleErrorCode::StaleLifecycleGeneration
        );
        assert_eq!(
            complete_engine_stop(
                &starting,
                EngineFence {
                    lifecycle_generation: 1,
                    worker_generation: 2,
                },
                12,
            )
            .unwrap_err()
            .code,
            EngineLifecycleErrorCode::LostWorkerLease
        );
    }

    #[test]
    fn suspension_preserves_the_latest_consumer_epoch() {
        let starting = activate_engine(&inactive(), &Cancellation(false), 11).unwrap();
        let active = complete_engine_start(&starting, starting.fence(), 3, 12).unwrap();
        let suspended = suspend_engine(&active, active.fence(), 7, 13).unwrap();

        assert_eq!(suspended.phase, EnginePhase::Suspended);
        assert_eq!(suspended.consumer_epoch, 7);
    }

    #[test]
    fn start_and_resume_use_the_same_owned_worker_fence() {
        let starting = activate_engine(&inactive(), &Cancellation(false), 11).unwrap();
        let active = complete_engine_start(&starting, starting.fence(), 3, 12).unwrap();
        let suspended = suspend_engine(&active, active.fence(), 7, 13).unwrap();
        let resumed =
            resume_engine(&suspended, suspended.fence(), &Cancellation(false), 14).unwrap();

        assert_eq!(active.phase, EnginePhase::Active);
        assert_eq!(resumed.phase, EnginePhase::Active);
        assert_eq!(resumed.fence(), starting.fence());
        assert_eq!(resumed.consumer_epoch, 7);
    }

    #[test]
    fn resume_honors_lifecycle_cancellation() {
        let starting = activate_engine(&inactive(), &Cancellation(false), 11).unwrap();
        let suspended = suspend_engine(&starting, starting.fence(), 0, 12).unwrap();

        assert_eq!(
            resume_engine(&suspended, suspended.fence(), &Cancellation(true), 13)
                .unwrap_err()
                .code,
            EngineLifecycleErrorCode::Cancelled
        );
    }

    #[test]
    fn stop_releases_worker_ownership_without_reusing_generation() {
        let starting = activate_engine(&inactive(), &Cancellation(false), 11).unwrap();
        let active = complete_engine_start(&starting, starting.fence(), 1, 12).unwrap();
        let stopping = begin_engine_stop(&active, active.fence(), 13).unwrap();
        let stopped = complete_engine_stop(&stopping, stopping.fence(), 14).unwrap();
        let restarted = activate_engine(&stopped, &Cancellation(false), 15).unwrap();

        assert_eq!(stopped.phase, EnginePhase::Inactive);
        assert_eq!(stopped.worker_generation, 0);
        assert_eq!(restarted.lifecycle_generation, 2);
        assert_eq!(restarted.worker_generation, 1);
    }

    #[test]
    fn interrupted_owned_phase_becomes_failed_before_reactivation() {
        let starting = activate_engine(&inactive(), &Cancellation(false), 11).unwrap();
        let recovered = recover_interrupted_engine(&starting, 12).unwrap();

        assert_eq!(recovered.phase, EnginePhase::Failed);
        let restarted = activate_engine(&recovered, &Cancellation(false), 13).unwrap();
        assert_eq!(restarted.lifecycle_generation, 2);
        assert_eq!(restarted.worker_generation, 2);
    }

    #[test]
    fn active_work_requires_current_fence_and_live_cancellation() {
        let starting = activate_engine(&inactive(), &Cancellation(false), 11).unwrap();
        let active = complete_engine_start(&starting, starting.fence(), 1, 12).unwrap();

        validate_active_engine(&active, active.fence(), &Cancellation(false)).unwrap();
        assert_eq!(
            validate_active_engine(&active, active.fence(), &Cancellation(true))
                .unwrap_err()
                .code,
            EngineLifecycleErrorCode::Cancelled
        );
        let stopping = begin_engine_stop(&active, active.fence(), 13).unwrap();
        assert_eq!(
            validate_active_engine(&stopping, stopping.fence(), &Cancellation(false))
                .unwrap_err()
                .code,
            EngineLifecycleErrorCode::InvalidTransition
        );
    }

    #[test]
    fn consumer_epoch_advances_monotonically_under_the_worker_fence() {
        let starting = activate_engine(&inactive(), &Cancellation(false), 11).unwrap();
        let active = complete_engine_start(&starting, starting.fence(), 1, 12).unwrap();
        let advanced = advance_engine_consumer_epoch(&active, active.fence(), 3).unwrap();

        assert_eq!(advanced.consumer_epoch, 3);
        assert_eq!(
            advance_engine_consumer_epoch(&advanced, advanced.fence(), 2)
                .unwrap_err()
                .code,
            EngineLifecycleErrorCode::InvalidTransition
        );
    }
}
