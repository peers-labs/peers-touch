pub trait KeyMaterial: Send + Sync {
    fn identity_key_pair(&self) -> Result<(Vec<u8>, Vec<u8>), String>;
    fn signing_key(&self) -> Result<Vec<u8>, String>;
    fn secure_random(&self, len: usize) -> Vec<u8>;
}
