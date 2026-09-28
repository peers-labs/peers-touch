from __future__ import annotations

import dataclasses
import os
import shutil
import socket
import subprocess
import tempfile
from pathlib import Path

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.attestation import (
    commits_match,
    produce_station_attestation,
    source_proto_digest,
)
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.provisioner import EnvironmentProvisioner
from tooling.acceptance.core.provisioning import (
    ClientRuntime,
    EnvironmentContract,
    ProvisioningState,
    RuntimeManifest,
)
from tooling.acceptance.fixtures.chat_native_actors import produce_actor_manifest
from tooling.acceptance.provisioners.remote_source_identity import (
    resolve_remote_source_identity,
)


GATE_ROLES = {
    "agent-attachment-e2e": ("alice",),
    "agent-core-lifecycle-native-e2e": ("alice",),
    "agent-stream-resilience-e2e": ("alice",),
    "agent-v2-capability-binding-e2e": ("alice", "bob"),
    "agent-v2-governed-tool-loop-e2e": ("bob",),
    "agent-v2-mcp-lifecycle-e2e": ("bob",),
    "agent-v2-connector-invocation-e2e": ("bob",),
    "agent-v2-evaluation-lab-e2e": ("alice", "bob"),
    "agent-marketplace-catalog-e2e": ("alice",),
    "chat-native-two-client-e2e": ("alice", "bob"),
    "chat-presence-layout-e2e": ("alice", "bob"),
    "chat-native-interactions-e2e": ("alice", "bob", "charlie"),
    "chat-lifecycle-interactions-group-e2e": ("alice", "bob", "charlie"),
    "chat-native-typing-e2e": ("alice", "bob", "charlie"),
    "chat-native-multi-device-e2e": ("alice", "bob"),
    "chat-native-recovery-e2e": ("alice", "bob"),
    "chat-native-group-mls-e2e": ("alice", "bob", "charlie"),
    "chat-lifecycle-group-live-e2e": ("alice", "bob", "charlie"),
    "chat-native-product-closure-e2e": ("alice", "bob"),
    "chat-contact-message-resilience-e2e": ("alice", "bob"),
}

AGENT_V2_FOUNDATION_GATE = "agent-v2-kernel-foundation-e2e"
AGENT_V2_HOME_GATE = "agent-v2-home-command-center-e2e"
AGENT_V2_BINDING_GATE = "agent-v2-capability-binding-e2e"
AGENT_V2_GOVERNED_TOOL_GATE = "agent-v2-governed-tool-loop-e2e"
AGENT_V2_MCP_GATE = "agent-v2-mcp-lifecycle-e2e"
AGENT_V2_CONNECTOR_GATE = "agent-v2-connector-invocation-e2e"
AGENT_V2_EVALUATION_GATE = "agent-v2-evaluation-lab-e2e"
AGENT_MARKETPLACE_GATE = "agent-marketplace-catalog-e2e"
AGENT_CORE_LIFECYCLE_GATE = "agent-core-lifecycle-native-e2e"
AGENT_NATIVE_GATES = frozenset(
    {
        "agent-attachment-e2e",
        "agent-core-lifecycle-native-e2e",
        "agent-stream-resilience-e2e",
    }
)
AGENT_V2_PROFILE = os.environ.get("PT_ACCEPTANCE_APPROVED_PROFILE", "one")
AGENT_V2_BINDING_PROFILE = "two"
AGENT_V2_BINDING_GATES = frozenset(
    {
        AGENT_CORE_LIFECYCLE_GATE,
        AGENT_V2_HOME_GATE,
        AGENT_V2_BINDING_GATE,
        AGENT_V2_GOVERNED_TOOL_GATE,
        AGENT_V2_MCP_GATE,
        AGENT_V2_CONNECTOR_GATE,
        AGENT_V2_EVALUATION_GATE,
        AGENT_MARKETPLACE_GATE,
    }
)
AGENT_V2_CREDENTIAL_REFS = (
    "profile:CHAT_NATIVE_DEMO_PASSWORD",
    "profile:PT_AGENT_PROVIDER_API_KEY",
    "profile:PT_AGENT_DEFAULT_MODEL_ID",
)

CLIENT_ROLES = {
    "chat-native-two-client-e2e": ("alice", "bob"),
    "chat-presence-layout-e2e": ("alice", "bob"),
    "chat-native-interactions-e2e": ("alice", "bob", "charlie"),
    "chat-lifecycle-interactions-group-e2e": ("alice", "bob", "charlie"),
    "chat-native-typing-e2e": ("alice", "bob", "charlie"),
    "chat-native-multi-device-e2e": ("alice", "bob1", "bob2"),
    "chat-native-recovery-e2e": ("alice", "bob"),
    "chat-native-group-mls-e2e": ("alice", "bob", "charlie"),
    "chat-lifecycle-group-live-e2e": ("alice", "bob", "charlie"),
    "chat-native-product-closure-e2e": ("alice", "bob", "alice2"),
    "chat-contact-message-resilience-e2e": ("alice",),
}


def agent_profile_for_gate(gate_id: str) -> str:
    if gate_id in AGENT_V2_BINDING_GATES:
        return AGENT_V2_BINDING_PROFILE
    return AGENT_V2_PROFILE


class HomeStationProvisioner(EnvironmentProvisioner):
    environment_id = "home-station"

    def __init__(self, contract: EnvironmentContract) -> None:
        super().__init__(contract)

    def _resolve_credentials(self) -> tuple[tuple[str, ...], dict[str, str]]:
        refs: list[str] = []
        values: dict[str, str] = {}
        for credential in self.contract.credentials:
            try:
                value = credential.resolve()
            except Exception as error:
                raise BlockedError(
                    reason=(
                        f"Cannot resolve credential {credential.id} from "
                        f"{credential.source_ref}: {error}"
                    ),
                    resource=f"credential-ref:{credential.source_ref}",
                ) from error
            refs.append(credential.source_ref)
            values[credential.id] = value
        return self._remember_resolved_credentials(tuple(refs), values)

    def _clients(
        self,
        gate_id: str,
        run_id: str,
        slot: int,
    ) -> tuple[ClientRuntime, ...]:
        roles = CLIENT_ROLES.get(gate_id)
        if roles is None:
            raise BlockedError(
                reason=f"Home Station has no client allocation for gate {gate_id}",
                resource=f"gate-environment:{gate_id}",
            )
        worktrees = [REPO_ROOT] * len(roles)
        contract_clients = {client.id: client for client in self.contract.clients}
        if contract_clients:
            missing_clients = sorted(set(roles) - set(contract_clients))
            if missing_clients:
                raise BlockedError(
                    reason=(
                        "Environment contract has no allocation for clients: "
                        f"{', '.join(missing_clients)}"
                    ),
                    resource=f"gate-environment:{gate_id}",
                )

        gateway_base = 3330 + slot * 100
        renderer_base = 3510 + slot * 100
        webdriver_base = 4445 + slot * 10
        run_root = (
            Path(tempfile.gettempdir())
            / f"pt-chat-native-{run_id}-{gate_id}"
        )
        clients = tuple(
            ClientRuntime(
                actor=(
                    contract_clients[role].actor
                    if contract_clients
                    else role
                ),
                runtime="native-tauri",
                worktree=str(worktree),
                gateway_port=gateway_base + index,
                renderer_port=renderer_base + index,
                webdriver_port=webdriver_base + index,
                profile=f"chat-native-{role}",
                storage_root=str(run_root / role / "storage"),
                id=role if contract_clients else "",
                required_service_roles=(
                    contract_clients[role].required_service_roles
                    if contract_clients
                    else ()
                ),
                service_bindings=(
                    contract_clients[role].service_bindings
                    if contract_clients
                    else {}
                ),
            )
            for index, (role, worktree) in enumerate(zip(roles, worktrees))
        )
        for client in clients:
            for label, port in (
                ("gateway", client.gateway_port),
                ("renderer", client.renderer_port),
                ("webdriver", client.webdriver_port),
            ):
                with socket.socket() as probe:
                    if probe.connect_ex(("127.0.0.1", port)) == 0:
                        raise BlockedError(
                            reason=(
                                f"{client.actor} {label} port {port} is "
                                "already in use"
                            ),
                            resource=f"client-isolation:{label}-port:{port}",
                        )
        self.register_cleanup(
            f"client-storage:{run_root}",
            lambda: shutil.rmtree(run_root, ignore_errors=True),
        )
        return clients

    def _agent_v2_foundation_client(
        self,
        run_id: str,
        slot: int,
        profile_env: dict[str, str],
    ) -> ClientRuntime:
        worktree = Path(
            os.environ.get("PT_AGENT_V2_NATIVE_WORKTREE", str(REPO_ROOT))
        ).expanduser().resolve()
        client = ClientRuntime(
            actor="alice",
            runtime="native-tauri",
            worktree=str(worktree),
            gateway_port=int(
                os.environ.get(
                    "PT_AGENT_V2_NATIVE_GATEWAY_PORT",
                    profile_env.get(
                        "PT_DESKTOP_APP_GATEWAY_PORT",
                        str(3030 + slot * 100),
                    ),
                )
            ),
            renderer_port=int(
                os.environ.get(
                    "PT_AGENT_V2_NATIVE_RENDERER_PORT",
                    profile_env.get(
                        "PT_DESKTOP_APP_WEB_PORT",
                        str(3210 + slot * 100),
                    ),
                )
            ),
            webdriver_port=int(
                os.environ.get("PT_AGENT_V2_NATIVE_WEBDRIVER_PORT", "4445")
            ),
            profile="agent-v2-foundation-native",
            storage_root=f"/tmp/pt-agent-v2-{run_id}/native/storage",
        )
        self._assert_client_ports_available(client)
        self.register_cleanup(
            f"client-storage:/tmp/pt-agent-v2-{run_id}",
            lambda: shutil.rmtree(
                Path(f"/tmp/pt-agent-v2-{run_id}"),
                ignore_errors=True,
            ),
        )
        return client

    def _agent_v2_foundation_browser_client(
        self,
        run_id: str,
        slot: int,
        profile_env: dict[str, str],
    ) -> ClientRuntime:
        worktree = Path(
            os.environ.get("PT_AGENT_V2_BROWSER_WORKTREE", str(REPO_ROOT))
        ).expanduser().resolve()
        client = ClientRuntime(
            actor="alice",
            runtime="browser",
            worktree=str(worktree),
            gateway_port=int(
                os.environ.get(
                    "PT_AGENT_V2_BROWSER_GATEWAY_PORT",
                    profile_env.get(
                        "PT_DESKTOP_WEB_GATEWAY_PORT",
                        str(3031 + slot * 100),
                    ),
                )
            ),
            renderer_port=int(
                os.environ.get(
                    "PT_AGENT_V2_BROWSER_RENDERER_PORT",
                    profile_env.get(
                        "PT_DESKTOP_WEB_WEB_PORT",
                        str(3211 + slot * 100),
                    ),
                )
            ),
            webdriver_port=int(
                os.environ.get("PT_AGENT_V2_BROWSER_WEBDRIVER_PORT", "4446")
            ),
            profile="agent-v2-foundation-browser",
            storage_root=f"/tmp/pt-agent-v2-{run_id}/browser/storage",
        )
        self._assert_client_ports_available(client, resource_prefix="browser-")
        return client

    def _agent_v2_binding_clients(
        self,
        run_id: str,
        slot: int,
        profile_env: dict[str, str],
        *,
        runtime_name: str = "binding",
    ) -> tuple[ClientRuntime, ClientRuntime]:
        environment_prefixes = {
            "binding": "PT_AGENT_V2_BINDING",
            "governed-tool": "PT_AGENT_V2_GOVERNED_TOOL",
            "home": "PT_AGENT_V2_HOME",
            "mcp": "PT_AGENT_V2_MCP",
            "connector": "PT_AGENT_V2_CONNECTOR",
        }
        try:
            environment_prefix = environment_prefixes[runtime_name]
        except KeyError as error:
            raise ValueError(
                f"unsupported Agent V2 dual-client runtime: {runtime_name}"
            ) from error
        run_root = (
            Path(tempfile.gettempdir())
            / f"pt-agent-v2-{runtime_name}-{run_id}"
        )
        worktree = Path(
            os.environ.get(f"{environment_prefix}_WORKTREE", str(REPO_ROOT))
        ).expanduser().resolve()
        native = ClientRuntime(
            actor="bob",
            runtime="native-tauri",
            worktree=str(worktree),
            gateway_port=int(
                os.environ.get(
                    f"{environment_prefix}_NATIVE_GATEWAY_PORT",
                    profile_env.get(
                        "PT_DESKTOP_APP_GATEWAY_PORT",
                        str(3030 + slot * 100),
                    ),
                )
            ),
            renderer_port=int(
                os.environ.get(
                    f"{environment_prefix}_NATIVE_RENDERER_PORT",
                    profile_env.get(
                        "PT_DESKTOP_APP_WEB_PORT",
                        str(3210 + slot * 100),
                    ),
                )
            ),
            webdriver_port=int(
                os.environ.get(
                    f"{environment_prefix}_NATIVE_WEBDRIVER_PORT",
                    str(4445 + slot * 10),
                )
            ),
            profile=os.environ.get(
                f"{environment_prefix}_NATIVE_PROFILE",
                f"agent-v2-{runtime_name}-native",
            ),
            storage_root=str(run_root / "native" / "storage"),
        )
        browser = ClientRuntime(
            actor="bob",
            runtime="browser",
            worktree=str(worktree),
            gateway_port=int(
                os.environ.get(
                    f"{environment_prefix}_BROWSER_GATEWAY_PORT",
                    profile_env.get(
                        "PT_DESKTOP_WEB_GATEWAY_PORT",
                        str(3031 + slot * 100),
                    ),
                )
            ),
            renderer_port=int(
                os.environ.get(
                    f"{environment_prefix}_BROWSER_RENDERER_PORT",
                    profile_env.get(
                        "PT_DESKTOP_WEB_WEB_PORT",
                        str(3211 + slot * 100),
                    ),
                )
            ),
            webdriver_port=int(
                os.environ.get(
                    f"{environment_prefix}_BROWSER_WEBDRIVER_PORT",
                    str(4446 + slot * 10),
                )
            ),
            profile=f"agent-v2-{runtime_name}-browser",
            storage_root=str(run_root / "browser" / "storage"),
        )
        self._assert_client_ports_available(native)
        self._assert_client_ports_available(
            browser,
            resource_prefix="browser-",
        )
        self.register_cleanup(
            f"client-storage:{run_root}",
            lambda: shutil.rmtree(run_root, ignore_errors=True),
        )
        return native, browser

    def _agent_v2_home_manifest(
        self,
        manifest: RuntimeManifest,
        *,
        station_url: str,
        deployment_environment: str,
        slot: int,
        profile_env: dict[str, str],
    ) -> RuntimeManifest:
        if not profile_env.get("CHAT_NATIVE_DEMO_PASSWORD", ""):
            raise BlockedError(
                reason=(
                    "Agent V2 Home Command Center requires "
                    "CHAT_NATIVE_DEMO_PASSWORD in Profile two"
                ),
                resource="profile:CHAT_NATIVE_DEMO_PASSWORD",
            )
        return dataclasses.replace(
            manifest,
            credential_refs=("profile:CHAT_NATIVE_DEMO_PASSWORD",),
            clients=self._agent_v2_binding_clients(
                manifest.run_id,
                slot,
                profile_env,
                runtime_name="home",
            ),
            cleanup_resources=self.contract.cleanup.resources,
        )

    def _agent_v2_evaluation_clients(
        self,
        run_id: str,
        slot: int,
        profile_env: dict[str, str],
    ) -> tuple[ClientRuntime, ClientRuntime]:
        run_root = (
            Path(tempfile.gettempdir()) / f"pt-agent-v2-evaluation-{run_id}"
        )
        worktree = Path(
            os.environ.get("PT_AGENT_V2_EVALUATION_WORKTREE", str(REPO_ROOT))
        ).expanduser().resolve()
        defaults = {
            "alice": (
                profile_env.get(
                    "PT_DESKTOP_APP_GATEWAY_PORT",
                    str(3030 + slot * 100),
                ),
                profile_env.get(
                    "PT_DESKTOP_APP_WEB_PORT",
                    str(3210 + slot * 100),
                ),
                str(4445 + slot * 10),
            ),
            "bob": (
                profile_env.get(
                    "PT_DESKTOP_WEB_GATEWAY_PORT",
                    str(3031 + slot * 100),
                ),
                profile_env.get(
                    "PT_DESKTOP_WEB_WEB_PORT",
                    str(3211 + slot * 100),
                ),
                str(4446 + slot * 10),
            ),
        }
        clients = tuple(
            ClientRuntime(
                actor=actor,
                runtime="native-tauri" if actor == "alice" else "browser",
                worktree=str(worktree),
                gateway_port=int(
                    os.environ.get(
                        f"PT_AGENT_V2_EVALUATION_{actor.upper()}_GATEWAY_PORT",
                        defaults[actor][0],
                    )
                ),
                renderer_port=int(
                    os.environ.get(
                        f"PT_AGENT_V2_EVALUATION_{actor.upper()}_RENDERER_PORT",
                        defaults[actor][1],
                    )
                ),
                webdriver_port=int(
                    os.environ.get(
                        f"PT_AGENT_V2_EVALUATION_{actor.upper()}_WEBDRIVER_PORT",
                        defaults[actor][2],
                    )
                ),
                profile=(
                    "agent-v2-evaluation-native"
                    if actor == "alice"
                    else "agent-v2-evaluation-browser"
                ),
                storage_root=str(run_root / actor / "runtime" / "storage"),
            )
            for actor in ("alice", "bob")
        )
        for client in clients:
            self._assert_client_ports_available(
                client,
                resource_prefix=f"{client.actor}-",
            )
        self.register_cleanup(
            f"client-storage:{run_root}",
            lambda: shutil.rmtree(run_root, ignore_errors=True),
        )
        return clients

    def _agent_marketplace_client(
        self,
        run_id: str,
        slot: int,
        profile_env: dict[str, str],
    ) -> ClientRuntime:
        run_root = Path(tempfile.gettempdir()) / f"pt-agent-marketplace-{run_id}"
        worktree = Path(
            os.environ.get("PT_AGENT_MARKETPLACE_WORKTREE", str(REPO_ROOT))
        ).expanduser().resolve()
        client = ClientRuntime(
            actor="alice",
            runtime="native-tauri",
            worktree=str(worktree),
            gateway_port=int(
                os.environ.get(
                    "PT_AGENT_MARKETPLACE_GATEWAY_PORT",
                    profile_env.get(
                        "PT_DESKTOP_APP_GATEWAY_PORT",
                        str(3030 + slot * 100),
                    ),
                )
            ),
            renderer_port=int(
                os.environ.get(
                    "PT_AGENT_MARKETPLACE_RENDERER_PORT",
                    profile_env.get(
                        "PT_DESKTOP_APP_WEB_PORT",
                        str(3210 + slot * 100),
                    ),
                )
            ),
            webdriver_port=int(
                os.environ.get(
                    "PT_AGENT_MARKETPLACE_WEBDRIVER_PORT",
                    str(4445 + slot * 10),
                )
            ),
            profile="agent-marketplace-native",
            storage_root=str(run_root / "native" / "storage"),
        )
        self._assert_client_ports_available(client)
        self.register_cleanup(
            f"client-storage:{run_root}",
            lambda: shutil.rmtree(run_root, ignore_errors=True),
        )
        return client

    def _agent_native_client(
        self,
        run_id: str,
        slot: int,
        profile_env: dict[str, str],
        *,
        journey: str,
        profile: str,
        worktree_variable: str,
        gateway_port_variable: str,
        renderer_port_variable: str,
        webdriver_port_variable: str,
    ) -> ClientRuntime:
        worktree = Path(
            os.environ.get(worktree_variable, str(REPO_ROOT))
        ).expanduser().resolve()
        client = ClientRuntime(
            actor="alice",
            runtime="native-tauri",
            worktree=str(worktree),
            gateway_port=int(
                os.environ.get(
                    gateway_port_variable,
                    profile_env.get(
                        "PT_DESKTOP_APP_GATEWAY_PORT",
                        str(3030 + slot * 100),
                    ),
                )
            ),
            renderer_port=int(
                os.environ.get(
                    renderer_port_variable,
                    profile_env.get(
                        "PT_DESKTOP_APP_WEB_PORT",
                        str(3210 + slot * 100),
                    ),
                )
            ),
            webdriver_port=int(
                os.environ.get(
                    webdriver_port_variable,
                    str(4445 + slot * 10),
                )
            ),
            profile=profile,
            storage_root=f"/tmp/pt-agent-{journey}-{run_id}/storage",
        )
        self._assert_client_ports_available(client)
        return client

    def _agent_stream_client(
        self,
        run_id: str,
        slot: int,
        profile_env: dict[str, str],
        *,
        profile: str = AGENT_V2_PROFILE,
    ) -> ClientRuntime:
        return self._agent_native_client(
            run_id,
            slot,
            profile_env,
            journey="stream",
            profile=profile,
            worktree_variable="PT_AGENT_STREAM_WORKTREE",
            gateway_port_variable="PT_AGENT_STREAM_GATEWAY_PORT",
            renderer_port_variable="PT_AGENT_STREAM_RENDERER_PORT",
            webdriver_port_variable="PT_AGENT_STREAM_WEBDRIVER_PORT",
        )

    def _agent_attachment_client(
        self,
        run_id: str,
        slot: int,
        profile_env: dict[str, str],
    ) -> ClientRuntime:
        return self._agent_native_client(
            run_id,
            slot,
            profile_env,
            journey="attachment",
            profile=AGENT_V2_PROFILE,
            worktree_variable="PT_AGENT_ATTACHMENT_WORKTREE",
            gateway_port_variable="PT_AGENT_ATTACHMENT_GATEWAY_PORT",
            renderer_port_variable="PT_AGENT_ATTACHMENT_RENDERER_PORT",
            webdriver_port_variable="PT_AGENT_ATTACHMENT_WEBDRIVER_PORT",
        )

    def _export_profile_credential_refs(
        self,
        profile_env: dict[str, str],
    ) -> tuple[str, ...]:
        resolved = {
            reference.removeprefix("profile:"): profile_env.get(
                reference.removeprefix("profile:"),
                "",
            )
            for reference in AGENT_V2_CREDENTIAL_REFS
        }
        missing = sorted(name for name, value in resolved.items() if not value)
        if missing:
            raise BlockedError(
                reason=(
                    "One profile is missing required credential: "
                    + ", ".join(missing)
                ),
                resource=f"credential-ref:profile:{missing[0]}",
            )
        self._remember_resolved_credentials(
            AGENT_V2_CREDENTIAL_REFS,
            {
                "PT_AGENT_PROVIDER_API_KEY": resolved[
                    "PT_AGENT_PROVIDER_API_KEY"
                ],
            },
        )
        return AGENT_V2_CREDENTIAL_REFS

    @staticmethod
    def _assert_client_ports_available(
        client: ClientRuntime,
        *,
        resource_prefix: str = "",
    ) -> None:
        for label, port in (
            ("gateway", client.gateway_port),
            ("renderer", client.renderer_port),
            ("webdriver", client.webdriver_port),
        ):
            with socket.socket() as probe:
                if probe.connect_ex(("127.0.0.1", port)) == 0:
                    raise BlockedError(
                        reason=(
                            f"{client.actor} {resource_prefix}{label} port "
                            f"{port} is already in use"
                        ),
                        resource=(
                            f"client-isolation:{resource_prefix}{label}-port:{port}"
                        ),
                    )

    def _agent_v2_foundation_manifest(
        self,
        manifest: RuntimeManifest,
        *,
        station_url: str,
        deployment_environment: str,
        slot: int,
        profile_env: dict[str, str],
    ) -> RuntimeManifest:
        if profile_env.get("CHAT_ACCEPTANCE_RESET") != "1":
            raise BlockedError(
                reason=(
                    "Agent V2 Foundation actor Fixture reset requires "
                    "CHAT_ACCEPTANCE_RESET=1 in the approved profile"
                ),
                resource="fixture-reset:authorization",
            )
        if not profile_env.get("CHAT_NATIVE_DEMO_PASSWORD", ""):
            raise BlockedError(
                reason=(
                    "Agent V2 Foundation requires CHAT_NATIVE_DEMO_PASSWORD "
                    "in the approved profile"
                ),
                resource="credential-ref:profile:CHAT_NATIVE_DEMO_PASSWORD",
            )
        provider_api_key = profile_env.get("PT_AGENT_PROVIDER_API_KEY", "")
        if provider_api_key:
            self._remember_resolved_credentials(
                AGENT_V2_CREDENTIAL_REFS,
                {"PT_AGENT_PROVIDER_API_KEY": provider_api_key},
            )
        _, _, actor_ref = produce_actor_manifest(
            environment_id=self.environment_id,
            run_id=manifest.run_id,
            station_url=station_url,
            deployment_environment=deployment_environment,
            roles=("alice", "bob"),
            credential_ref="profile:CHAT_NATIVE_DEMO_PASSWORD",
            reset_authorized=True,
        )
        return dataclasses.replace(
            manifest,
            actor_manifest_ref=actor_ref,
            credential_refs=AGENT_V2_CREDENTIAL_REFS,
            clients=(
                self._agent_v2_foundation_client(
                    manifest.run_id,
                    slot,
                    profile_env,
                ),
                self._agent_v2_foundation_browser_client(
                    manifest.run_id,
                    slot,
                    profile_env,
                ),
            ),
            cleanup_resources=self.contract.cleanup.resources,
        )

    def _agent_v2_binding_manifest(
        self,
        manifest: RuntimeManifest,
        *,
        station_url: str,
        deployment_environment: str,
        slot: int,
        profile_env: dict[str, str],
    ) -> RuntimeManifest:
        if profile_env.get("CHAT_ACCEPTANCE_RESET") != "1":
            raise BlockedError(
                reason=(
                    "Agent V2 capability binding actor Fixture reset requires "
                    "CHAT_ACCEPTANCE_RESET=1 in Profile two"
                ),
                resource="fixture-reset:authorization",
            )
        missing_configuration = sorted(
            name
            for name in ("CHAT_NATIVE_DEMO_PASSWORD",)
            if not profile_env.get(name, "")
        )
        if missing_configuration:
            raise BlockedError(
                reason=(
                    "Agent V2 capability binding requires Profile two values: "
                    + ", ".join(missing_configuration)
                ),
                resource=f"profile:{missing_configuration[0]}",
            )
        credential_refs = ("profile:CHAT_NATIVE_DEMO_PASSWORD",)
        clients = self._agent_v2_binding_clients(
            manifest.run_id,
            slot,
            profile_env,
        )
        _, _, actor_ref = produce_actor_manifest(
            environment_id=self.environment_id,
            run_id=manifest.run_id,
            station_url=station_url,
            deployment_environment=deployment_environment,
            roles=("alice", "bob"),
            credential_ref="profile:CHAT_NATIVE_DEMO_PASSWORD",
            reset_authorized=True,
        )
        return dataclasses.replace(
            manifest,
            actor_manifest_ref=actor_ref,
            credential_refs=credential_refs,
            clients=clients,
            cleanup_resources=self.contract.cleanup.resources,
        )

    def _agent_v2_governed_tool_manifest(
        self,
        manifest: RuntimeManifest,
        *,
        station_url: str,
        deployment_environment: str,
        slot: int,
        profile_env: dict[str, str],
    ) -> RuntimeManifest:
        if not profile_env.get("CHAT_NATIVE_DEMO_PASSWORD", ""):
            raise BlockedError(
                reason=(
                    "Agent V2 governed ToolCall Development requires "
                    "CHAT_NATIVE_DEMO_PASSWORD in Profile two"
                ),
                resource="profile:CHAT_NATIVE_DEMO_PASSWORD",
            )
        clients = self._agent_v2_binding_clients(
            manifest.run_id,
            slot,
            profile_env,
            runtime_name="governed-tool",
        )
        return dataclasses.replace(
            manifest,
            credential_refs=("profile:CHAT_NATIVE_DEMO_PASSWORD",),
            clients=clients,
            cleanup_resources=self.contract.cleanup.resources,
        )

    def _agent_v2_mcp_manifest(
        self,
        manifest: RuntimeManifest,
        *,
        station_url: str,
        deployment_environment: str,
        slot: int,
        profile_env: dict[str, str],
    ) -> RuntimeManifest:
        if not profile_env.get("CHAT_NATIVE_DEMO_PASSWORD", ""):
            raise BlockedError(
                reason=(
                    "Agent V2 MCP lifecycle Development requires "
                    "CHAT_NATIVE_DEMO_PASSWORD in Profile two"
                ),
                resource="profile:CHAT_NATIVE_DEMO_PASSWORD",
            )
        return dataclasses.replace(
            manifest,
            credential_refs=("profile:CHAT_NATIVE_DEMO_PASSWORD",),
            clients=self._agent_v2_binding_clients(
                manifest.run_id,
                slot,
                profile_env,
                runtime_name="mcp",
            ),
            cleanup_resources=self.contract.cleanup.resources,
        )

    def _agent_v2_connector_manifest(
        self,
        manifest: RuntimeManifest,
        *,
        station_url: str,
        deployment_environment: str,
        slot: int,
        profile_env: dict[str, str],
    ) -> RuntimeManifest:
        if not profile_env.get("CHAT_NATIVE_DEMO_PASSWORD", ""):
            raise BlockedError(
                reason=(
                    "Agent V2 Connector invocation Development requires "
                    "CHAT_NATIVE_DEMO_PASSWORD in Profile two"
                ),
                resource="profile:CHAT_NATIVE_DEMO_PASSWORD",
            )
        return dataclasses.replace(
            manifest,
            credential_refs=("profile:CHAT_NATIVE_DEMO_PASSWORD",),
            clients=self._agent_v2_binding_clients(
                manifest.run_id,
                slot,
                profile_env,
                runtime_name="connector",
            ),
            cleanup_resources=self.contract.cleanup.resources,
        )

    def _agent_v2_evaluation_manifest(
        self,
        manifest: RuntimeManifest,
        *,
        station_url: str,
        deployment_environment: str,
        slot: int,
        profile_env: dict[str, str],
    ) -> RuntimeManifest:
        if not profile_env.get("CHAT_NATIVE_DEMO_PASSWORD", ""):
            raise BlockedError(
                reason=(
                    "Agent V2 Evaluation Development requires "
                    "CHAT_NATIVE_DEMO_PASSWORD in Profile two"
                ),
                resource="profile:CHAT_NATIVE_DEMO_PASSWORD",
            )
        return dataclasses.replace(
            manifest,
            credential_refs=("profile:CHAT_NATIVE_DEMO_PASSWORD",),
            clients=self._agent_v2_evaluation_clients(
                manifest.run_id,
                slot,
                profile_env,
            ),
            cleanup_resources=self.contract.cleanup.resources,
        )

    def _agent_native_manifest(
        self,
        manifest: RuntimeManifest,
        *,
        gate_id: str,
        station_url: str,
        deployment_environment: str,
        profile_env: dict[str, str],
    ) -> RuntimeManifest:
        if profile_env.get("CHAT_ACCEPTANCE_RESET") != "1":
            raise BlockedError(
                reason=(
                    f"{gate_id} actor Fixture reset requires "
                    "CHAT_ACCEPTANCE_RESET=1 in the approved profile"
                ),
                resource="fixture-reset:authorization",
            )
        missing_configuration = sorted(
            name
            for name in (
                "PT_AGENT_PROVIDER_ID",
                "PT_AGENT_PROVIDER_BASE_URL",
            )
            if not profile_env.get(name, "")
        )
        if missing_configuration:
            raise BlockedError(
                reason=(
                    f"{gate_id} requires profile values: "
                    + ", ".join(missing_configuration)
                ),
                resource=f"profile:{missing_configuration[0]}",
            )
        credential_refs = self._export_profile_credential_refs(profile_env)
        roles = GATE_ROLES[gate_id]
        _, _, actor_ref = produce_actor_manifest(
            environment_id=self.environment_id,
            run_id=manifest.run_id,
            station_url=station_url,
            deployment_environment=deployment_environment,
            roles=roles,
            credential_ref="profile:CHAT_NATIVE_DEMO_PASSWORD",
            reset_authorized=True,
        )
        client = (
            self._agent_attachment_client(
                manifest.run_id,
                manifest.profile_slot,
                profile_env,
            )
            if gate_id == "agent-attachment-e2e"
            else self._agent_stream_client(
                manifest.run_id,
                manifest.profile_slot,
                profile_env,
                profile=agent_profile_for_gate(gate_id),
            )
        )
        return dataclasses.replace(
            manifest,
            actor_manifest_ref=actor_ref,
            credential_refs=credential_refs,
            clients=(client,),
            cleanup_resources=self.contract.cleanup.resources,
        )

    @staticmethod
    def _validate_agent_profile(
        gate_id: str,
        profile_name: str,
        profile_env: dict[str, str],
    ) -> None:
        required_profile = agent_profile_for_gate(gate_id)
        if profile_name != required_profile:
            raise BlockedError(
                reason=(
                    f"{gate_id} requires the approved {required_profile} "
                    f"profile; active profile is {profile_name}"
                ),
                resource=f"profile:required:{required_profile}",
            )
        if profile_env.get("PT_STATION_MODE", "local") != "remote":
            raise BlockedError(
                reason=f"{gate_id} requires a source-attested remote Station",
                resource="profile:PT_STATION_MODE",
            )
        if not profile_env.get("PT_STATION_DEPLOY_ENV", "").strip():
            raise BlockedError(
                reason=(
                    f"{gate_id} requires the remote Station deployment identity"
                ),
                resource="profile:PT_STATION_DEPLOY_ENV",
            )

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            profile_name, _, slot, profile_env = self._resolve_active_profile()
            manifest = self._preflighted(
                self._manifest,
                profile_name=profile_name,
                slot=slot,
            )
            if (
                gate_id in {
                    AGENT_V2_FOUNDATION_GATE,
                    AGENT_V2_HOME_GATE,
                    AGENT_V2_BINDING_GATE,
                    AGENT_V2_GOVERNED_TOOL_GATE,
                    AGENT_V2_MCP_GATE,
                    AGENT_V2_CONNECTOR_GATE,
                    AGENT_V2_EVALUATION_GATE,
                }
                or gate_id in AGENT_NATIVE_GATES
            ):
                self._validate_agent_profile(
                    gate_id,
                    profile_name,
                    profile_env,
                )
            station_url = profile_env.get("PT_STATION_URL", "").rstrip("/")
            health_url = profile_env.get("PT_STATION_HEALTH_URL", "")
            deployment_environment = (
                profile_env.get("PT_STATION_DEPLOY_ENV", "").strip()
                or profile_name
            )
            self.acquire_profile_lease(
                deployment_environment,
                f"acceptance:{gate_id}:{manifest.run_id}",
            )
            if not station_url:
                raise BlockedError(
                    reason="Active profile is missing PT_STATION_URL",
                    resource="profile:PT_STATION_URL",
                )
            if profile_env.get("PT_STATION_MODE", "local") == "remote":
                self.acquire_remote_git_source_lease(
                    deployment_environment,
                    f"acceptance:{gate_id}:{manifest.run_id}",
                )
            if not self._station_ready(station_url, health_url):
                if profile_env.get("PT_STATION_MODE", "local") != "remote":
                    completed = subprocess.run(
                        ["make", "station"],
                        cwd=REPO_ROOT,
                        capture_output=True,
                        text=True,
                        timeout=180,
                        check=False,
                    )
                    if completed.returncode == 0 and self._station_ready(
                        station_url,
                        health_url,
                    ):
                        def stop_local_station() -> None:
                            stopped = subprocess.run(
                                ["make", "station-stop"],
                                cwd=REPO_ROOT,
                                capture_output=True,
                                text=True,
                                timeout=60,
                                check=False,
                            )
                            if stopped.returncode != 0:
                                detail = (
                                    stopped.stderr.strip()
                                    or stopped.stdout.strip()
                                    or "unknown station-stop failure"
                                )
                                raise RuntimeError(detail)

                        self.register_cleanup(
                            "local-station",
                            stop_local_station,
                        )
                    else:
                        detail = (
                            completed.stderr.strip()
                            or completed.stdout.strip()
                            or "Station remained unavailable"
                        )
                        raise BlockedError(
                            reason=f"Local Station provisioning failed: {detail}",
                            resource=f"station:{station_url}",
                        )
                else:
                    raise BlockedError(
                        reason=(
                            f"Remote Station is not reachable at {station_url}. "
                            "Run make station-check, then deploy through the "
                            "approved git-based Station workflow."
                        ),
                        resource=f"station:{station_url}",
                    )

            attestation = produce_station_attestation(
                environment_id=self.environment_id,
                run_id=manifest.run_id,
                service_id="station",
                station_url=station_url,
                profile_env=profile_env,
                remote_source_identity_provider=resolve_remote_source_identity,
            )
            local_proto_digest = source_proto_digest(REPO_ROOT)
            if not commits_match(attestation.live_commit, manifest.source_commit):
                raise BlockedError(
                    reason=(
                        f"Station commit {attestation.live_commit} does not match "
                        f"client source commit {manifest.source_commit}"
                    ),
                    resource="source-identity:commit",
                )
            if gate_id in {
                AGENT_V2_FOUNDATION_GATE,
                AGENT_V2_HOME_GATE,
                AGENT_MARKETPLACE_GATE,
            }:
                if manifest.workspace_digest != "clean":
                    raise BlockedError(
                        reason=(
                            f"{gate_id} requires a clean candidate "
                            "worktree before remote proof"
                        ),
                        resource="source-identity:workspace",
                    )
            if (
                gate_id in {
                    AGENT_V2_FOUNDATION_GATE,
                    AGENT_V2_HOME_GATE,
                    AGENT_V2_BINDING_GATE,
                    AGENT_V2_GOVERNED_TOOL_GATE,
                    AGENT_V2_MCP_GATE,
                    AGENT_V2_CONNECTOR_GATE,
                    AGENT_V2_EVALUATION_GATE,
                    AGENT_MARKETPLACE_GATE,
                }
                and not attestation.is_clean_workspace
            ):
                raise BlockedError(
                    reason=(
                        f"{gate_id} requires a clean remote Station deployment"
                    ),
                    resource="source-identity:station-workspace",
                )
            if attestation.protocol_digest != local_proto_digest:
                raise BlockedError(
                    reason=(
                        "Station and client proto digests do not match; deploy the "
                        "current source before running native proof"
                    ),
                    resource="source-identity:proto",
                )

            manifest = dataclasses.replace(
                manifest,
                state=ProvisioningState.PROVISIONED,
                services={attestation.service_id: attestation},
            )
            self._manifest = manifest
            if gate_id == "chat-federated-browser-prereq":
                return self._ready(manifest)
            if gate_id == AGENT_V2_FOUNDATION_GATE:
                manifest = self._agent_v2_foundation_manifest(
                    manifest,
                    station_url=station_url,
                    deployment_environment=deployment_environment,
                    slot=slot,
                    profile_env=profile_env,
                )
                self._manifest = manifest
                return self._ready(manifest)
            if gate_id == AGENT_V2_HOME_GATE:
                manifest = self._agent_v2_home_manifest(
                    manifest,
                    station_url=station_url,
                    deployment_environment=deployment_environment,
                    slot=slot,
                    profile_env=profile_env,
                )
                self._manifest = manifest
                return self._ready(manifest)
            if gate_id == AGENT_V2_BINDING_GATE:
                manifest = self._agent_v2_binding_manifest(
                    manifest,
                    station_url=station_url,
                    deployment_environment=deployment_environment,
                    slot=slot,
                    profile_env=profile_env,
                )
                self._manifest = manifest
                return self._ready(manifest)
            if gate_id == AGENT_V2_GOVERNED_TOOL_GATE:
                manifest = self._agent_v2_governed_tool_manifest(
                    manifest,
                    station_url=station_url,
                    deployment_environment=deployment_environment,
                    slot=slot,
                    profile_env=profile_env,
                )
                self._manifest = manifest
                return self._ready(manifest)
            if gate_id == AGENT_V2_MCP_GATE:
                manifest = self._agent_v2_mcp_manifest(
                    manifest,
                    station_url=station_url,
                    deployment_environment=deployment_environment,
                    slot=slot,
                    profile_env=profile_env,
                )
                self._manifest = manifest
                return self._ready(manifest)
            if gate_id == AGENT_V2_CONNECTOR_GATE:
                manifest = self._agent_v2_connector_manifest(
                    manifest,
                    station_url=station_url,
                    deployment_environment=deployment_environment,
                    slot=slot,
                    profile_env=profile_env,
                )
                self._manifest = manifest
                return self._ready(manifest)
            if gate_id == AGENT_V2_EVALUATION_GATE:
                manifest = self._agent_v2_evaluation_manifest(
                    manifest,
                    station_url=station_url,
                    deployment_environment=deployment_environment,
                    slot=slot,
                    profile_env=profile_env,
                )
                self._manifest = manifest
                return self._ready(manifest)
            if gate_id == AGENT_MARKETPLACE_GATE:
                if not profile_env.get("CHAT_NATIVE_DEMO_PASSWORD", ""):
                    raise BlockedError(
                        reason=(
                            "Agent Marketplace Development requires "
                            "CHAT_NATIVE_DEMO_PASSWORD in Profile two"
                        ),
                        resource="profile:CHAT_NATIVE_DEMO_PASSWORD",
                    )
                manifest = dataclasses.replace(
                    manifest,
                    credential_refs=("profile:CHAT_NATIVE_DEMO_PASSWORD",),
                    clients=(
                        self._agent_marketplace_client(
                            manifest.run_id,
                            slot,
                            profile_env,
                        ),
                    ),
                    cleanup_resources=self.contract.cleanup.resources,
                )
                self._manifest = manifest
                return self._ready(manifest)
            if gate_id in AGENT_NATIVE_GATES:
                manifest = self._agent_native_manifest(
                    manifest,
                    gate_id=gate_id,
                    station_url=station_url,
                    deployment_environment=deployment_environment,
                    profile_env=profile_env,
                )
                self._manifest = manifest
                return self._ready(manifest)

            credential_refs, _ = self._resolve_credentials()
            fixture = next(
                (
                    item
                    for item in self.contract.fixtures
                    if item.id == "chat-native-actors"
                ),
                None,
            )
            if fixture is None:
                raise BlockedError(
                    reason="home-station contract is missing chat-native-actors fixture",
                    resource="fixture:chat-native-actors",
                )
            authorization_ref = (
                fixture.authorization_ref or "env:CHAT_ACCEPTANCE_RESET"
            )
            authorization_name = (
                authorization_ref[4:]
                if authorization_ref.startswith("env:")
                else authorization_ref
            )
            reset_authorized = (
                not fixture.authorization_required
                or os.environ.get(authorization_name) == "1"
            )
            if not profile_env.get("PT_STATION_DEPLOY_ENV", "").strip():
                raise BlockedError(
                    reason="Active profile is missing PT_STATION_DEPLOY_ENV",
                    resource="profile:PT_STATION_DEPLOY_ENV",
                )
            roles = GATE_ROLES.get(gate_id)
            if roles is None:
                raise BlockedError(
                    reason=f"home-station does not support gate {gate_id}",
                    resource=f"gate-environment:{gate_id}",
                )
            _, _, actor_ref = produce_actor_manifest(
                environment_id=self.environment_id,
                run_id=manifest.run_id,
                station_url=station_url,
                deployment_environment=deployment_environment,
                roles=roles,
                credential_ref=credential_refs[0] if credential_refs else "",
                reset_authorized=reset_authorized,
            )
            clients = self._clients(gate_id, manifest.run_id, slot)
            manifest = dataclasses.replace(
                manifest,
                actor_manifest_ref=actor_ref,
                credential_refs=credential_refs,
                clients=clients,
                cleanup_resources=self.contract.cleanup.resources,
            )
            return self._ready(manifest)
        except (BlockedError, ValueError) as error:
            blocked = (
                error
                if isinstance(error, BlockedError)
                else BlockedError(
                    reason=f"Native client profile has an invalid port: {error}",
                    resource="profile:native-port",
                )
            )
            return self._blocked(
                self._manifest,
                reason=blocked.reason,
                resource=blocked.resource,
            )
