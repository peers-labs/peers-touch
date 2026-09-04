from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
CHAT_PROTO = ROOT / "model/domain/chat"


class MessagingPlatformContractTest(unittest.TestCase):
    def test_crypto_endpoint_has_one_canonical_source(self) -> None:
        endpoint = (CHAT_PROTO / "endpoint.proto").read_text(encoding="utf-8")

        self.assertIn("message CryptoEndpoint", endpoint)
        self.assertIn("string ptid = 1;", endpoint)
        self.assertIn("string device_id = 2;", endpoint)
        self.assertFalse((CHAT_PROTO / "key_exchange.proto").exists())

    def test_logical_event_and_device_delivery_identities_are_separate(self) -> None:
        queue = (CHAT_PROTO / "queue.proto").read_text(encoding="utf-8")
        command = (CHAT_PROTO / "command.proto").read_text(encoding="utf-8")
        event = (CHAT_PROTO / "event.proto").read_text(encoding="utf-8")

        self.assertIn("message ChatCommand", command)
        self.assertIn("message ConversationEvent", event)
        self.assertIn("string event_id = 1;", event)
        self.assertIn("repeated bytes delivery_commitments = 9;", event)
        self.assertIn("string item_id = 1;", queue)
        self.assertIn("int64 lane_sequence = 3;", queue)
        self.assertIn("string event_id = 4;", queue)
        self.assertIn("CryptoEndpoint recipient = 2;", queue)

    def test_direct_ciphertext_targets_exactly_one_endpoint(self) -> None:
        direct = (CHAT_PROTO / "direct_crypto.proto").read_text(encoding="utf-8")

        self.assertIn("message DirectDeviceCiphertext", direct)
        self.assertIn("string command_id = 1;", direct)
        self.assertIn("CryptoEndpoint sender = 3;", direct)
        self.assertIn("CryptoEndpoint recipient = 4;", direct)
        self.assertIn("uint64 session_generation = 6;", direct)
        self.assertIn("message DoubleRatchetCiphertext", direct)
        self.assertIn("bytes sender_ratchet_public_key = 2;", direct)
        self.assertIn("uint32 message_counter = 3;", direct)
        self.assertIn("uint32 previous_chain_length = 4;", direct)
        self.assertIn("bytes nonce = 5;", direct)
        self.assertIn("message DirectCiphertextAad", direct)
        self.assertIn("string conversation_id = 3;", direct)
        self.assertIn("DoubleRatchetCiphertext ratchet_ciphertext = 8;", direct)
        self.assertIn("DirectSessionInit session_init = 10;", direct)
        self.assertNotIn("bytes ciphertext = 8;", direct)

    def test_device_event_delivery_contains_one_private_payload(self) -> None:
        event = (CHAT_PROTO / "event.proto").read_text(encoding="utf-8")

        self.assertIn("message DeviceEventDelivery", event)
        self.assertIn("message ConversationCreatedFact", event)
        self.assertIn("ConversationCreatedFact conversation_created = 27;", event)
        self.assertIn("ConversationEvent event = 1;", event)
        self.assertIn("CryptoEndpoint recipient = 2;", event)
        self.assertIn("bytes endpoint_payload = 4;", event)
        self.assertIn("bytes endpoint_payload_sha256 = 5;", event)
        self.assertIn("bytes delivery_commitment = 6;", event)
        self.assertIn("bytes sender_actor_identity_public_key = 7;", event)
        self.assertNotIn("DeviceEncryptedPayload", event)

    def test_sending_endpoint_uses_ordered_public_event_marker(self) -> None:
        command = (CHAT_PROTO / "command.proto").read_text(encoding="utf-8")
        event = (CHAT_PROTO / "event.proto").read_text(encoding="utf-8")

        self.assertIn("PREPARED_ENDPOINT_PAYLOAD_KIND_PUBLIC_EVENT = 5;", command)
        self.assertIn("message PublicEventMarker", event)
        self.assertIn("string conversation_id = 1;", event)
        self.assertIn("string event_id = 2;", event)
        self.assertIn("string command_id = 3;", event)
        self.assertIn("CryptoEndpoint sending_endpoint = 4;", event)

    def test_send_preparation_binds_active_device_plan(self) -> None:
        command = (CHAT_PROTO / "command.proto").read_text(encoding="utf-8")
        api = (CHAT_PROTO / "messaging_api.proto").read_text(encoding="utf-8")

        self.assertIn("bytes delivery_plan_sha256 = 7;", command)
        self.assertIn("message PrepareMessagingSendRequest", api)
        self.assertIn("message PrepareMessagingSendResponse", api)
        self.assertIn("repeated CryptoEndpoint required_endpoints = 7;", api)
        self.assertIn("bytes delivery_plan_sha256 = 8;", api)
        self.assertIn("MESSAGING_COMMAND_REJECT_CODE_STALE_DELIVERY_PLAN = 1;", api)
        self.assertIn("message SubmitMessagingCommandRequest", api)
        self.assertIn("message SubmitMessagingCommandResponse", api)

    def test_production_runtime_registers_messaging_owner_and_profile_engine(self) -> None:
        station_main = (ROOT / "apps/station/app/main.go").read_text(encoding="utf-8")
        station_subserver = (
            ROOT / "apps/station/app/subserver/messaging/subserver.go"
        ).read_text(encoding="utf-8")
        desktop_state = (
            ROOT / "apps/desktop/src-tauri/src/state/mod.rs"
        ).read_text(encoding="utf-8")
        auth_service = (
            ROOT / "apps/desktop/src-tauri/src/application/auth/service.rs"
        ).read_text(encoding="utf-8")

        self.assertIn('server.WithSubServer("messaging"', station_main)
        for route in (
            "/messaging/conversation/direct",
            "/messaging/group/genesis/prepare",
            "/messaging/membership/transition/prepare",
            "/messaging/conversation/list",
            "/messaging/command/prepare",
            "/messaging/command/submit",
            "/messaging/device/enroll",
            "/messaging/queue/claim",
            "/messaging/queue/ack",
        ):
            self.assertIn(route, station_subserver)
        self.assertNotIn("/messaging/conversation/group", station_subserver)
        self.assertNotIn("/messaging/mls/key-package/claim", station_subserver)
        self.assertIn("pub messaging_engines: EngineRegistry", desktop_state)
        self.assertIn("activate_messaging_profile(", auth_service)
        self.assertIn("deactivate_messaging_profile(", auth_service)

    def test_profile_engine_owns_lifecycle_and_fresh_key_activation(self) -> None:
        messaging = ROOT / "apps/desktop/src-tauri/src/messaging"
        lifecycle = (messaging / "lifecycle.rs").read_text(encoding="utf-8")
        prekeys = (messaging / "prekeys.rs").read_text(encoding="utf-8")
        mls_key_packages = (messaging / "mls_key_packages.rs").read_text(
            encoding="utf-8"
        )
        engine = (messaging / "engine.rs").read_text(encoding="utf-8")
        key_exchange = (
            ROOT / "apps/station/app/subserver/key_exchange/handler.go"
        ).read_text(encoding="utf-8")

        self.assertIn("pub struct MessagingLifecycleWorker", lifecycle)
        self.assertIn("engine.enroll_pending_device(", lifecycle)
        self.assertIn("engine.dispatch_command_once(", lifecycle)
        self.assertIn("engine.resume_membership_intent_once(", lifecycle)
        self.assertIn("engine.drain_once(", lifecycle)
        self.assertIn("pub struct PreKeyPublisher", prekeys)
        self.assertIn("install_fresh_prekey_bundle(", prekeys)
        self.assertTrue((messaging / "direct_session.rs").exists())
        self.assertIn(
            "direct_session_bootstraps",
            (messaging / "store.rs").read_text(encoding="utf-8"),
        )
        self.assertIn("pub struct MlsKeyPackagePublisher", mls_key_packages)
        self.assertIn("install_fresh_mls_key_packages(", mls_key_packages)
        self.assertIn("activate_profile_worker(", engine)
        self.assertIn("requireVerifiedActiveDevice(", key_exchange)

        social_store = (
            ROOT / "apps/desktop/src/store/socialChat.ts"
        ).read_text(encoding="utf-8")
        self.assertIn("imServiceV1.messaging.listConversations()", social_store)
        self.assertNotIn("primeDirectSessions(", social_store)
        group_modal = (
            ROOT / "apps/desktop/src/components/chat/CreateGroupModal.tsx"
        ).read_text(encoding="utf-8")
        self.assertIn("imServiceV1.messaging.createGroup(", group_modal)
        self.assertNotIn("keyPackage.fetch(", group_modal)
        self.assertNotIn("createAuthorizedGroup(", group_modal)
        group_detail = (
            ROOT / "apps/desktop/src/components/chat/ChatDetailPanel.tsx"
        ).read_text(encoding="utf-8")
        self.assertIn("imServiceV1.messaging.submitMembershipIntent(", group_detail)
        self.assertNotIn("imServiceV1.keyPackage.fetch(", group_detail)
        self.assertNotIn("imServiceV1.mlsGroup.addAuthorizedMember(", group_detail)
        self.assertNotIn("imServiceV1.mlsGroup.removeAuthorizedMember(", group_detail)

    def test_queue_ack_is_fenced_and_hash_bound(self) -> None:
        queue = (CHAT_PROTO / "queue.proto").read_text(encoding="utf-8")

        self.assertIn("message AcknowledgeDeviceQueueItemRequest", queue)
        self.assertIn("int64 lane_sequence = 3;", queue)
        self.assertIn("uint64 consumer_epoch = 4;", queue)
        self.assertIn("bytes payload_sha256 = 5;", queue)

    def test_device_enrollment_is_actor_cross_signed(self) -> None:
        device = (CHAT_PROTO / "device.proto").read_text(encoding="utf-8")

        self.assertIn("message MessagingDeviceCertificate", device)
        self.assertIn("string ptid = 2;", device)
        self.assertIn("string device_id = 3;", device)
        self.assertIn("bytes actor_identity_public_key = 4;", device)
        self.assertIn("bytes actor_identity_key_fingerprint = 5;", device)
        self.assertIn("bytes device_signing_public_key = 6;", device)
        self.assertIn("string signing_key_id = 7;", device)
        self.assertIn("uint64 observed_profile_version = 8;", device)
        self.assertIn("MessagingDeviceCertificate certificate = 1;", device)
        self.assertIn("bytes actor_cross_signature = 3;", device)

    def test_federation_frame_is_signed_hash_bound_and_preserves_event_identity(self) -> None:
        federation = (CHAT_PROTO / "federation.proto").read_text(encoding="utf-8")

        self.assertIn("message MessagingFederationFrameSigningInput", federation)
        self.assertIn("message MessagingFederationFrame", federation)
        self.assertIn("string source_station_id = 3;", federation)
        self.assertIn("string target_station_id = 4;", federation)
        self.assertIn("string idempotency_key = 5;", federation)
        self.assertIn("string event_id = 8;", federation)
        self.assertIn("bytes payload_sha256 = 11;", federation)
        self.assertIn("bytes station_signature = 15;", federation)

    def test_inter_station_messaging_control_plane_uses_protobuf(self) -> None:
        infrastructure = (
            ROOT / "apps/station/app/subserver/messaging/infrastructure"
        )
        for name in (
            "authority_prepare_fetcher.go",
            "endpoint_manifest_fetcher.go",
            "federation_transport.go",
            "mls_keypackage_claim_fetcher.go",
        ):
            source = (infrastructure / name).read_text(encoding="utf-8")
            self.assertIn('"google.golang.org/protobuf/proto"', source)
            self.assertIn('"application/protobuf"', source)
            self.assertNotIn("protojson", source)
            self.assertNotIn('"application/json"', source)

        federation_resolver = (
            ROOT
            / "apps/station/frame/touch/federation/resolver/resolver.go"
        ).read_text(encoding="utf-8")
        self.assertIn('req.Header.Set("Accept", "application/protobuf")', federation_resolver)
        self.assertIn("proto.Unmarshal(body, env)", federation_resolver)
        self.assertNotIn("protojson", federation_resolver)

    def test_recovery_archive_excludes_live_crypto_state(self) -> None:
        recovery = (CHAT_PROTO / "recovery.proto").read_text(encoding="utf-8")

        self.assertIn("RECOVERY_ARCHIVE_SECTION_KIND_MESSAGE_HISTORY", recovery)
        self.assertNotIn("RATCHET", recovery)
        self.assertNotIn("SKIPPED_KEY", recovery)
        self.assertNotIn("MLS_STATE", recovery)

    def test_attachment_contract_separates_private_content_and_resumable_object_state(self) -> None:
        attachment = (CHAT_PROTO / "attachment.proto").read_text(encoding="utf-8")

        self.assertIn("message MessagePrivateContent", attachment)
        self.assertIn("repeated AttachmentPlaintextMetadata attachments = 3;", attachment)
        self.assertIn(
            "ATTACHMENT_ENCRYPTION_SUITE_AES_256_GCM_CHUNKED = 1;",
            attachment,
        )
        self.assertIn(
            "ATTACHMENT_NONCE_STRATEGY_COUNTER32_BE = 1;",
            attachment,
        )
        self.assertIn("repeated bytes chunk_ciphertext_sha256 = 11;", attachment)
        self.assertIn("message BeginAttachmentUploadRequest", attachment)
        self.assertIn("CryptoEndpoint uploader = 4;", attachment)
        self.assertGreaterEqual(
            attachment.count("string authority_station_id ="),
            7,
        )
        self.assertIn("message PutAttachmentChunkRequest", attachment)
        self.assertIn("string idempotency_key = 7;", attachment)
        self.assertIn("message CompleteAttachmentUploadResponse", attachment)
        self.assertIn("message GetAttachmentObjectRequest", attachment)
        self.assertIn("bytes expected_etag_sha256 = 3;", attachment)
        self.assertIn("message AttachmentTransferCheckpoint", attachment)
        self.assertIn("bytes completed_chunk_bitmap = 7;", attachment)
        self.assertIn(
            "ATTACHMENT_TRANSFER_ERROR_CODE_PART_CONFLICT = 2;",
            attachment,
        )
        self.assertIn("message AttachmentTransferError", attachment)
        self.assertIn("google.protobuf.Duration retry_after = 2;", attachment)

        descriptor = attachment.split(
            "message EncryptedObjectDescriptor", maxsplit=1
        )[1].split("message AttachmentPlaintextMetadata", maxsplit=1)[0]
        self.assertNotIn("object_key", descriptor)
        self.assertNotIn("base_nonce", descriptor)
        self.assertNotIn("filename", descriptor)
        self.assertNotIn("plaintext_sha256", descriptor)


if __name__ == "__main__":
    unittest.main()
