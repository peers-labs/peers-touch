mod fixtures;

use messaging_core::codec::private_content::encode_message_private_content;
use messaging_core::codec::verification::delivery_commitment;
use messaging_core::contracts::CryptoEndpoint;
use messaging_core::crypto::double_ratchet::{encrypt, init_initiator, init_responder};
use messaging_core::crypto::identity::X25519KeyPair;
use messaging_core::crypto::session::{DirectSession, DirectSessionKey};
use messaging_core::inbox::{ClaimedItemConsumer, DirectMessageProcessor};
use messaging_core::proto::actor_device_from_chat_endpoint;
use messaging_core::proto::chat::{
    conversation_event, ConversationEvent, CryptoEndpoint as ProtoCryptoEndpoint,
    DeviceEventDelivery, DeviceInboxPayloadType, DirectDeviceCiphertext, DoubleRatchetCiphertext,
    DurableDeviceInboxItem, MessageCommittedFact, MessageForwardedFact, MessagingContentKind,
    PreparedEndpointPayloadKind,
};
use prost::Message;
use sha2::{Digest, Sha256};

use fixtures::TestRepo;

fn test_clock() -> i64 {
    1000
}

fn assert_direct_processor_decrypts_and_commits_message(forwarded: bool) {
    let bob_spk = X25519KeyPair::generate();
    let shared_secret = [42u8; 32];
    let session_id = "test-session-1";

    let alice_ratchet = init_initiator(session_id, &shared_secret, bob_spk.public_bytes());
    let bob_ratchet = init_responder(session_id, &shared_secret, bob_spk.private_bytes());

    let alice_endpoint = CryptoEndpoint {
        ptid: "ptid:alice".to_string(),
        device_id: "alice-dev".to_string(),
    };
    let bob_endpoint = CryptoEndpoint {
        ptid: "ptid:bob".to_string(),
        device_id: "bob-dev".to_string(),
    };

    let bob_session = DirectSession {
        session_id: session_id.to_string(),
        key: DirectSessionKey::new("conv-1", bob_endpoint.clone(), alice_endpoint.clone(), 1)
            .unwrap(),
        protocol_version: 1,
        established: true,
        peer_identity_key: [9; 32],
        ratchet: bob_ratchet,
        updated_at_unix_ms: 500,
    };

    let repo = std::sync::Arc::new(TestRepo::new(bob_session));

    let processor = DirectMessageProcessor::with_actor_identity(
        repo.clone(),
        bob_endpoint.clone(),
        std::sync::Arc::new(messaging_core::crypto::identity::IdentityKeyPair::generate()),
        test_clock,
    )
    .unwrap();

    let sender_proto = ProtoCryptoEndpoint {
        ptid: "ptid:alice".to_string(),
        device_id: "alice-dev".to_string(),
    };
    let recipient_proto = ProtoCryptoEndpoint {
        ptid: "ptid:bob".to_string(),
        device_id: "bob-dev".to_string(),
    };

    let mut direct = DirectDeviceCiphertext {
        command_id: "cmd-1".to_string(),
        message_id: "msg-1".to_string(),
        sender: Some(sender_proto.clone()),
        recipient: Some(recipient_proto.clone()),
        session_id: session_id.to_string(),
        session_generation: 1,
        protocol_version: 1,
        ratchet_ciphertext: None,
        ciphertext_sha256: Vec::new(),
        session_init: None,
    };

    let aad = messaging_core::inbox::direct::encode_direct_ciphertext_aad("conv-1", &direct);
    let private_content = encode_message_private_content("hello from core test", &[]).unwrap();
    let mut alice_state = alice_ratchet;
    let wire = encrypt(&mut alice_state, &private_content, &aad).unwrap();

    let ratchet = DoubleRatchetCiphertext {
        wire_version: wire.version,
        sender_ratchet_public_key: wire.sender_dh.to_vec(),
        message_counter: wire.n_send,
        previous_chain_length: wire.n_prev,
        nonce: wire.nonce.to_vec(),
        ciphertext: wire.ciphertext,
    };
    direct.ciphertext_sha256 = Sha256::digest(ratchet.encode_to_vec()).to_vec();
    direct.ratchet_ciphertext = Some(ratchet);
    let endpoint_payload = direct.encode_to_vec();
    let endpoint_payload_hash = Sha256::digest(&endpoint_payload).to_vec();

    let mut event = ConversationEvent {
        event_id: "evt-1".to_string(),
        conversation_id: "conv-1".to_string(),
        sequence: 1,
        command_id: "cmd-1".to_string(),
        actor: Some(sender_proto.clone()),
        previous_hash: Vec::new(),
        event_hash: Vec::new(),
        committed_at: Some(prost_types::Timestamp {
            seconds: 1,
            nanos: 0,
        }),
        delivery_commitments: Vec::new(),
        membership_epoch: 1,
        mls_epoch: 0,
        authority_station_peer_id: "station-1".to_string(),
        payload: Some(if forwarded {
            conversation_event::Payload::MessageForwarded(MessageForwardedFact {
                destination_message_id: "msg-1".to_string(),
                sender: Some(sender_proto.clone()),
                content_kind: MessagingContentKind::Text as i32,
                ..Default::default()
            })
        } else {
            conversation_event::Payload::MessageCommitted(MessageCommittedFact {
                message_id: "msg-1".to_string(),
                sender: Some(sender_proto.clone()),
                content_kind: MessagingContentKind::Text as i32,
                ..Default::default()
            })
        }),
    };
    let commitment = delivery_commitment(
        "conv-1",
        "evt-1",
        "ptid:bob",
        "bob-dev",
        PreparedEndpointPayloadKind::DirectCiphertext,
        &endpoint_payload_hash,
    );
    event.delivery_commitments = vec![commitment.to_vec()];
    event.event_hash = Sha256::digest(event.encode_to_vec()).to_vec();

    let delivery = DeviceEventDelivery {
        event: Some(event),
        recipient: Some(recipient_proto.clone()),
        payload_kind: PreparedEndpointPayloadKind::DirectCiphertext as i32,
        endpoint_payload,
        endpoint_payload_sha256: endpoint_payload_hash,
        delivery_commitment: commitment.to_vec(),
        sender_actor_identity_public_key: vec![9; 32],
    };
    let opaque_payload = delivery.encode_to_vec();
    let item = DurableDeviceInboxItem {
        item_id: "item-1".to_string(),
        recipient: Some(actor_device_from_chat_endpoint(&recipient_proto)),
        lane_sequence: 1,
        event_id: "evt-1".to_string(),
        conversation_id: "conv-1".to_string(),
        idempotency_key: "event:evt-1".to_string(),
        payload_type: DeviceInboxPayloadType::ConversationEvent as i32,
        opaque_payload: opaque_payload.clone(),
        payload_sha256: Sha256::digest(&opaque_payload).to_vec(),
        ..Default::default()
    };

    processor.consume(&item, 1).unwrap();

    let committed = repo.committed_message.lock().unwrap();
    let msg = committed.as_ref().expect("message should be committed");
    assert_eq!(msg.plaintext, "hello from core test");
    assert_eq!(msg.message_id, "msg-1");
    assert_eq!(msg.conversation_id, "conv-1");
    assert_eq!(msg.sender_ptid, "ptid:alice");
    assert_eq!(msg.sender_device_id, "alice-dev");

    let session = repo.session.lock().unwrap();
    let s = session.as_ref().unwrap();
    assert_eq!(s.ratchet.n_recv, 1);
}

#[test]
fn direct_processor_decrypts_and_commits_message_via_repository() {
    assert_direct_processor_decrypts_and_commits_message(false);
}

#[test]
fn direct_processor_decrypts_and_commits_forwarded_message_as_destination_message() {
    assert_direct_processor_decrypts_and_commits_message(true);
}
