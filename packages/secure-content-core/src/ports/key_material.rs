use crate::operation::OperationFailure;
use crate::recovery::RecoveryMaster;

pub trait ContentKeyMaterial: Send + Sync {
    fn recovery_master(
        &self,
        actor_ptid: &str,
        recovery_epoch: u64,
    ) -> Result<Option<RecoveryMaster>, OperationFailure>;

    fn sign_device_payload(&self, payload: &[u8]) -> Result<Vec<u8>, OperationFailure>;
}
