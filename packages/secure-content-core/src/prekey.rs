use rand::rngs::OsRng;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::{Zeroize, ZeroizeOnDrop};

pub const CONTENT_PREKEY_SIZE: usize = 32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ContentPreKeyPublic([u8; CONTENT_PREKEY_SIZE]);

impl ContentPreKeyPublic {
    pub fn from_bytes(bytes: [u8; CONTENT_PREKEY_SIZE]) -> Self {
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; CONTENT_PREKEY_SIZE] {
        &self.0
    }
}

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct ContentPreKeyPrivate([u8; CONTENT_PREKEY_SIZE]);

impl ContentPreKeyPrivate {
    pub fn from_bytes(bytes: [u8; CONTENT_PREKEY_SIZE]) -> Self {
        Self(bytes)
    }

    pub fn public_key(&self) -> ContentPreKeyPublic {
        let secret = StaticSecret::from(self.0);
        ContentPreKeyPublic(PublicKey::from(&secret).to_bytes())
    }

    pub(crate) fn as_bytes(&self) -> &[u8; CONTENT_PREKEY_SIZE] {
        &self.0
    }
}

pub struct ContentPreKeyPair {
    private: ContentPreKeyPrivate,
    public: ContentPreKeyPublic,
}

impl ContentPreKeyPair {
    pub fn generate() -> Self {
        let private = ContentPreKeyPrivate(StaticSecret::random_from_rng(OsRng).to_bytes());
        let public = private.public_key();
        Self { private, public }
    }

    pub fn from_private(private: ContentPreKeyPrivate) -> Self {
        let public = private.public_key();
        Self { private, public }
    }

    pub fn public(&self) -> ContentPreKeyPublic {
        self.public
    }

    pub fn private(&self) -> &ContentPreKeyPrivate {
        &self.private
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_the_expected_x25519_public_key() {
        let private = ContentPreKeyPrivate::from_bytes([7; 32]);
        assert_eq!(
            private.public_key().as_bytes(),
            &[
                19, 190, 79, 234, 234, 242, 4, 199, 253, 51, 88, 252, 156, 0, 114, 24, 129, 209,
                116, 39, 129, 40, 34, 126, 198, 116, 243, 127, 127, 233, 123, 109,
            ]
        );
    }
}
