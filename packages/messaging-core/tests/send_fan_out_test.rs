use messaging_core::codec::private_content::decode_message_private_content;
use messaging_core::contracts::CryptoEndpoint;
use messaging_core::crypto::double_ratchet::{decrypt, init_initiator, init_responder};
use messaging_core::crypto::identity::X25519KeyPair;
use messaging_core::crypto::session::{DirectSession, DirectSessionKey};
use messaging_core::inbox::direct::encode_direct_ciphertext_aad;
use messaging_core::outbox::{encrypt_direct_fan_out, DirectSendIntent, DirectSessionWithInit};
use messaging_core::proto::chat::{CryptoEndpoint as ProtoCryptoEndpoint, DirectDeviceCiphertext};
use prost::Message;

#[test]
fn direct_fan_out_encrypts_for_multiple_peers() {
    let alice_endpoint = CryptoEndpoint {
        ptid: "ptid:alice".to_string(),
        device_id: "alice-dev".to_string(),
    };
    let bob_spk = X25519KeyPair::generate();
    let carol_spk = X25519KeyPair::generate();
    let shared_bob = [1u8; 32];
    let shared_carol = [2u8; 32];

    let bob_endpoint = CryptoEndpoint {
        ptid: "ptid:bob".to_string(),
        device_id: "bob-dev".to_string(),
    };
    let carol_endpoint = CryptoEndpoint {
        ptid: "ptid:carol".to_string(),
        device_id: "carol-dev".to_string(),
    };

    let alice_bob_ratchet = init_initiator("sess-bob", &shared_bob, bob_spk.public_bytes());
    let alice_carol_ratchet = init_initiator("sess-carol", &shared_carol, carol_spk.public_bytes());

    let bob_ratchet = init_responder("sess-bob", &shared_bob, bob_spk.private_bytes());
    let carol_ratchet = init_responder("sess-carol", &shared_carol, carol_spk.private_bytes());

    let sessions = vec![
        DirectSessionWithInit {
            session: DirectSession {
                session_id: "sess-bob".to_string(),
                key: DirectSessionKey::new(
                    "conv-1",
                    alice_endpoint.clone(),
                    bob_endpoint.clone(),
                    1,
                )
                .unwrap(),
                protocol_version: 1,
                established: true,
                peer_identity_key: [0; 32],
                ratchet: alice_bob_ratchet,
                updated_at_unix_ms: 100,
            },
            session_init: None,
        },
        DirectSessionWithInit {
            session: DirectSession {
                session_id: "sess-carol".to_string(),
                key: DirectSessionKey::new(
                    "conv-1",
                    alice_endpoint.clone(),
                    carol_endpoint.clone(),
                    1,
                )
                .unwrap(),
                protocol_version: 1,
                established: true,
                peer_identity_key: [0; 32],
                ratchet: alice_carol_ratchet,
                updated_at_unix_ms: 100,
            },
            session_init: None,
        },
    ];

    let local = ProtoCryptoEndpoint {
        ptid: "ptid:alice".to_string(),
        device_id: "alice-dev".to_string(),
    };

    let intent = DirectSendIntent {
        command_id: "cmd-1",
        message_id: "msg-1",
        conversation_id: "conv-1",
        plaintext: "hello group",
        attachments: &[],
        client_timestamp_unix_ms: 200,
    };

    let result = encrypt_direct_fan_out(&intent, &local, sessions).unwrap();
    assert_eq!(result.payloads.len(), 2);
    assert_eq!(result.advanced_sessions.len(), 2);

    // Verify Bob can decrypt
    let bob_payload = &result.payloads[0];
    let bob_direct = DirectDeviceCiphertext::decode(bob_payload.opaque_payload.as_slice()).unwrap();
    let bob_aad = encode_direct_ciphertext_aad("conv-1", &bob_direct);
    let bob_wire_proto = bob_direct.ratchet_ciphertext.unwrap();
    let bob_wire = messaging_core::crypto::double_ratchet::DrCiphertextWire {
        version: bob_wire_proto.wire_version,
        sender_dh: bob_wire_proto
            .sender_ratchet_public_key
            .as_slice()
            .try_into()
            .unwrap(),
        n_send: bob_wire_proto.message_counter,
        n_prev: bob_wire_proto.previous_chain_length,
        nonce: bob_wire_proto.nonce.as_slice().try_into().unwrap(),
        ciphertext: bob_wire_proto.ciphertext,
    };
    let bob_outcome = decrypt(&bob_ratchet, &bob_wire, &[], &bob_aad).unwrap();
    let content = decode_message_private_content(&bob_outcome.plaintext).unwrap();
    assert_eq!(content.text, "hello group");

    // Verify Carol can decrypt
    let carol_payload = &result.payloads[1];
    let carol_direct =
        DirectDeviceCiphertext::decode(carol_payload.opaque_payload.as_slice()).unwrap();
    let carol_aad = encode_direct_ciphertext_aad("conv-1", &carol_direct);
    let carol_wire_proto = carol_direct.ratchet_ciphertext.unwrap();
    let carol_wire = messaging_core::crypto::double_ratchet::DrCiphertextWire {
        version: carol_wire_proto.wire_version,
        sender_dh: carol_wire_proto
            .sender_ratchet_public_key
            .as_slice()
            .try_into()
            .unwrap(),
        n_send: carol_wire_proto.message_counter,
        n_prev: carol_wire_proto.previous_chain_length,
        nonce: carol_wire_proto.nonce.as_slice().try_into().unwrap(),
        ciphertext: carol_wire_proto.ciphertext,
    };
    let carol_outcome = decrypt(&carol_ratchet, &carol_wire, &[], &carol_aad).unwrap();
    let content2 = decode_message_private_content(&carol_outcome.plaintext).unwrap();
    assert_eq!(content2.text, "hello group");
}
