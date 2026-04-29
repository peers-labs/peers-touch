//! Canonical desktop-side identity types.
//!
//! These types collapse the historical zoo of parallel DTOs (`AccountIdentity`,
//! `AuthSessionPayload`, `CurrentUser`, `SessionUser`, …) into a small set of
//! pure-domain primitives. They mirror the proto-level `ActorKind` / `ActorRef`
//! taxonomy planned for `model/domain/actor/actor.proto` (see PR-8).
//!
//! Status: **introduced in PR-2**, **not yet wired** anywhere. PR-3 migrates
//! every command to use these; PR-4 deletes the legacy duplicates.

use serde::{Deserialize, Serialize};

/// Mirrors station's PTID `AccountType` taxonomy + the network `Node` concept.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActorKind {
    Unspecified,
    /// PTID 'p' / ActivityPub `Person`. Default kind for human users.
    Person,
    /// PTID 'g' / ActivityPub `Group`.
    Group,
    /// PTID 'o' / ActivityPub `Organization`.
    Organization,
    /// PTID 's' / ActivityPub `Service`. Bots and agents backed by a service live here.
    Service,
    /// PTID 'a' / ActivityPub `Application`.
    Application,
    /// Network peer / station instance. Not an ActivityPub actor.
    Node,
}

impl Default for ActorKind {
    fn default() -> Self { ActorKind::Unspecified }
}

impl ActorKind {
    /// Decode the single-char PTID taxonomy string `p|g|o|s|a` (station-side).
    pub fn from_ptid_char(c: char) -> Self {
        match c {
            'p' => ActorKind::Person,
            'g' => ActorKind::Group,
            'o' => ActorKind::Organization,
            's' => ActorKind::Service,
            'a' => ActorKind::Application,
            _   => ActorKind::Unspecified,
        }
    }
}

/// Lightweight reference to a station actor. Every cross-domain API on the
/// desktop side (Tauri commands, application services, infrastructure callers)
/// passes `ActorRef` instead of bare `actor_id` strings.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ActorRef {
    /// Station-internal numeric id (Sonyflake), serialised as string for
    /// JSON safety on 32-bit clients.
    pub actor_id: String,
    /// Federated PTID string (`ptid:v1:actor:...`). Empty when the local
    /// account hasn't synced one yet.
    #[serde(default)]
    pub ptid: String,
    /// `@user@host` (ActivityPub webfinger). Empty when not yet known.
    #[serde(default)]
    pub acct: String,
    #[serde(default)]
    pub kind: ActorKind,
}

impl ActorRef {
    pub fn new_person(actor_id: impl Into<String>) -> Self {
        Self {
            actor_id: actor_id.into(),
            ptid: String::new(),
            acct: String::new(),
            kind: ActorKind::Person,
        }
    }
}

/// Device-side projection of a single actor. Maps 1:1 to a row inside
/// `identities.json` — but the data shape is intentionally narrower so the
/// domain layer can hide on-disk encoding choices.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAccount {
    /// Local account id, e.g. `password:123` or `github:456`.
    pub id: String,
    pub actor: ActorRef,
    pub display_name: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub avatar_url: String,
    /// Provider tag the user authenticated through (`password`, `github`, …).
    pub provider: String,
    /// Whether this account requires a PIN to unlock its persisted session.
    pub has_pin: bool,
    /// Whether a restorable session blob is stored for this account.
    pub has_session: bool,
}

/// In-memory binding between a Tauri window and the actor it speaks for.
/// One per window. Tokens live here and **never** touch disk in plaintext
/// after PR-4.
#[derive(Debug, Clone)]
pub struct ActiveSession {
    pub window_label: String,
    pub account_id: String,
    pub actor: ActorRef,
    pub jwt: String,
}

impl ActiveSession {
    pub fn new(window_label: impl Into<String>, account_id: impl Into<String>, actor: ActorRef, jwt: impl Into<String>) -> Self {
        Self {
            window_label: window_label.into(),
            account_id: account_id.into(),
            actor,
            jwt: jwt.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ptid_char_decode_covers_all_known_kinds() {
        assert_eq!(ActorKind::from_ptid_char('p'), ActorKind::Person);
        assert_eq!(ActorKind::from_ptid_char('g'), ActorKind::Group);
        assert_eq!(ActorKind::from_ptid_char('o'), ActorKind::Organization);
        assert_eq!(ActorKind::from_ptid_char('s'), ActorKind::Service);
        assert_eq!(ActorKind::from_ptid_char('a'), ActorKind::Application);
        assert_eq!(ActorKind::from_ptid_char('z'), ActorKind::Unspecified);
    }

    #[test]
    fn actor_ref_new_person_defaults_kind_to_person() {
        let r = ActorRef::new_person("42");
        assert_eq!(r.actor_id, "42");
        assert_eq!(r.kind, ActorKind::Person);
        assert!(r.ptid.is_empty());
    }

    #[test]
    fn actor_kind_serialises_to_snake_case() {
        let json = serde_json::to_string(&ActorKind::Organization).unwrap();
        assert_eq!(json, "\"organization\"");
    }
}
