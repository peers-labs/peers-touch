from __future__ import annotations

import dataclasses
import json
import os
import shlex
import shutil
import socket
import subprocess
import tempfile
import urllib.error
import urllib.request
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
    ActorIdentity,
    ActorManifest,
    ClientRuntime,
    EnvironmentContract,
    ProvisioningState,
    RuntimeManifest,
    utc_now,
)
from tooling.acceptance.fixtures.chat_native_actors import (
    ACTOR_ACCOUNTS,
    persist_actor_manifest,
    produce_actor_manifest,
)
from tooling.acceptance.gates.agent.external_runtime_fixture import (
    external_runtime_environment,
    external_runtime_root,
)
from tooling.acceptance.provisioners.remote_source_identity import (
    reviewed_remote_transport,
    resolve_remote_source_identity,
)


GATE_ROLES = {
    "desktop-primary-navigation-e2e": ("alice",),
    "agent-attachment-e2e": ("alice",),
    "agent-cli-provider-primary-native-e2e": ("alice",),
    "agent-core-lifecycle-native-e2e": ("alice",),
    "agent-minimum-usable-chat-native-e2e": ("charlie",),
    "agent-stream-resilience-e2e": ("alice",),
    "agent-v2-capability-binding-e2e": ("alice", "bob"),
    "agent-v2-governed-tool-loop-e2e": ("bob",),
    "agent-v2-mcp-lifecycle-e2e": ("bob",),
    "agent-v2-connector-invocation-e2e": ("bob",),
    "agent-v2-evaluation-lab-e2e": ("alice", "bob"),
    "agent-v2-external-runtime-e2e": ("bob",),
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
AGENT_V2_EXTERNAL_RUNTIME_GATE = "agent-v2-external-runtime-e2e"
AGENT_MARKETPLACE_GATE = "agent-marketplace-catalog-e2e"
AGENT_CLI_PROVIDER_GATE = "agent-cli-provider-primary-native-e2e"
AGENT_CORE_LIFECYCLE_GATE = "agent-core-lifecycle-native-e2e"
AGENT_MINIMUM_USABLE_CHAT_GATE = "agent-minimum-usable-chat-native-e2e"
AGENT_NATIVE_GATES = frozenset(
    {
        "agent-attachment-e2e",
        AGENT_CLI_PROVIDER_GATE,
        "agent-core-lifecycle-native-e2e",
        AGENT_MINIMUM_USABLE_CHAT_GATE,
        "agent-stream-resilience-e2e",
    }
)
AGENT_V2_PROFILE = os.environ.get("PT_ACCEPTANCE_APPROVED_PROFILE", "one")
AGENT_V2_BINDING_PROFILE = "two"
AGENT_V2_BINDING_GATES = frozenset(
    {
        AGENT_CLI_PROVIDER_GATE,
        AGENT_CORE_LIFECYCLE_GATE,
        AGENT_MINIMUM_USABLE_CHAT_GATE,
        AGENT_V2_HOME_GATE,
        AGENT_V2_BINDING_GATE,
        AGENT_V2_GOVERNED_TOOL_GATE,
        AGENT_V2_MCP_GATE,
        AGENT_V2_CONNECTOR_GATE,
        AGENT_V2_EVALUATION_GATE,
        AGENT_V2_EXTERNAL_RUNTIME_GATE,
        AGENT_MARKETPLACE_GATE,
    }
)
AGENT_V2_SCENARIO_CONTROL_GATES = frozenset(
    {
        AGENT_V2_BINDING_GATE,
        AGENT_V2_GOVERNED_TOOL_GATE,
        AGENT_V2_MCP_GATE,
    }
)
AGENT_V2_CREDENTIAL_REFS = (
    "profile:CHAT_NATIVE_DEMO_PASSWORD",
    "profile:PT_AGENT_PROVIDER_API_KEY",
    "profile:PT_AGENT_DEFAULT_MODEL_ID",
)

CLIENT_ROLES = {
    "desktop-primary-navigation-e2e": ("alice",),
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


def agent_native_requires_disposable_fixture(gate_id: str) -> bool:
    return gate_id not in {
        AGENT_CLI_PROVIDER_GATE,
        AGENT_CORE_LIFECYCLE_GATE,
        AGENT_MINIMUM_USABLE_CHAT_GATE,
    }


def agent_native_requires_provider(gate_id: str) -> bool:
    return gate_id not in {
        AGENT_CLI_PROVIDER_GATE,
        AGENT_CORE_LIFECYCLE_GATE,
        AGENT_MINIMUM_USABLE_CHAT_GATE,
    }


def audit_remote_station_cli_processes(deployment_environment: str) -> None:
    try:
        transport, environment = reviewed_remote_transport(
            deployment_environment
        )
    except Exception as error:
        raise RuntimeError(
            "remote Station CLI process cleanup audit could not resolve "
            "the approved runtime"
        ) from error

    compose_project = environment.get(
        "PT_ACCEPTANCE_COMPOSE_PROJECT",
        "",
    ).strip()
    if not compose_project or any(
        not (character.isalnum() or character in "._-")
        for character in compose_project
    ):
        raise RuntimeError(
            "remote Station CLI process cleanup audit has no approved "
            "Compose project"
        )

    process_audit = r"""
set -eu
for cmdline in /proc/[0-9]*/cmdline; do
    [ -r "$cmdline" ] || continue
    argv0="$(tr '\000' '\n' < "$cmdline" | sed -n '1p')"
    case "${argv0##*/}" in
        traecli|host-cli-bin) exit 42 ;;
    esac
done
"""
    project_filter = shlex.quote(
        f"label=com.docker.compose.project={compose_project}"
    )
    service_filter = shlex.quote(
        "label=com.docker.compose.service=station"
    )
    remote_command = (
        "set -eu; "
        "container_ids=\"$(docker ps --quiet "
        f"--filter {project_filter} --filter {service_filter})\"; "
        "container_count=\"$(printf '%s\\n' \"$container_ids\" "
        "| sed '/^$/d' | wc -l | tr -d '[:space:]')\"; "
        "test \"$container_count\" = 1 || exit 41; "
        "container_id=\"$(printf '%s\\n' \"$container_ids\" "
        "| sed -n '1p')\"; "
        f"docker exec \"$container_id\" sh -c {shlex.quote(process_audit)}"
    )
    try:
        completed = transport.run_argv(
            ["bash", "-lc", remote_command],
            timeout=30,
            check=False,
        )
    except Exception as error:
        raise RuntimeError(
            "remote Station CLI process cleanup audit could not complete"
        ) from error

    if completed.returncode == 0:
        return
    if completed.returncode == 41:
        raise RuntimeError(
            "remote Station CLI process cleanup audit could not select "
            "exactly one Station container"
        )
    if completed.returncode == 42:
        raise RuntimeError(
            "remote Station CLI process cleanup audit detected a residual "
            "provider process"
        )
    raise RuntimeError(
        "remote Station CLI process cleanup audit could not complete"
    )


def resolve_existing_actor(
    station_url: str,
    role: str,
    password: str,
) -> ActorIdentity:
    account = ACTOR_ACCOUNTS.get(role)
    if not account:
        raise BlockedError(
            reason=f"Unsupported Agent native actor role: {role}",
            resource=f"fixture-actor:{role}",
        )
    request = urllib.request.Request(
        f"{station_url.rstrip('/')}/actor/login",
        data=json.dumps(
            {
                "email": account,
                "password": password,
                "device_type": "desktop",
            }
        ).encode("utf-8"),
        headers={"Accept": "application/json", "Content-Type": "application/json"},
        method="POST",
    )
    token = ""
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            envelope = json.loads(response.read().decode("utf-8"))
        data = (
            envelope.get("data")
            if isinstance(envelope, dict)
            and isinstance(envelope.get("data"), dict)
            else {}
        )
        actor_ref = (
            data.get("actor_ref")
            if isinstance(data.get("actor_ref"), dict)
            else {}
        )
        tokens = (
            data.get("tokens")
            if isinstance(data.get("tokens"), dict)
            else {}
        )
        ptid = str(actor_ref.get("ptid") or "")
        token = str(tokens.get("access_token") or "")
        if not ptid.startswith("ptid:") or not token:
            raise BlockedError(
                reason=f"Station login did not resolve canonical actor {role}",
                resource=f"fixture-actor:{role}",
            )
        return ActorIdentity(
            role=role,
            account_ref=f"station-account:{account}",
            ptid=ptid,
            device_policy="ephemeral-acceptance",
        )
    except (
        urllib.error.URLError,
        OSError,
        TimeoutError,
        json.JSONDecodeError,
    ) as error:
        raise BlockedError(
            reason=f"Cannot resolve existing actor {role}: {error}",
            resource=f"fixture-actor:{role}",
        ) from error
    finally:
        if token:
            logout = urllib.request.Request(
                f"{station_url.rstrip('/')}/actor/logout",
                data=b"{}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            try:
                urllib.request.urlopen(logout, timeout=15).close()
            except (urllib.error.URLError, OSError, TimeoutError) as error:
                raise BlockedError(
                    reason=(
                        f"Existing actor {role} discovery session could not "
                        f"be released: {error}"
                    ),
                    resource=f"fixture-session:{role}",
                ) from error


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

    def _agent_v2_foundation_secondary_client(
        self,
        run_id: str,
        slot: int,
        profile_env: dict[str, str],
    ) -> ClientRuntime:
        worktree = Path(
            os.environ.get("PT_AGENT_V2_SECONDARY_WORKTREE", str(REPO_ROOT))
        ).expanduser().resolve()
        client = ClientRuntime(
            actor="alice",
            runtime="native-tauri",
            worktree=str(worktree),
            gateway_port=int(
                os.environ.get(
                    "PT_AGENT_V2_SECONDARY_GATEWAY_PORT",
                    str(
                        int(profile_env.get(
                            "PT_DESKTOP_APP_GATEWAY_PORT",
                            str(3030 + slot * 100),
                        )) + 1
                    ),
                )
            ),
            renderer_port=int(
                os.environ.get(
                    "PT_AGENT_V2_SECONDARY_RENDERER_PORT",
                    str(
                        int(profile_env.get(
                            "PT_DESKTOP_APP_WEB_PORT",
                            str(3210 + slot * 100),
                        )) + 1
                    ),
                )
            ),
            webdriver_port=int(
                os.environ.get("PT_AGENT_V2_SECONDARY_WEBDRIVER_PORT", "4446")
            ),
            profile="agent-v2-foundation-native-secondary",
            storage_root=f"/tmp/pt-agent-v2-{run_id}/native-secondary/storage",
        )
        self._assert_client_ports_available(client, resource_prefix="secondary-")
        return client

    def _agent_v2_binding_clients(
        self,
        run_id: str,
        slot: int,
        profile_env: dict[str, str],
        *,
        runtime_name: str = "binding",
        actor: str = "bob",
    ) -> tuple[ClientRuntime, ClientRuntime]:
        environment_prefixes = {
            "binding": "PT_AGENT_V2_BINDING",
            "governed-tool": "PT_AGENT_V2_GOVERNED_TOOL",
            "home": "PT_AGENT_V2_HOME",
            "mcp": "PT_AGENT_V2_MCP",
            "connector": "PT_AGENT_V2_CONNECTOR",
            "external-runtime": "PT_AGENT_V2_EXTERNAL_RUNTIME",
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
            actor=actor,
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
        secondary = ClientRuntime(
            actor=actor,
            runtime="native-tauri",
            worktree=str(worktree),
            gateway_port=int(
                os.environ.get(
                    f"{environment_prefix}_SECONDARY_GATEWAY_PORT",
                    str(
                        int(profile_env.get(
                            "PT_DESKTOP_APP_GATEWAY_PORT",
                            str(3030 + slot * 100),
                        )) + 1
                    ),
                )
            ),
            renderer_port=int(
                os.environ.get(
                    f"{environment_prefix}_SECONDARY_RENDERER_PORT",
                    str(
                        int(profile_env.get(
                            "PT_DESKTOP_APP_WEB_PORT",
                            str(3210 + slot * 100),
                        )) + 1
                    ),
                )
            ),
            webdriver_port=int(
                os.environ.get(
                    f"{environment_prefix}_SECONDARY_WEBDRIVER_PORT",
                    str(4446 + slot * 10),
                )
            ),
            profile=f"agent-v2-{runtime_name}-native-secondary",
            storage_root=str(run_root / "native-secondary" / "storage"),
        )
        self._assert_client_ports_available(native)
        self._assert_client_ports_available(
            secondary,
            resource_prefix="secondary-",
        )
        self.register_cleanup(
            f"client-storage:{run_root}",
            lambda: shutil.rmtree(run_root, ignore_errors=True),
        )
        return native, secondary

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
                str(
                    int(profile_env.get(
                        "PT_DESKTOP_APP_GATEWAY_PORT",
                        str(3030 + slot * 100),
                    )) + 1
                ),
                str(
                    int(profile_env.get(
                        "PT_DESKTOP_APP_WEB_PORT",
                        str(3210 + slot * 100),
                    )) + 1
                ),
                str(4446 + slot * 10),
            ),
        }
        clients = tuple(
            ClientRuntime(
                actor=actor,
                runtime="native-tauri",
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
                    else "agent-v2-evaluation-native-secondary"
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
        actor: str = "alice",
    ) -> ClientRuntime:
        worktree = Path(
            os.environ.get(worktree_variable, str(REPO_ROOT))
        ).expanduser().resolve()
        client = ClientRuntime(
            actor=actor,
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

    def _agent_cli_provider_client(
        self,
        run_id: str,
        slot: int,
        profile_env: dict[str, str],
    ) -> ClientRuntime:
        return self._agent_native_client(
            run_id,
            slot,
            profile_env,
            journey="cli-provider",
            profile=AGENT_V2_BINDING_PROFILE,
            worktree_variable="PT_AGENT_CLI_PROVIDER_WORKTREE",
            gateway_port_variable="PT_AGENT_CLI_PROVIDER_GATEWAY_PORT",
            renderer_port_variable="PT_AGENT_CLI_PROVIDER_RENDERER_PORT",
            webdriver_port_variable="PT_AGENT_CLI_PROVIDER_WEBDRIVER_PORT",
        )

    def _agent_minimum_usable_chat_client(
        self,
        run_id: str,
        slot: int,
        profile_env: dict[str, str],
    ) -> ClientRuntime:
        return self._agent_native_client(
            run_id,
            slot,
            profile_env,
            journey="minimum-usable-chat",
            profile=AGENT_V2_BINDING_PROFILE,
            worktree_variable="PT_AGENT_MINIMUM_USABLE_WORKTREE",
            gateway_port_variable="PT_AGENT_MINIMUM_USABLE_GATEWAY_PORT",
            renderer_port_variable="PT_AGENT_MINIMUM_USABLE_RENDERER_PORT",
            webdriver_port_variable="PT_AGENT_MINIMUM_USABLE_WEBDRIVER_PORT",
            actor="charlie",
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
                self._agent_v2_foundation_secondary_client(
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
            actor="charlie",
        )
        actors = tuple(
            resolve_existing_actor(
                station_url,
                role,
                profile_env["CHAT_NATIVE_DEMO_PASSWORD"],
            )
            for role in ("alice", "charlie")
        )
        _, _, actor_ref = persist_actor_manifest(
            ActorManifest(
                fixture_id="chat-native-existing-actors",
                environment_id=self.environment_id,
                run_id=manifest.run_id,
                created_at=utc_now(),
                actors=actors,
                credential_refs=credential_refs,
                reset_authorized=False,
                target_verified=True,
            )
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
            actor="charlie",
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
                actor="charlie",
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

    def _deploy_agent_v2_external_runtime(
        self,
        *,
        run_id: str,
        profile_env: dict[str, str],
        deployment_environment: str,
    ) -> None:
        runtime_env = external_runtime_environment(run_id)
        deploy_env = os.environ.copy()
        deploy_env.update(profile_env)
        deploy_env.update(runtime_env)
        deploy_env["PT_ACCEPTANCE_ENVIRONMENT"] = "home-station"
        deploy_env["PT_AGENT_CAPABILITY_SCENARIO_CONTROL"] = "1"
        completed = subprocess.run(
            ["make", "station"],
            cwd=REPO_ROOT,
            env=deploy_env,
            capture_output=True,
            text=True,
            timeout=1_800,
            check=False,
        )
        if completed.returncode != 0:
            detail = (
                completed.stderr.strip()
                or completed.stdout.strip()
                or "Station deployment failed"
            )
            raise BlockedError(
                reason=(
                    "P12 external runtime Station deployment failed: "
                    + detail[-4_000:]
                ),
                resource="station:external-runtime-deploy",
            )

        def cleanup_external_runtime() -> None:
            transport, environment = reviewed_remote_transport(
                deployment_environment
            )
            compose_project = environment.get(
                "PT_ACCEPTANCE_COMPOSE_PROJECT",
                "",
            ).strip()
            if not compose_project:
                raise RuntimeError(
                    "P12 external runtime cleanup has no Compose project"
                )
            root = external_runtime_root(run_id)
            remote_command = (
                "set -eu; "
                "container_id=\"$(docker ps --quiet "
                f"--filter {shlex.quote(f'label=com.docker.compose.project={compose_project}')} "
                f"--filter {shlex.quote('label=com.docker.compose.service=station')} "
                "| sed -n '1p')\"; "
                "test -n \"$container_id\"; "
                f"docker exec \"$container_id\" rm -rf -- {shlex.quote(root)}"
            )
            result = transport.run_argv(
                ["bash", "-lc", remote_command],
                timeout=60,
                check=False,
            )
            if result.returncode != 0:
                raise RuntimeError(
                    "P12 external runtime storage cleanup failed"
                )
            restore_env = os.environ.copy()
            restore_env.update(profile_env)
            restore_env.update(
                {
                    name: ""
                    for name in runtime_env
                }
            )
            restore_env.update(
                {
                    "PT_ACCEPTANCE_ENVIRONMENT": "",
                    "PT_AGENT_CAPABILITY_SCENARIO_CONTROL": "",
                    "PT_ACCEPTANCE_RUN_ID": "",
                }
            )
            restored = subprocess.run(
                ["make", "station"],
                cwd=REPO_ROOT,
                env=restore_env,
                capture_output=True,
                text=True,
                timeout=1_800,
                check=False,
            )
            if restored.returncode != 0:
                detail = (
                    restored.stderr.strip()
                    or restored.stdout.strip()
                    or "Station restore failed"
                )
                raise RuntimeError(
                    "P12 external runtime Station restore failed: "
                    + detail[-4_000:]
                )

        self.register_cleanup(
            f"agent-v2-external-runtime:{run_id}",
            cleanup_external_runtime,
        )

    def _deploy_agent_v2_scenario_control(
        self,
        *,
        gate_id: str,
        profile_env: dict[str, str],
    ) -> None:
        run_id = os.environ.get("PT_ACCEPTANCE_RUN_ID", "").strip()
        if not run_id:
            raise BlockedError(
                reason=f"{gate_id} requires the parent Acceptance run identity",
                resource="acceptance-run:PT_ACCEPTANCE_RUN_ID",
            )
        deploy_env = os.environ.copy()
        deploy_env.update(profile_env)
        deploy_env.update(
            {
                "PT_ACCEPTANCE_ENVIRONMENT": "home-station",
                "PT_AGENT_CAPABILITY_SCENARIO_CONTROL": "1",
                "PT_ACCEPTANCE_RUN_ID": run_id,
            }
        )
        completed = subprocess.run(
            ["make", "station"],
            cwd=REPO_ROOT,
            env=deploy_env,
            capture_output=True,
            text=True,
            timeout=1_800,
            check=False,
        )
        if completed.returncode != 0:
            detail = (
                completed.stderr.strip()
                or completed.stdout.strip()
                or "Station deployment failed"
            )
            raise BlockedError(
                reason=f"{gate_id} scenario-control deployment failed: "
                + detail[-4_000:],
                resource="station:scenario-control-deploy",
            )

        def cleanup_scenario_control() -> None:
            restore_env = os.environ.copy()
            restore_env.update(profile_env)
            restore_env.update(
                {
                    "PT_ACCEPTANCE_ENVIRONMENT": "",
                    "PT_AGENT_CAPABILITY_SCENARIO_CONTROL": "",
                    "PT_ACCEPTANCE_RUN_ID": "",
                }
            )
            restored = subprocess.run(
                ["make", "station"],
                cwd=REPO_ROOT,
                env=restore_env,
                capture_output=True,
                text=True,
                timeout=1_800,
                check=False,
            )
            if restored.returncode != 0:
                detail = (
                    restored.stderr.strip()
                    or restored.stdout.strip()
                    or "Station restore failed"
                )
                raise RuntimeError(
                    f"{gate_id} scenario-control restore failed: "
                    + detail[-4_000:]
                )

        self.register_cleanup(
            f"agent-v2-scenario-control:{run_id}",
            cleanup_scenario_control,
        )

    def _agent_v2_external_runtime_manifest(
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
                    "P12 external runtime requires "
                    "CHAT_NATIVE_DEMO_PASSWORD in Profile two"
                ),
                resource="profile:CHAT_NATIVE_DEMO_PASSWORD",
            )
        credential_refs = ("profile:CHAT_NATIVE_DEMO_PASSWORD",)
        actor = resolve_existing_actor(
            station_url,
            "bob",
            profile_env["CHAT_NATIVE_DEMO_PASSWORD"],
        )
        _, _, actor_ref = persist_actor_manifest(
            ActorManifest(
                fixture_id="agent-v2-external-runtime-existing-actor",
                environment_id=self.environment_id,
                run_id=manifest.run_id,
                created_at=utc_now(),
                actors=(actor,),
                credential_refs=credential_refs,
                reset_authorized=False,
                target_verified=True,
            )
        )
        return dataclasses.replace(
            manifest,
            actor_manifest_ref=actor_ref,
            credential_refs=credential_refs,
            clients=self._agent_v2_binding_clients(
                manifest.run_id,
                slot,
                profile_env,
                runtime_name="external-runtime",
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
        requires_reset = agent_native_requires_disposable_fixture(gate_id)
        if requires_reset and profile_env.get("CHAT_ACCEPTANCE_RESET") != "1":
            raise BlockedError(
                reason=(
                    f"{gate_id} actor Fixture reset requires "
                    "CHAT_ACCEPTANCE_RESET=1 in the approved profile"
                ),
                resource="fixture-reset:authorization",
            )
        if not profile_env.get("CHAT_NATIVE_DEMO_PASSWORD", ""):
            raise BlockedError(
                reason=(
                    f"{gate_id} requires CHAT_NATIVE_DEMO_PASSWORD "
                    "in the approved profile"
                ),
                resource="credential-ref:profile:CHAT_NATIVE_DEMO_PASSWORD",
            )
        requires_provider = agent_native_requires_provider(gate_id)
        if requires_provider:
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
        else:
            credential_refs = ("profile:CHAT_NATIVE_DEMO_PASSWORD",)
        roles = GATE_ROLES[gate_id]
        if requires_reset:
            _, _, actor_ref = produce_actor_manifest(
                environment_id=self.environment_id,
                run_id=manifest.run_id,
                station_url=station_url,
                deployment_environment=deployment_environment,
                roles=roles,
                credential_ref="profile:CHAT_NATIVE_DEMO_PASSWORD",
                reset_authorized=True,
            )
        else:
            actors = tuple(
                resolve_existing_actor(
                    station_url,
                    role,
                    profile_env["CHAT_NATIVE_DEMO_PASSWORD"],
                )
                for role in roles
            )
            _, _, actor_ref = persist_actor_manifest(
                ActorManifest(
                    fixture_id="chat-native-existing-actors",
                    environment_id=self.environment_id,
                    run_id=manifest.run_id,
                    created_at=utc_now(),
                    actors=actors,
                    credential_refs=credential_refs,
                    reset_authorized=False,
                    target_verified=True,
                )
            )
        if gate_id == "agent-attachment-e2e":
            client = self._agent_attachment_client(
                manifest.run_id,
                manifest.profile_slot,
                profile_env,
            )
        elif gate_id == AGENT_CLI_PROVIDER_GATE:
            client = self._agent_cli_provider_client(
                manifest.run_id,
                manifest.profile_slot,
                profile_env,
            )
            self.register_cleanup(
                "remote-station-cli-process-audit:"
                f"{deployment_environment}",
                lambda: audit_remote_station_cli_processes(
                    deployment_environment
                ),
            )
        elif gate_id == AGENT_MINIMUM_USABLE_CHAT_GATE:
            client = self._agent_minimum_usable_chat_client(
                manifest.run_id,
                manifest.profile_slot,
                profile_env,
            )
        else:
            client = self._agent_stream_client(
                manifest.run_id,
                manifest.profile_slot,
                profile_env,
                profile=agent_profile_for_gate(gate_id),
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
                    AGENT_V2_EXTERNAL_RUNTIME_GATE,
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
            if gate_id in AGENT_V2_SCENARIO_CONTROL_GATES:
                self._deploy_agent_v2_scenario_control(
                    gate_id=gate_id,
                    profile_env=profile_env,
                )
            if gate_id == AGENT_V2_EXTERNAL_RUNTIME_GATE:
                if manifest.workspace_digest != "clean":
                    raise BlockedError(
                        reason=(
                            f"{gate_id} requires a clean candidate "
                            "worktree before remote deployment"
                        ),
                        resource="source-identity:workspace",
                    )
                self._deploy_agent_v2_external_runtime(
                    run_id=manifest.run_id,
                    profile_env=profile_env,
                    deployment_environment=deployment_environment,
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
                AGENT_V2_EXTERNAL_RUNTIME_GATE,
                AGENT_MARKETPLACE_GATE,
                AGENT_MINIMUM_USABLE_CHAT_GATE,
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
                    AGENT_V2_EXTERNAL_RUNTIME_GATE,
                    AGENT_MARKETPLACE_GATE,
                    AGENT_MINIMUM_USABLE_CHAT_GATE,
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
            if gate_id == AGENT_V2_EXTERNAL_RUNTIME_GATE:
                manifest = self._agent_v2_external_runtime_manifest(
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
