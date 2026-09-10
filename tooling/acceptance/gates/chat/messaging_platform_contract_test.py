from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
CHAT_PROTO = ROOT / "model/domain/chat"


def text_offenders(
    paths: tuple[Path, ...],
    forbidden: tuple[str, ...],
) -> dict[str, list[str]]:
    offenders: dict[str, list[str]] = {}
    for path in paths:
        source = path.read_text(encoding="utf-8")
        matches = [value for value in forbidden if value in source]
        if matches:
            offenders[str(path.relative_to(ROOT))] = matches
    return offenders


class MessagingPlatformContractTest(unittest.TestCase):
    def test_conversation_ddd_owns_member_settings_by_ptid(self) -> None:
        conversation_api = (CHAT_PROTO / "conversation_api.proto").read_text(
            encoding="utf-8"
        )
        persistence = (
            ROOT
            / "apps/station/app/subserver/conversation/infrastructure/persistence/models.go"
        ).read_text(encoding="utf-8")
        command_service = (
            ROOT
            / "apps/station/app/subserver/conversation/application/command/projections.go"
        ).read_text(encoding="utf-8")
        query_service = (
            ROOT
            / "apps/station/app/subserver/conversation/application/query/service.go"
        ).read_text(encoding="utf-8")
        conversation_subserver = (
            ROOT / "apps/station/app/subserver/conversation/subserver.go"
        ).read_text(encoding="utf-8")
        desktop_sources = tuple(
            (ROOT / "apps/desktop/src-tauri/src").rglob("*.rs")
        ) + tuple((ROOT / "apps/desktop/src").rglob("*.ts*"))

        self.assertIn('"/conversation/member/settings"', conversation_subserver)
        self.assertIn("message MemberSettings", conversation_api)
        self.assertIn("message GetMemberSettingsRequest", conversation_api)
        self.assertIn("message UpdateMemberSettingsRequest", conversation_api)
        self.assertIn('return "conversation_member_settings"', persistence)
        self.assertIn("PTID", persistence)
        self.assertIn("UpdateMemberSettings(", command_service)
        self.assertIn("MemberSettings(", query_service)
        self.assertEqual(
            text_offenders(
                desktop_sources,
                (
                    "GroupChatThreadCountsInput",
                    "ConversationThreadCountsInput",
                    "ConversationMemberSettingsInput",
                    "ConversationUpdateMemberSettingsInput",
                ),
            ),
            {},
        )

    def test_crypto_endpoint_has_one_canonical_source(self) -> None:
        endpoint = (CHAT_PROTO / "endpoint.proto").read_text(encoding="utf-8")
        actor = (ROOT / "model/domain/actor/actor.proto").read_text(
            encoding="utf-8"
        )

        self.assertIn("message CryptoEndpoint", endpoint)
        self.assertIn("string ptid = 1;", endpoint)
        self.assertIn("string device_id = 2;", endpoint)
        self.assertIn("message ActorDeviceRef", actor)
        self.assertIn("ActorRef actor = 1;", actor)
        self.assertTrue(
            (ROOT / "model/domain/key_exchange/key_exchange.proto").exists()
        )
        self.assertFalse((CHAT_PROTO / "key_exchange.proto").exists())

    def test_logical_event_and_device_delivery_identities_are_separate(self) -> None:
        queue = (CHAT_PROTO / "queue.proto").read_text(encoding="utf-8")
        command = (CHAT_PROTO / "command.proto").read_text(encoding="utf-8")
        event = (CHAT_PROTO / "event.proto").read_text(encoding="utf-8")

        self.assertIn("message ChatCommand", command)
        self.assertIn("message ConversationEvent", event)
        self.assertIn("string event_id = 1;", event)
        self.assertIn("repeated bytes delivery_commitments = 9;", event)
        self.assertIn("message DurableDeviceInboxItem", queue)
        self.assertIn("string item_id = 1;", queue)
        self.assertIn("int64 lane_sequence = 3;", queue)
        self.assertIn("string event_id = 4;", queue)
        self.assertIn(
            "peers_touch.model.actor.v1.ActorDeviceRef recipient = 2;",
            queue,
        )
        self.assertNotIn("message DeviceQueueItem", queue)

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

    def test_client_conversation_projection_preserves_federation_identity(self) -> None:
        schema = (
            ROOT / "packages/messaging-core/src/store/schema.rs"
        ).read_text(encoding="utf-8")
        core_contract = (
            ROOT / "packages/messaging-core/src/contracts/mod.rs"
        ).read_text(encoding="utf-8")
        core_event_projection = (
            ROOT / "packages/messaging-core/src/inbox/conversation_state.rs"
        ).read_text(encoding="utf-8")
        core_mls_projection = (
            ROOT / "packages/messaging-core/src/mls/inbound.rs"
        ).read_text(encoding="utf-8")
        desktop_store = (
            ROOT / "apps/desktop/src-tauri/src/messaging/store.rs"
        ).read_text(encoding="utf-8")
        desktop_event_projection = (
            ROOT / "apps/desktop/src-tauri/src/messaging/conversation_state.rs"
        ).read_text(encoding="utf-8")
        desktop_lifecycle = (
            ROOT / "apps/desktop/src-tauri/src/messaging/lifecycle.rs"
        ).read_text(encoding="utf-8")
        desktop_engine = (
            ROOT / "apps/desktop/src-tauri/src/messaging/engine.rs"
        ).read_text(encoding="utf-8")
        desktop_recovery = (
            ROOT / "apps/desktop/src-tauri/src/messaging/recovery.rs"
        ).read_text(encoding="utf-8")
        desktop_json = (
            ROOT
            / "apps/desktop/src-tauri/src/interface/tauri_commands/messaging.rs"
        ).read_text(encoding="utf-8")
        desktop_contract = (
            ROOT / "apps/desktop/src/services/im-service-contract.ts"
        ).read_text(encoding="utf-8")
        desktop_service = (
            ROOT / "apps/desktop/src/services/im-service.ts"
        ).read_text(encoding="utf-8")
        social_store = (
            ROOT / "apps/desktop/src/store/socialChat.ts"
        ).read_text(encoding="utf-8")
        mobile_store = (
            ROOT / "apps/mobile/src-tauri/src/messaging/adapter.rs"
        ).read_text(encoding="utf-8")
        mobile_engine = (
            ROOT / "apps/mobile/src-tauri/src/messaging/engine.rs"
        ).read_text(encoding="utf-8")
        mobile_lifecycle = (
            ROOT / "apps/mobile/src-tauri/src/messaging/lifecycle.rs"
        ).read_text(encoding="utf-8")
        mobile_transport = (
            ROOT / "apps/mobile/src-tauri/src/messaging/transport.rs"
        ).read_text(encoding="utf-8")
        mobile_commands = (
            ROOT / "apps/mobile/src-tauri/src/messaging/commands.rs"
        ).read_text(encoding="utf-8")
        mobile_contract = (
            ROOT / "apps/mobile/src/services/mobileCommands.ts"
        ).read_text(encoding="utf-8")
        mobile_acceptance_projection = (
            ROOT / "apps/mobile/src/acceptance/projection.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("federation_id TEXT NOT NULL", schema)
        self.assertIn('column: "federation_id"', schema)
        self.assertIn("pub federation_id: String", core_contract)
        self.assertIn(
            "federation_id: post_state.federation_id.clone()",
            core_event_projection,
        )
        self.assertIn(
            "federation_id: snapshot.federation_id.clone()",
            core_mls_projection,
        )
        self.assertIn("pub federation_id: String", desktop_store)
        self.assertIn(
            "federation_id: post_state.federation_id.clone()",
            desktop_event_projection,
        )
        self.assertIn(
            "projection.federation_id.trim().is_empty()",
            desktop_lifecycle,
        )
        self.assertNotIn(
            "if !self.store.conversation_projections()?.is_empty()",
            desktop_engine,
        )
        self.assertIn("pub federation_id: String", desktop_recovery)
        self.assertIn('"federation_id": conversation.federation_id', desktop_json)
        self.assertIn("federationId: string", desktop_contract)
        self.assertIn(
            "federationId: conversation.federation_id",
            desktop_service,
        )
        self.assertIn(
            "federation_id: conversation.federationId",
            social_store,
        )
        self.assertIn(
            "federation_id=excluded.federation_id",
            mobile_store,
        )
        self.assertIn(
            "pub(crate) fn reconcile_conversation_authority_scope",
            mobile_store,
        )
        self.assertIn(
            "hydrate_conversation_authority_scopes",
            mobile_engine,
        )
        self.assertIn(
            "dissolved_conversation_scope_remains_repairable",
            mobile_engine,
        )
        self.assertIn(
            "engine.hydrate_conversation_authority_scopes()?",
            mobile_lifecycle,
        )
        self.assertIn(
            ".list_conversations()?",
            mobile_engine,
        )
        self.assertIn(
            "pub fn list_conversations",
            mobile_transport,
        )
        self.assertIn(
            "conversation.federation_id == federation_id",
            mobile_commands,
        )
        self.assertIn(
            "federation_id: conversation.federation_id",
            mobile_commands,
        )
        self.assertIn("federationId: string", mobile_contract)
        self.assertIn(
            "federationId: conversation.federationId",
            mobile_acceptance_projection,
        )

    def test_group_genesis_uses_server_verified_endpoint_routes(self) -> None:
        production_http = (
            ROOT / "apps/station/app/subserver/conversation/production_http.go"
        ).read_text(encoding="utf-8")
        command_service = (
            ROOT
            / "apps/station/app/subserver/conversation/application/command/service.go"
        ).read_text(encoding="utf-8")
        reservation_adapter = (
            ROOT / "apps/station/app/subserver/conversation/production_adapters.go"
        ).read_text(encoding="utf-8")
        key_exchange = (
            ROOT
            / "apps/station/app/subserver/key_exchange/application/canonical_service.go"
        ).read_text(encoding="utf-8")
        desktop_transport = (
            ROOT / "apps/desktop/src-tauri/src/messaging/transport.rs"
        ).read_text(encoding="utf-8")
        desktop_consumer = (
            ROOT / "apps/desktop/src-tauri/src/messaging/consumer.rs"
        ).read_text(encoding="utf-8")
        desktop_command_result = (
            ROOT / "apps/desktop/src-tauri/src/messaging/command_result.rs"
        ).read_text(encoding="utf-8")
        production_federation = (
            ROOT
            / "apps/station/app/subserver/conversation/production_federation.go"
        ).read_text(encoding="utf-8")

        self.assertGreaterEqual(
            len(re.findall(r"VerifiedRoutes:\s+verifiedRoutes", production_http)),
            3,
        )
        self.assertGreaterEqual(
            len(re.findall(r"VerifiedRoutes\s+\[\]ports\.EndpointRoute", command_service)),
            2,
        )
        self.assertIn(
            "canonicalActorRoutes(request.VerifiedRoutes, actors)",
            command_service,
        )
        self.assertIn(
            "routes []ports.EndpointRoute",
            reservation_adapter,
        )
        self.assertNotIn(
            "r.identity.activeRoute(ctx, endpoint)",
            reservation_adapter,
        )
        self.assertIn(
            "ReserveMLSKeyPackageForVerifiedRoute",
            key_exchange,
        )
        self.assertIn(
            "productionEndpointManifestSetHashes",
            production_http,
        )
        self.assertIn(
            "ReplayGroupCreation",
            production_http,
        )
        self.assertLess(
            production_http.index("ReplayGroupCreation"),
            production_http.index("s.loadAuthorityPlan"),
        )
        self.assertIn(
            "EndpointManifestSetHash",
            command_service,
        )
        self.assertIn(
            "EndpointManifestStateHash",
            command_service,
        )
        create_group_request = re.search(
            r"type CreateGroupRequest struct \{(?P<body>.*?)\n\}",
            command_service,
            re.DOTALL,
        )
        self.assertIsNotNone(create_group_request)
        create_group_request_body = create_group_request.group("body")
        self.assertNotRegex(create_group_request_body, r"\bName\s+")
        self.assertNotRegex(create_group_request_body, r"\bMembers\s+")
        self.assertIn(
            "actors := productionPlanActors(plan)",
            production_http,
        )
        self.assertIn(
            'const GROUP_CREATION_PATH: &str = "/conversation/group";',
            desktop_transport,
        )
        self.assertIn(
            'const AUTHORITY_COMMAND_PATH: &str = "/conversation/command";',
            desktop_transport,
        )
        self.assertIn(
            "CreateGroupConversationRequest",
            desktop_transport,
        )
        self.assertIn(
            "command_submission_route(&command)",
            desktop_transport,
        )
        self.assertIn(
            "prepared_epoch_zero_group_genesis_uses_group_creation_route",
            desktop_transport,
        )
        self.assertIn(
            "ordinary_commands_use_authority_command_route",
            desktop_transport,
        )
        self.assertIn(
            "with_remote_command_identity",
            desktop_transport,
        )
        self.assertIn(
            "Submission::Proposal",
            desktop_transport,
        )
        self.assertIn(
            '"/conversation/public-head"',
            desktop_transport,
        )
        self.assertIn(
            "remote_command_proposal_is_device_signed_and_exactly_repeatable",
            desktop_transport,
        )
        self.assertIn(
            "DeviceInboxPayloadType::CommandResult",
            desktop_consumer,
        )
        self.assertIn(
            "commit_command_result",
            desktop_command_result,
        )
        self.assertIn(
            "discard_pending_transition",
            desktop_command_result,
        )
        self.assertIn(
            "existingConversationProposalReplay",
            production_federation,
        )
        self.assertIn(
            "validateNewConversationProposal",
            production_federation,
        )
        self.assertIn(
            "validateConversationProposalFollowerHead",
            production_federation,
        )
        self.assertIn(
            "group_creation_request_preserves_exact_command_bytes",
            desktop_transport,
        )

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
        conversation = (CHAT_PROTO / "conversation.proto").read_text(
            encoding="utf-8"
        )
        api = (CHAT_PROTO / "conversation_api.proto").read_text(encoding="utf-8")

        self.assertIn("bytes delivery_plan_sha256 = 7;", command)
        self.assertIn("message PrepareConversationCommandRequest", api)
        self.assertIn("message PrepareConversationCommandResponse", api)
        self.assertIn(
            "repeated peers_touch.model.actor.v1.ActorDeviceRef required_endpoints = 7;",
            api,
        )
        self.assertIn("bytes delivery_plan_sha256 = 8;", api)
        self.assertIn(
            "CONVERSATION_COMMAND_REJECT_CODE_STALE_DELIVERY_PLAN = 20;",
            conversation,
        )
        self.assertIn("message SubmitConversationAuthorityCommandRequest", api)
        self.assertIn("message SubmitConversationAuthorityCommandResponse", api)

    def test_production_runtime_registers_resource_routes_and_profile_engine(self) -> None:
        station_main = (ROOT / "apps/station/app/main.go").read_text(encoding="utf-8")
        station_owner_roots = (
            ROOT / "apps/station/app/subserver/conversation",
            ROOT / "apps/station/app/subserver/actor_identity",
            ROOT / "apps/station/app/subserver/key_exchange",
            ROOT / "apps/station/app/subserver/recovery",
            ROOT / "apps/station/frame/core/federation",
        )
        resource_owner_source = "\n".join(
            path.read_text(encoding="utf-8")
            for owner_root in station_owner_roots
            for path in owner_root.rglob("*.go")
            if "engine" not in path.parts and not path.name.endswith("_test.go")
        )
        desktop_state = (
            ROOT / "apps/desktop/src-tauri/src/state/mod.rs"
        ).read_text(encoding="utf-8")
        auth_service = (
            ROOT / "apps/desktop/src-tauri/src/application/auth/service.rs"
        ).read_text(encoding="utf-8")

        self.assertEqual(
            station_main.count('server.WithSubServer("conversation"'),
            1,
        )
        self.assertNotIn('"conversation_engine"', station_main)
        self.assertNotIn("conversationengine", station_main)
        self.assertEqual(
            station_main.count('server.WithSubServer("actor_identity"'),
            1,
        )
        self.assertEqual(
            station_main.count('server.WithSubServer("recovery"'),
            1,
        )
        self.assertEqual(
            station_main.count('server.WithSubServer("key_exchange"'),
            1,
        )
        self.assertNotIn('server.WithSubServer("messaging"', station_main)
        for route in (
            "/conversation/direct",
            "/conversation/group/prepare",
            "/conversation/membership/prepare",
            "/conversation/list",
            "/conversation/command/prepare",
            "/conversation/command",
            "/device/enroll",
            "/device/inbox/claim",
            "/device/inbox/ack",
            "/device/inbox/reject",
            "/recovery/revision",
            "/recovery/latest",
            "/conversation/attachments/uploads:begin",
            "/federation/delivery",
            "/federation/actor/endpoint-manifest",
            "/federation/conversation/command/prepare",
            "/federation/key-exchange/mls-key-package/claim",
            "/conversation/typing",
            "/conversation/read-cursor",
            "/conversation/delivery/receipt",
        ):
            self.assertIn(route, resource_owner_source)
        self.assertNotIn('"/messaging/', resource_owner_source)
        self.assertFalse(
            (ROOT / "apps/station/app/subserver/conversation/engine").exists()
        )
        self.assertIn("pub messaging_engines: EngineRegistry", desktop_state)
        self.assertIn("activate_messaging_profile(", auth_service)
        self.assertIn("deactivate_messaging_profile(", auth_service)

    def test_conversation_is_the_only_public_chat_route_owner(self) -> None:
        self.assertFalse(
            (ROOT / "apps/station/app/subserver/messaging").exists(),
            "the deleted Station Messaging facade must not be restored",
        )
        self.assertFalse(
            (ROOT / "apps/station/app/subserver/envelope").exists(),
            "the retired Station Envelope owner must not be restored",
        )

        route_literal = re.compile(r"""["']/(?:messaging|envelope)/""")
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

    def test_retired_station_authority_and_proto_sources_are_absent(self) -> None:
        self.assertFalse(
            (ROOT / "apps/station/app/subserver/conversation/engine").exists()
        )
        for retired_proto in (
            "device.proto",
            "envelope.proto",
            "envelope_api.proto",
            "key_exchange.proto",
            "messaging_api.proto",
            "recovery.proto",
        ):
            self.assertFalse((CHAT_PROTO / retired_proto).exists(), retired_proto)

        ownership = (
            ROOT
            / "docs/architecture/api-ownership/station-api-capabilities.yaml"
        ).read_text(encoding="utf-8")
        target_absent_stores = ownership.split(
            "target_absent_truth_stores:",
            maxsplit=1,
        )[1]
        retired_tables = tuple(
            re.findall(r"^  - ([a-z0-9_]+)$", target_absent_stores, re.MULTILINE)
        )
        self.assertTrue(retired_tables)

        production_sources = tuple(
            path
            for root in (
                ROOT / "apps/station/app",
                ROOT / "apps/station/frame",
            )
            for path in root.rglob("*.go")
            if not path.name.endswith("_test.go")
        )
        self.assertEqual(
            text_offenders(production_sources, retired_tables),
            {},
        )

    def test_desktop_uses_resource_owned_key_exchange_routes(self) -> None:
        desktop_rust = ROOT / "apps/desktop/src-tauri/src"
        legacy_route = re.compile(
            r"""["']/(?:keypackage/(?:upload|fetch|count)|dkx/send)["']"""
        )
        violations: list[str] = []
        for path in desktop_rust.rglob("*.rs"):
            if any(part == "target" for part in path.parts):
                continue
            for line_number, line in enumerate(
                path.read_text(encoding="utf-8", errors="replace").splitlines(),
                start=1,
            ):
                if legacy_route.search(line):
                    violations.append(
                        f"{path.relative_to(ROOT)}:{line_number}: {line.strip()}"
                    )

        self.assertEqual(violations, [])

        mls_transport = (
            desktop_rust / "messaging/mls_key_packages.rs"
        ).read_text(encoding="utf-8")
        self.assertIn(
            '"/key-exchange/mls/key-package/upload"',
            mls_transport,
        )

        canonical_routes = (
            "/key-exchange/mls/key-package/upload",
            "/key-exchange/mls/key-package/fetch",
            "/key-exchange/mls/key-package/count",
            "/key-exchange/dkx/send",
        )
        for relative_path in (
            "interface/http_gateway/mod.rs",
            "interface/tauri_commands/conversation.rs",
        ):
            source = (desktop_rust / relative_path).read_text(encoding="utf-8")
            for route in canonical_routes:
                self.assertIn(f'"{route}"', source)

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
        key_exchange_device_directory = (
            ROOT / "apps/station/app/subserver/key_exchange/production_ports.go"
        ).read_text(encoding="utf-8")

        self.assertIn("pub struct MessagingLifecycleWorker", lifecycle)
        self.assertIn("engine.enroll_pending_device(", lifecycle)
        self.assertIn("engine.dispatch_command_once(", lifecycle)
        self.assertIn("engine.resume_membership_intent_once(", lifecycle)
        self.assertIn("engine.drain_once(", lifecycle)
        self.assertIn("PreKeyPublisher", prekeys)
        self.assertIn("messaging_core::crypto::prekeys", prekeys)
        self.assertIn("engine.publish_prekeys(token)", lifecycle)
        self.assertTrue((messaging / "direct_session.rs").exists())
        self.assertIn(
            "direct_session_bootstraps",
            (messaging / "store.rs").read_text(encoding="utf-8"),
        )
        self.assertIn("MlsKeyPackageTransport", mls_key_packages)
        self.assertIn(
            '"/key-exchange/mls/key-package/upload"',
            mls_key_packages,
        )
        self.assertIn("engine.publish_mls_key_packages(token)", lifecycle)
        self.assertIn("activate_profile_worker(", engine)
        self.assertIn("authenticatedCanonicalAPI(", key_exchange)
        self.assertIn("ResolveActiveDevice(", key_exchange_device_directory)
        self.assertIn("IsVerifiedActive(", key_exchange_device_directory)

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

        self.assertIn("message AcknowledgeDeviceInboxItemRequest", queue)
        self.assertIn(
            "peers_touch.model.actor.v1.ActorDeviceRef device = 1;",
            queue,
        )
        self.assertIn("int64 lane_sequence = 3;", queue)
        self.assertIn("uint64 consumer_epoch = 4;", queue)
        self.assertIn("bytes payload_sha256 = 5;", queue)
        self.assertNotIn("message AcknowledgeDeviceQueueItemRequest", queue)

    def test_device_enrollment_is_actor_cross_signed(self) -> None:
        actor = (ROOT / "model/domain/actor/actor.proto").read_text(
            encoding="utf-8"
        )

        self.assertIn("message ActorDeviceCertificate", actor)
        self.assertIn("ActorDeviceRef device = 2;", actor)
        self.assertIn("bytes actor_identity_public_key = 3;", actor)
        self.assertIn("bytes actor_identity_key_fingerprint = 4;", actor)
        self.assertIn("bytes device_signing_public_key = 5;", actor)
        self.assertIn("string signing_key_id = 6;", actor)
        self.assertIn("uint64 observed_profile_version = 7;", actor)
        self.assertIn("ActorDeviceCertificate certificate = 1;", actor)
        self.assertIn("bytes actor_cross_signature = 3;", actor)
        self.assertFalse((CHAT_PROTO / "device.proto").exists())

    def test_federation_frame_is_signed_hash_bound_and_preserves_event_identity(self) -> None:
        delivery = (
            ROOT / "model/domain/federation/delivery.proto"
        ).read_text(encoding="utf-8")
        conversation_federation = (CHAT_PROTO / "federation.proto").read_text(
            encoding="utf-8"
        )

        self.assertIn("message FederatedDomainFrameSigningInput", delivery)
        self.assertIn("message FederatedDomainFrame", delivery)
        self.assertIn("string source_station_peer_id = 3;", delivery)
        self.assertIn("string target_station_peer_id = 4;", delivery)
        self.assertIn("string idempotency_key = 5;", delivery)
        self.assertIn("string payload_id = 7;", delivery)
        self.assertIn("string ordering_key = 8;", delivery)
        self.assertIn("int64 ordering_sequence = 9;", delivery)
        self.assertIn("bytes payload_sha256 = 11;", delivery)
        self.assertIn("bytes station_signature = 15;", delivery)
        self.assertIn(
            "message ConversationFollowerProjection",
            conversation_federation,
        )
        self.assertNotIn(
            "message MessagingFederationFrame",
            conversation_federation,
        )

    def test_inter_station_messaging_control_plane_uses_protobuf(self) -> None:
        frame = (
            ROOT / "apps/station/frame/core/federation/delivery/frame.go"
        ).read_text(encoding="utf-8")
        transport = (
            ROOT / "apps/station/frame/core/federation/transport.go"
        ).read_text(encoding="utf-8")
        conversation_sender = (
            ROOT
            / "apps/station/app/subserver/conversation/infrastructure/federation/sender.go"
        ).read_text(encoding="utf-8")
        routes = (
            ROOT / "apps/station/frame/core/federation/routes.go"
        ).read_text(encoding="utf-8")

        for source in (frame, transport, conversation_sender):
            self.assertIn('"google.golang.org/protobuf/proto"', source)
            self.assertNotIn("protojson", source)
        self.assertIn(
            'request.Header.Set("Content-Type", "application/protobuf")',
            transport,
        )
        self.assertIn(
            'request.Header.Set("Accept", "application/protobuf")',
            transport,
        )
        self.assertIn('DeliveryRoute = "/federation/delivery"', routes)
        self.assertIn(
            'ConversationFollowerEventsRoute = '
            '"/federation/conversation/follower/events"',
            routes,
        )

    def test_recovery_archive_excludes_live_crypto_state(self) -> None:
        recovery = (
            ROOT / "model/domain/recovery/recovery.proto"
        ).read_text(encoding="utf-8")

        self.assertIn("RECOVERY_ARCHIVE_SECTION_KIND_MESSAGE_HISTORY", recovery)
        self.assertNotIn("RATCHET", recovery)
        self.assertNotIn("SKIPPED_KEY", recovery)
        self.assertNotIn("MLS_STATE", recovery)
        self.assertFalse((CHAT_PROTO / "recovery.proto").exists())

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
