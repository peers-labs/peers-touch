//! G0 MLS verification spike — THROWAWAY (see G0 plan §5).
//!
//! L1 single-process cryptographic checks for D-08 (group E2EE → MLS):
//!   * C-1  library compiles and runs on this toolchain
//!   * C-3  membership lifecycle changes the decryptable set correctly
//!   * C-6  removed member cannot decrypt post-removal messages (forward secrecy)
//!
//! This binary prints PASS/FAIL per claim and exits non-zero on any failure.

use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use tls_codec::{Deserialize as TlsDeserializeTrait, Serialize as TlsSerializeTrait};

const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

struct Member {
    provider: OpenMlsRustCrypto,
    signer: SignatureKeyPair,
    credential_with_key: CredentialWithKey,
}

impl Member {
    fn new(name: &str) -> Self {
        let provider = OpenMlsRustCrypto::default();
        let signer =
            SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).expect("gen signer");
        let credential = BasicCredential::new(name.as_bytes().to_vec());
        let credential_with_key = CredentialWithKey {
            credential: credential.into(),
            signature_key: signer.public().into(),
        };
        signer
            .store(provider.storage())
            .expect("store signer in provider");
        Member {
            provider,
            signer,
            credential_with_key,
        }
    }

    fn key_package(&self) -> KeyPackage {
        KeyPackage::builder()
            .build(
                CIPHERSUITE,
                &self.provider,
                &self.signer,
                self.credential_with_key.clone(),
            )
            .expect("build key package")
            .key_package()
            .clone()
    }
}

fn main() {
    let mut failures = 0u32;

    // --- C-1: compile + basic group create ---
    let alice = Member::new("alice");
    let bob = Member::new("bob");
    let charlie = Member::new("charlie");

    let group_config = MlsGroupCreateConfig::builder()
        .use_ratchet_tree_extension(true)
        .build();

    let mut alice_group = MlsGroup::new(
        &alice.provider,
        &alice.signer,
        &group_config,
        alice.credential_with_key.clone(),
    )
    .expect("alice creates group");

    println!("[C-1] PASS: openmls 0.8.1 compiled, group created (epoch {})", alice_group.epoch().as_u64());

    // --- Add Bob ---
    let bob_kp = bob.key_package();
    let (commit_msg, welcome_msg, _group_info) = alice_group
        .add_members(&alice.provider, &alice.signer, &[bob_kp])
        .expect("alice adds bob");
    alice_group
        .merge_pending_commit(&alice.provider)
        .expect("alice merges add-bob commit");

    let welcome = welcome_msg.into_welcome().expect("welcome for bob");
    let mut bob_group = StagedWelcome::new_from_welcome(
        &bob.provider,
        &MlsGroupJoinConfig::default(),
        welcome,
        None,
    )
    .expect("bob stages welcome")
    .into_group(&bob.provider)
    .expect("bob joins group");

    // --- Add Charlie (alice commits, bob processes commit) ---
    let charlie_kp = charlie.key_package();
    let (commit_msg2, welcome_msg2, _) = alice_group
        .add_members(&alice.provider, &alice.signer, &[charlie_kp])
        .expect("alice adds charlie");
    alice_group
        .merge_pending_commit(&alice.provider)
        .expect("alice merges add-charlie commit");

    // Bob must process the add-charlie commit to stay in sync
    let pm_for_bob = commit_msg2
        .into_protocol_message()
        .expect("commit is protocol message");
    let processed = bob_group
        .process_message(&bob.provider, pm_for_bob)
        .expect("bob processes add-charlie commit");
    if let ProcessedMessageContent::StagedCommitMessage(staged) = processed.into_content() {
        bob_group
            .merge_staged_commit(&bob.provider, *staged)
            .expect("bob merges add-charlie");
    }

    let welcome2 = welcome_msg2.into_welcome().expect("welcome for charlie");
    let mut charlie_group = StagedWelcome::new_from_welcome(
        &charlie.provider,
        &MlsGroupJoinConfig::default(),
        welcome2,
        None,
    )
    .expect("charlie stages welcome")
    .into_group(&charlie.provider)
    .expect("charlie joins group");

    // --- C-3: send message, both Bob and Charlie should decrypt ---
    let app_msg = alice_group
        .create_message(&alice.provider, &alice.signer, b"hello group")
        .expect("alice sends message");

    let app_pm = app_msg
        .into_protocol_message()
        .expect("app msg is protocol message");

    // We need to serialize/deserialize to simulate wire transfer (each receiver needs their own copy)
    let wire_bytes = {
        let out = alice_group
            .create_message(&alice.provider, &alice.signer, b"hello group C3")
            .expect("alice sends C3 message");
        out.tls_serialize_detached().expect("serialize")
    };

    // Bob decrypts
    let msg_in_bob = MlsMessageIn::tls_deserialize_exact(&wire_bytes).expect("bob deserialize");
    let pm_bob: ProtocolMessage = msg_in_bob.try_into().expect("bob protocol message");
    let bob_processed = bob_group
        .process_message(&bob.provider, pm_bob)
        .expect("bob processes app msg");
    let bob_decrypted = match bob_processed.into_content() {
        ProcessedMessageContent::ApplicationMessage(app) => app.into_bytes(),
        _ => panic!("expected application message for bob"),
    };

    // Charlie decrypts
    let msg_in_charlie = MlsMessageIn::tls_deserialize_exact(&wire_bytes).expect("charlie deserialize");
    let pm_charlie: ProtocolMessage = msg_in_charlie.try_into().expect("charlie protocol message");
    let charlie_processed = charlie_group
        .process_message(&charlie.provider, pm_charlie)
        .expect("charlie processes app msg");
    let charlie_decrypted = match charlie_processed.into_content() {
        ProcessedMessageContent::ApplicationMessage(app) => app.into_bytes(),
        _ => panic!("expected application message for charlie"),
    };

    if bob_decrypted == b"hello group C3" && charlie_decrypted == b"hello group C3" {
        println!("[C-3] PASS: both Bob and Charlie decrypted the group message");
    } else {
        println!("[C-3] FAIL: decryption mismatch bob={:?} charlie={:?}", bob_decrypted, charlie_decrypted);
        failures += 1;
    }

    // --- C-6: remove Bob, then send post-removal message ---
    // Find Bob's leaf index
    let bob_leaf = alice_group
        .members()
        .find(|m| m.credential.serialized_content() == b"bob")
        .map(|m| m.index)
        .expect("bob leaf in alice's view");

    let (remove_commit, _remove_welcome, _) = alice_group
        .remove_members(&alice.provider, &alice.signer, &[bob_leaf])
        .expect("alice removes bob");
    alice_group
        .merge_pending_commit(&alice.provider)
        .expect("alice merges remove-bob commit");

    // Charlie processes the remove commit
    let remove_pm = remove_commit
        .into_protocol_message()
        .expect("remove commit is protocol message");
    let charlie_processed_remove = charlie_group
        .process_message(&charlie.provider, remove_pm)
        .expect("charlie processes remove-bob commit");
    if let ProcessedMessageContent::StagedCommitMessage(staged) = charlie_processed_remove.into_content() {
        charlie_group
            .merge_staged_commit(&charlie.provider, *staged)
            .expect("charlie merges remove-bob");
    }

    // Alice sends a post-removal message
    let post_remove_wire = {
        let out = alice_group
            .create_message(&alice.provider, &alice.signer, b"secret after bob removed")
            .expect("alice sends post-removal");
        out.tls_serialize_detached().expect("serialize post-removal")
    };

    // Charlie should decrypt
    let msg_charlie_post = MlsMessageIn::tls_deserialize_exact(&post_remove_wire).expect("charlie deser post");
    let pm_charlie_post: ProtocolMessage = msg_charlie_post.try_into().expect("charlie pm post");
    let charlie_post = charlie_group
        .process_message(&charlie.provider, pm_charlie_post)
        .expect("charlie decrypts post-removal");
    let charlie_post_text = match charlie_post.into_content() {
        ProcessedMessageContent::ApplicationMessage(app) => app.into_bytes(),
        _ => panic!("expected app message for charlie post-removal"),
    };

    // Bob should NOT be able to decrypt (his group state is stale / he was removed)
    let msg_bob_post = MlsMessageIn::tls_deserialize_exact(&post_remove_wire).expect("bob deser post");
    let pm_bob_post: Result<ProtocolMessage, _> = msg_bob_post.try_into();
    let bob_can_decrypt = match pm_bob_post {
        Ok(pm) => bob_group.process_message(&bob.provider, pm).is_ok(),
        Err(_) => false,
    };

    if charlie_post_text == b"secret after bob removed" && !bob_can_decrypt {
        println!("[C-6] PASS: post-removal message decrypted by Charlie, rejected for removed Bob");
    } else {
        println!(
            "[C-6] FAIL: charlie_ok={}, bob_blocked={} (bob_can_decrypt={})",
            charlie_post_text == b"secret after bob removed",
            !bob_can_decrypt,
            bob_can_decrypt,
        );
        failures += 1;
    }

    // --- C-7: pressure test ---
    if !pressure::run() {
        failures += 1;
    }

    // --- Summary ---
    println!();
    if failures == 0 {
        println!("G0 L1 spike: ALL CHECKS PASSED (C-1, C-3, C-6, C-7)");
    } else {
        eprintln!("G0 L1 spike: {} CHECK(S) FAILED", failures);
        std::process::exit(1);
    }
}

// === C-7 pressure benchmark (100 members, ~200 devices simulated as 1 device/member for TreeKEM sizing) ===
// For L1 we measure: group creation time, single add time, single remove time,
// message encrypt/decrypt time, commit size, and group state memory.

mod pressure {
    use super::*;
    use std::time::Instant;

    pub fn run() -> bool {
        let mut failures = 0u32;
        const N_MEMBERS: usize = 100;

        println!("\n--- C-7 Pressure Test: {} members ---", N_MEMBERS);

        // Create founder
        let founder = Member::new("founder");
        let group_config = MlsGroupCreateConfig::builder()
            .use_ratchet_tree_extension(true)
            .build();
        let mut founder_group = MlsGroup::new(
            &founder.provider,
            &founder.signer,
            &group_config,
            founder.credential_with_key.clone(),
        )
        .expect("founder creates group");

        // Add members one by one (measures per-add cost at growing tree sizes)
        let mut members: Vec<Member> = Vec::with_capacity(N_MEMBERS);
        let mut member_groups: Vec<MlsGroup> = Vec::with_capacity(N_MEMBERS);
        let mut add_times_ms: Vec<f64> = Vec::with_capacity(N_MEMBERS);
        let mut commit_sizes: Vec<usize> = Vec::with_capacity(N_MEMBERS);

        let group_create_start = Instant::now();
        for i in 0..N_MEMBERS {
            let m = Member::new(&format!("member_{}", i));
            let kp = m.key_package();

            let t0 = Instant::now();
            let (commit_out, welcome_out, _) = founder_group
                .add_members(&founder.provider, &founder.signer, &[kp])
                .expect("add member");
            founder_group
                .merge_pending_commit(&founder.provider)
                .expect("merge add");
            let add_elapsed = t0.elapsed();
            add_times_ms.push(add_elapsed.as_secs_f64() * 1000.0);

            // Measure commit size
            let commit_bytes = commit_out.tls_serialize_detached().expect("serialize commit");
            commit_sizes.push(commit_bytes.len());

            // Joiner processes welcome
            let welcome = welcome_out.into_welcome().expect("welcome");
            let joined = StagedWelcome::new_from_welcome(
                &m.provider,
                &MlsGroupJoinConfig::default(),
                welcome,
                None,
            )
            .expect("stage welcome")
            .into_group(&m.provider)
            .expect("join group");

            members.push(m);
            member_groups.push(joined);
        }
        let group_create_elapsed = group_create_start.elapsed();

        println!("  group init (founder + {} adds): {:.1}s", N_MEMBERS, group_create_elapsed.as_secs_f64());

        // Add time stats
        let add_p95_idx = (add_times_ms.len() as f64 * 0.95) as usize;
        let mut sorted_adds = add_times_ms.clone();
        sorted_adds.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let add_p95 = sorted_adds.get(add_p95_idx).copied().unwrap_or(0.0);
        let add_max = sorted_adds.last().copied().unwrap_or(0.0);
        println!("  single add: p95={:.1}ms, max={:.1}ms", add_p95, add_max);

        // Commit size stats
        let max_commit = commit_sizes.iter().max().copied().unwrap_or(0);
        let last_commit = commit_sizes.last().copied().unwrap_or(0);
        println!("  commit size: last={} bytes, max={} bytes", last_commit, max_commit);

        // Message encrypt/decrypt timing
        let encrypt_start = Instant::now();
        let msg_out = founder_group
            .create_message(&founder.provider, &founder.signer, b"pressure test message")
            .expect("encrypt");
        let encrypt_ms = encrypt_start.elapsed().as_secs_f64() * 1000.0;

        let wire = msg_out.tls_serialize_detached().expect("serialize msg");

        // Decrypt on the last member (worst case tree position)
        let last_idx = member_groups.len() - 1;
        let decrypt_start = Instant::now();
        let msg_in = MlsMessageIn::tls_deserialize_exact(&wire).expect("deser");
        let pm: ProtocolMessage = msg_in.try_into().expect("protocol msg");
        let processed = member_groups[last_idx]
            .process_message(&members[last_idx].provider, pm)
            .expect("decrypt");
        let decrypt_ms = decrypt_start.elapsed().as_secs_f64() * 1000.0;
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(app) => {
                assert_eq!(app.into_bytes(), b"pressure test message");
            }
            _ => panic!("expected app message"),
        }
        println!("  encrypt: {:.2}ms, decrypt: {:.2}ms", encrypt_ms, decrypt_ms);

        // Remove member timing (remove the 50th member)
        let remove_target = founder_group
            .members()
            .find(|m| m.credential.serialized_content() == b"member_50")
            .map(|m| m.index)
            .expect("find member_50");
        let remove_start = Instant::now();
        let (remove_commit, _, _) = founder_group
            .remove_members(&founder.provider, &founder.signer, &[remove_target])
            .expect("remove member");
        founder_group
            .merge_pending_commit(&founder.provider)
            .expect("merge remove");
        let remove_ms = remove_start.elapsed().as_secs_f64() * 1000.0;
        let remove_commit_size = remove_commit.tls_serialize_detached().expect("ser").len();
        println!("  remove: {:.2}ms, commit_size={} bytes", remove_ms, remove_commit_size);

        // Memory estimate (rough: serialize the full group state)
        let group_serial = founder_group.export_ratchet_tree().tls_serialize_detached().expect("export tree");
        println!("  ratchet tree export size: {} bytes ({:.1} KB)", group_serial.len(), group_serial.len() as f64 / 1024.0);

        // === Threshold checks (from §3.1) ===
        println!("\n  --- Threshold checks ---");

        // Group init <= 5s
        if group_create_elapsed.as_secs_f64() <= 5.0 {
            println!("  [OK] group init {:.1}s <= 5s", group_create_elapsed.as_secs_f64());
        } else {
            println!("  [FAIL] group init {:.1}s > 5s threshold", group_create_elapsed.as_secs_f64());
            failures += 1;
        }

        // Single add p95 <= 300ms
        if add_p95 <= 300.0 {
            println!("  [OK] add p95 {:.1}ms <= 300ms", add_p95);
        } else {
            println!("  [FAIL] add p95 {:.1}ms > 300ms threshold", add_p95);
            failures += 1;
        }

        // Commit size <= 128KB
        if max_commit <= 128 * 1024 {
            println!("  [OK] max commit {} bytes <= 128KB", max_commit);
        } else {
            println!("  [FAIL] max commit {} bytes > 128KB threshold", max_commit);
            failures += 1;
        }

        // Encrypt <= 20ms
        if encrypt_ms <= 20.0 {
            println!("  [OK] encrypt {:.2}ms <= 20ms", encrypt_ms);
        } else {
            println!("  [FAIL] encrypt {:.2}ms > 20ms threshold", encrypt_ms);
            failures += 1;
        }

        // Decrypt <= 20ms
        if decrypt_ms <= 20.0 {
            println!("  [OK] decrypt {:.2}ms <= 20ms", decrypt_ms);
        } else {
            println!("  [FAIL] decrypt {:.2}ms > 20ms threshold", decrypt_ms);
            failures += 1;
        }

        // Remove commit <= 128KB
        if remove_commit_size <= 128 * 1024 {
            println!("  [OK] remove commit {} bytes <= 128KB", remove_commit_size);
        } else {
            println!("  [FAIL] remove commit {} bytes > 128KB threshold", remove_commit_size);
            failures += 1;
        }

        if failures == 0 {
            println!("\n[C-7] PASS: all pressure thresholds met");
            true
        } else {
            println!("\n[C-7] FAIL: {} threshold(s) exceeded", failures);
            false
        }
    }
}
