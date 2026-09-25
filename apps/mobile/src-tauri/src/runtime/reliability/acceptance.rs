use std::sync::{Mutex, MutexGuard, OnceLock};

use serde::{Deserialize, Serialize};

use super::{ReliabilityError, ReliabilityResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReliabilityAcceptanceFault {
    None,
    HoldBeforeDispatch,
    LoseDispatchResponseAndReadback,
    FailCheckpointAcknowledgement,
}

impl ReliabilityAcceptanceFault {
    fn parse(value: &str) -> ReliabilityResult<Self> {
        match value {
            "none" => Ok(Self::None),
            "hold-before-dispatch" => Ok(Self::HoldBeforeDispatch),
            "lose-dispatch-response-and-readback" => Ok(Self::LoseDispatchResponseAndReadback),
            "fail-checkpoint-acknowledgement" => Ok(Self::FailCheckpointAcknowledgement),
            _ => Err(ReliabilityError::invalid(
                "unsupported reliability Acceptance fault",
            )),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::HoldBeforeDispatch => "hold-before-dispatch",
            Self::LoseDispatchResponseAndReadback => "lose-dispatch-response-and-readback",
            Self::FailCheckpointAcknowledgement => "fail-checkpoint-acknowledgement",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReliabilityAcceptanceFaultProjection {
    pub mode: String,
}

static ACTIVE_FAULT: OnceLock<Mutex<ReliabilityAcceptanceFault>> = OnceLock::new();

pub fn configure(mode: &str) -> ReliabilityResult<ReliabilityAcceptanceFaultProjection> {
    let fault = ReliabilityAcceptanceFault::parse(mode)?;
    *lock_fault()? = fault;
    Ok(ReliabilityAcceptanceFaultProjection {
        mode: fault.as_str().to_string(),
    })
}

pub fn hold_before_dispatch() -> ReliabilityResult<bool> {
    Ok(*lock_fault()? == ReliabilityAcceptanceFault::HoldBeforeDispatch)
}

pub fn lose_dispatch_response_and_readback() -> ReliabilityResult<bool> {
    Ok(*lock_fault()? == ReliabilityAcceptanceFault::LoseDispatchResponseAndReadback)
}

pub fn fail_checkpoint_acknowledgement() -> ReliabilityResult<bool> {
    Ok(*lock_fault()? == ReliabilityAcceptanceFault::FailCheckpointAcknowledgement)
}

fn lock_fault() -> ReliabilityResult<MutexGuard<'static, ReliabilityAcceptanceFault>> {
    ACTIVE_FAULT
        .get_or_init(|| Mutex::new(ReliabilityAcceptanceFault::None))
        .lock()
        .map_err(|_| ReliabilityError::corrupt("reliability Acceptance fault lock poisoned"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fault_modes_are_closed_and_explicitly_resettable() {
        configure("hold-before-dispatch").unwrap();
        assert!(hold_before_dispatch().unwrap());
        assert!(!lose_dispatch_response_and_readback().unwrap());

        configure("lose-dispatch-response-and-readback").unwrap();
        assert!(!hold_before_dispatch().unwrap());
        assert!(lose_dispatch_response_and_readback().unwrap());

        configure("fail-checkpoint-acknowledgement").unwrap();
        assert!(fail_checkpoint_acknowledgement().unwrap());

        configure("none").unwrap();
        assert!(!hold_before_dispatch().unwrap());
        assert!(!lose_dispatch_response_and_readback().unwrap());
        assert!(!fail_checkpoint_acknowledgement().unwrap());
        assert!(configure("unknown").is_err());
    }
}
