from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
MODEL_PROTO = ROOT / "model/domain"
CHAT_PROTO = MODEL_PROTO / "chat"
CAPABILITY_REGISTRY = (
    ROOT / "docs/architecture/api-ownership/station-api-capabilities.yaml"
)


def read_source_tree(root: Path, suffixes: set[str]) -> str:
    sources: list[str] = []
    for path in root.rglob("*"):
        if (
            path.is_file()
            and path.suffix in suffixes
            and not path.name.endswith("_test.go")
            and not any(part in {"gen", "node_modules", "target"} for part in path.parts)
        ):
            sources.append(path.read_text(encoding="utf-8", errors="replace"))
    return "\n".join(sources)


def declared_proto_symbols() -> set[str]:
    declarations: set[str] = set()
    for path in MODEL_PROTO.rglob("*.proto"):
        source = path.read_text(encoding="utf-8")
        package_match = re.search(r"^package\s+([\w.]+);", source, re.MULTILINE)
        if package_match is None:
            continue
        package = package_match.group(1)
        for symbol in re.findall(
            r"^\s*(?:message|enum|service)\s+(\w+)",
            source,
            re.MULTILINE,
        ):
            declarations.add(f"{package}.{symbol}")
    return declarations


def registry_superseded_symbols() -> set[str]:
    symbols: set[str] = set()
    collecting = False
    for line in CAPABILITY_REGISTRY.read_text(encoding="utf-8").splitlines():
        if line.strip() == "superseded_symbols:":
            collecting = True
            continue
        if collecting and line.startswith("      - peers_touch."):
            symbols.add(line.split("- ", maxsplit=1)[1].strip())
            continue
        if collecting and line.strip():
            collecting = False
    return symbols


class MessagingPlatformContractTest(unittest.TestCase):
    def assert_proto_declares(self, source: str, *symbols: str) -> None:
        for symbol in symbols:
            with self.subTest(symbol=symbol):
                self.assertRegex(
                    source,
                    rf"(?m)^\s*(?:message|enum)\s+{re.escape(symbol)}\b",
                )

    def test_canonical_proto_sources_replace_retired_chat_contracts(self) -> None:
        canonical_sources = {
            MODEL_PROTO / "actor/actor.proto": "package peers_touch.model.actor.v1;",
            CHAT_PROTO / "conversation_api.proto": "package peers_touch.model.chat.v1;",
            CHAT_PROTO / "queue.proto": "package peers_touch.model.chat.v1;",
            MODEL_PROTO / "recovery/recovery.proto": (
                "package peers_touch.model.recovery.v1;"
            ),
            MODEL_PROTO / "key_exchange/key_exchange.proto": (
                "package peers_touch.model.key_exchange.v1;"
            ),
            MODEL_PROTO / "federation/delivery.proto": (
                "package peers_touch.model.federation.v1;"
            ),
        }
        for path, package in canonical_sources.items():
            with self.subTest(path=path.relative_to(ROOT)):
                self.assertTrue(path.is_file())
                self.assertIn(package, path.read_text(encoding="utf-8"))

        for retired_name in (
            "device.proto",
            "federation.proto",
            "key_exchange.proto",
            "messaging_api.proto",
            "recovery.proto",
        ):
            with self.subTest(retired_name=retired_name):
                self.assertFalse((CHAT_PROTO / retired_name).exists())

        endpoint = (CHAT_PROTO / "endpoint.proto").read_text(encoding="utf-8")
        self.assertIn("message CryptoEndpoint", endpoint)
        self.assertIn("string ptid = 1;", endpoint)
        self.assertIn("string device_id = 2;", endpoint)

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
        self.assertIn(
            "peers_touch.model.actor.v1.ActorDeviceRef recipient = 2;",
            queue,
        )

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

    def test_conversation_contract_binds_canonical_authority_plan(self) -> None:
        command = (CHAT_PROTO / "command.proto").read_text(encoding="utf-8")
        api = (CHAT_PROTO / "conversation_api.proto").read_text(encoding="utf-8")

        self.assertIn("bytes delivery_plan_sha256 = 7;", command)
        self.assert_proto_declares(
            api,
            "CreateDirectConversationRequest",
            "CreateDirectConversationResponse",
            "ListConversationsRequest",
            "ListConversationsResponse",
            "PrepareConversationCommandRequest",
            "PrepareConversationCommandResponse",
            "PrepareConversationGroupRequest",
            "PrepareConversationGroupResponse",
            "PrepareConversationMembershipRequest",
            "PrepareConversationMembershipResponse",
            "SubmitConversationAuthorityCommandRequest",
            "SubmitConversationAuthorityCommandResponse",
        )
        self.assertIn(
            "repeated peers_touch.model.actor.v1.ActorDeviceRef required_endpoints = 7;",
            api,
        )
        self.assertIn("bytes delivery_plan_sha256 = 8;", api)

    def test_production_runtime_registers_canonical_resource_routes(self) -> None:
        station_main = (ROOT / "apps/station/app/main.go").read_text(encoding="utf-8")
        station_source = read_source_tree(
            ROOT / "apps/station/app/subserver",
            {".go"},
        )
        registry = CAPABILITY_REGISTRY.read_text(encoding="utf-8")
        desktop_state = (
            ROOT / "apps/desktop/src-tauri/src/state/mod.rs"
        ).read_text(encoding="utf-8")
        auth_service = (
            ROOT / "apps/desktop/src-tauri/src/application/auth/service.rs"
        ).read_text(encoding="utf-8")

        for owner in (
            "actor_identity",
            "conversation",
            "federation",
            "key_exchange",
            "recovery",
        ):
            with self.subTest(owner=owner):
                self.assertEqual(
                    station_main.count(f'server.WithSubServer("{owner}"'),
                    1,
                )
        self.assertNotIn('"conversation_engine"', station_main)
        self.assertNotIn('server.WithSubServer("messaging"', station_main)

        for route in (
            "/conversation/direct",
            "/conversation/group",
            "/conversation/group/prepare",
            "/conversation/membership/prepare",
            "/conversation/list",
            "/conversation/command/prepare",
            "/conversation/command",
            "/device/enroll",
            "/device/list",
            "/device/revoke",
            "/device/inbox/claim",
            "/device/inbox/ack",
            "/device/inbox/reject",
            "/recovery/revision",
            "/recovery/latest",
            "/key-exchange/keys/bundle",
            "/key-exchange/keys/bundle/fetch",
            "/key-exchange/keys/replenish",
            "/key-exchange/keys/count",
            "/key-exchange/mls/key-package/upload",
            "/key-exchange/mls/key-package/fetch",
            "/key-exchange/mls/key-package/count",
            "/key-exchange/dkx/send",
            "/federation/delivery",
            "/federation/actor/endpoint-manifest",
            "/federation/conversation/command/prepare",
            "/federation/key-exchange/mls-key-package/claim",
            "/conversation/typing",
            "/conversation/read-cursor",
            "/conversation/delivery/receipt",
        ):
            with self.subTest(route=route):
                self.assertIn(f"path: {route}", registry)
                self.assertIn(f'"{route}"', station_source)

        self.assertIn("pub messaging_engines: EngineRegistry", desktop_state)
        self.assertIn("activate_messaging_profile(", auth_service)
        self.assertIn("deactivate_messaging_profile(", auth_service)

    def test_conversation_is_the_only_public_chat_route_owner(self) -> None:
        self.assertFalse(
            (ROOT / "apps/station/app/subserver/messaging").exists(),
            "the deleted Station Messaging facade must not be restored",
        )

        route_literal = re.compile(r"""["']/messaging/""")
        source_roots = (
            ROOT / "apps/station/app",
            ROOT / "apps/desktop/src",
            ROOT / "apps/desktop/src-tauri/src",
            ROOT / "apps/mobile/src",
            ROOT / "apps/mobile/src-tauri/src",
            ROOT / "model/domain",
        )
        violations: list[str] = []
        for source_root in source_roots:
            for path in source_root.rglob("*"):
                if (
                    not path.is_file()
                    or path.suffix not in {".go", ".proto", ".rs", ".ts", ".tsx"}
                    or path.name.endswith("_test.go")
                    or any(part in {"gen", "node_modules", "target"} for part in path.parts)
                ):
                    continue
                for line_number, line in enumerate(
                    path.read_text(encoding="utf-8", errors="replace").splitlines(),
                    start=1,
                ):
                    if route_literal.search(line):
                        violations.append(
                            f"{path.relative_to(ROOT)}:{line_number}: {line.strip()}"
                        )

        self.assertEqual(violations, [])

        superseded = registry_superseded_symbols()
        self.assertTrue(superseded, "capability registry exposed no superseded symbols")
        self.assertEqual(sorted(superseded & declared_proto_symbols()), [])

        self.assertTrue((ROOT / "packages/messaging-core").is_dir())
        self.assertTrue((ROOT / "apps/desktop/src-tauri/src/messaging").is_dir())
        self.assertTrue((ROOT / "apps/mobile/src-tauri/src/messaging").is_dir())

    def test_profile_engine_uses_canonical_key_exchange_service_and_api(self) -> None:
        desktop_messaging = ROOT / "apps/desktop/src-tauri/src/messaging"
        lifecycle = (desktop_messaging / "lifecycle.rs").read_text(encoding="utf-8")
        prekeys = (desktop_messaging / "prekeys.rs").read_text(encoding="utf-8")
        mls_key_packages = (desktop_messaging / "mls_key_packages.rs").read_text(
            encoding="utf-8"
        )
        engine = (desktop_messaging / "engine.rs").read_text(encoding="utf-8")
        key_exchange_handler = (
            ROOT / "apps/station/app/subserver/key_exchange/handler.go"
        ).read_text(encoding="utf-8")
        key_exchange_subserver = (
            ROOT / "apps/station/app/subserver/key_exchange/subserver.go"
        ).read_text(encoding="utf-8")
        key_exchange_api = (
            ROOT
            / "apps/station/app/subserver/key_exchange/interface/http/canonical.go"
        ).read_text(encoding="utf-8")

        self.assertIn("pub struct MessagingLifecycleWorker", lifecycle)
        self.assertIn("engine.enroll_pending_device(", lifecycle)
        self.assertIn("engine.dispatch_command_once(", lifecycle)
        self.assertIn("engine.resume_membership_intent_once(", lifecycle)
        self.assertIn("engine.drain_once(", lifecycle)
        self.assertIn("PreKeyPublisher", prekeys)
        self.assertIn("messaging_core::crypto::prekeys", prekeys)
        self.assertIn("engine.publish_prekeys(token)", lifecycle)
        self.assertTrue((desktop_messaging / "direct_session.rs").exists())
        self.assertIn(
            "direct_session_bootstraps",
            (desktop_messaging / "store.rs").read_text(encoding="utf-8"),
        )
        self.assertIn("MlsKeyPackageTransport", mls_key_packages)
        self.assertIn('"/key-exchange/mls/key-package/upload"', mls_key_packages)
        self.assertIn("engine.publish_mls_key_packages(token)", lifecycle)
        self.assertIn("activate_profile_worker(", engine)

        self.assertIn("application.NewCanonicalService(", key_exchange_subserver)
        self.assertIn("httpinterface.NewCanonicalAPI(service)", key_exchange_subserver)
        self.assertIn("type CanonicalAPI struct", key_exchange_api)
        self.assertIn("authenticatedKeyExchangeEndpoint(ctx)", key_exchange_handler)
        for operation in (
            "UploadDirectKeyBundle",
            "FetchDirectKeyBundles",
            "ReplenishDirectOneTimePreKeys",
            "CountDirectOneTimePreKeys",
            "UploadMLSKeyPackage",
            "FetchMLSKeyPackage",
            "CountMLSKeyPackages",
            "SendDirectKeyExchange",
        ):
            with self.subTest(operation=operation):
                self.assertIn(f"s.api.{operation}(", key_exchange_handler)
        self.assertNotIn("requireVerifiedActiveDevice", key_exchange_handler)

    def test_device_inbox_ack_is_fenced_and_hash_bound(self) -> None:
        queue = (CHAT_PROTO / "queue.proto").read_text(encoding="utf-8")

        self.assert_proto_declares(
            queue,
            "DeviceInboxPayloadType",
            "DeviceInboxItemState",
            "DeviceInboxRejectCode",
            "DeviceInboxLease",
            "DurableDeviceInboxItem",
            "ClaimDeviceInboxRequest",
            "ClaimDeviceInboxResponse",
            "AcknowledgeDeviceInboxItemRequest",
            "AcknowledgeDeviceInboxItemResponse",
            "RejectDeviceInboxItemRequest",
            "RejectDeviceInboxItemResponse",
            "DeviceInboxWakeHint",
        )
        self.assertIn(
            "peers_touch.model.actor.v1.ActorDeviceRef device = 1;",
            queue,
        )
        self.assertIn("int64 lane_sequence = 3;", queue)
        self.assertIn("uint64 consumer_epoch = 4;", queue)
        self.assertIn("bytes payload_sha256 = 5;", queue)

    def test_device_enrollment_is_actor_cross_signed(self) -> None:
        actor = (MODEL_PROTO / "actor/actor.proto").read_text(encoding="utf-8")

        self.assert_proto_declares(
            actor,
            "ActorDeviceRef",
            "ActorDeviceCertificate",
            "ActorDevice",
            "EnrollActorDeviceRequest",
            "EnrollActorDeviceResponse",
            "ListActorDevicesRequest",
            "ListActorDevicesResponse",
            "RevokeActorDeviceRequest",
            "RevokeActorDeviceResponse",
            "ActorEndpointManifest",
        )
        self.assertIn("ActorDeviceRef device = 2;", actor)
        self.assertIn("bytes actor_identity_public_key = 3;", actor)
        self.assertIn("bytes actor_identity_key_fingerprint = 4;", actor)
        self.assertIn("bytes device_signing_public_key = 5;", actor)
        self.assertIn("string signing_key_id = 6;", actor)
        self.assertIn("uint64 observed_profile_version = 7;", actor)
        self.assertIn("ActorDeviceCertificate certificate = 1;", actor)
        self.assertIn("bytes actor_cross_signature = 3;", actor)

    def test_federation_frame_is_signed_hash_bound_and_preserves_event_identity(self) -> None:
        federation = (
            MODEL_PROTO / "federation/delivery.proto"
        ).read_text(encoding="utf-8")

        self.assert_proto_declares(
            federation,
            "FederatedDomainPayloadKind",
            "FederatedDomainFrameDisposition",
            "FederatedDomainFrameErrorCode",
            "FederatedDomainFrameSigningInput",
            "FederatedDomainFrame",
            "DeliverFederatedDomainFrameRequest",
            "DeliverFederatedDomainFrameResponse",
        )
        self.assertIn("string source_station_peer_id = 3;", federation)
        self.assertIn("string target_station_peer_id = 4;", federation)
        self.assertIn("string idempotency_key = 5;", federation)
        self.assertIn("string ordering_key = 8;", federation)
        self.assertIn("int64 ordering_sequence = 9;", federation)
        self.assertIn("bytes payload_sha256 = 11;", federation)
        self.assertIn("bytes station_signature = 15;", federation)

    def test_recovery_archive_excludes_live_crypto_state(self) -> None:
        recovery = (
            MODEL_PROTO / "recovery/recovery.proto"
        ).read_text(encoding="utf-8")

        self.assert_proto_declares(
            recovery,
            "OpaqueRecoveryArchiveSectionKind",
            "OpaqueRecoveryArchiveSection",
            "OpaqueRecoveryArchiveManifest",
            "StoreRecoveryRevisionRequest",
            "StoreRecoveryRevisionResponse",
            "ReadLatestRecoveryRevisionRequest",
            "ReadLatestRecoveryRevisionResponse",
        )
        self.assertIn(
            "OPAQUE_RECOVERY_ARCHIVE_SECTION_KIND_MESSAGE_HISTORY",
            recovery,
        )
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
