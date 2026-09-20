from __future__ import annotations

import socket
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]


class DevRuntimePortIsolationTest(unittest.TestCase):
    def source(self, path: str) -> str:
        return (ROOT / path).read_text(encoding="utf-8")

    def test_desktop_dev_uses_machine_slot_lease_and_assigned_ports(self) -> None:
        src = self.source("tooling/scripts/local-dev/desktop-dev.sh")
        self.assertIn('PT_MACHINE_LEASE_KIND:-}" == "local.slot"', src)
        self.assertIn('PT_MACHINE_LEASE_RESOURCE_ID:-}" == "$PT_DEV_SLOT"', src)
        self.assertIn("verify-held", src)
        self.assertIn('exec node "$SCRIPT_DIR/machine-dev.mjs" lease', src)
        self.assertEqual(src.count("--resource-kind local.slot"), 2)
        self.assertEqual(src.count('--resource-id "$PT_DEV_SLOT"'), 2)
        self.assertIn("${PT_DESKTOP_APP_GATEWAY_PORT}", src)
        self.assertIn("${PT_DESKTOP_APP_WEB_PORT}", src)
        self.assertIn("${PT_DESKTOP_WEB_GATEWAY_PORT}", src)
        self.assertIn("${PT_DESKTOP_WEB_WEB_PORT}", src)
        self.assertNotIn("_wt_offset", src)

    def test_desktop_dev_preserves_explicit_port_overrides(self) -> None:
        src = self.source("tooling/scripts/local-dev/desktop-dev.sh")
        self.assertIn('_caller_gw="${PT_GATEWAY_PORT:-}"', src)
        self.assertIn('_caller_web="${PT_RENDERER_PORT:-}"', src)
        self.assertIn(
            'GATEWAY_PORT="${_caller_gw:-${PT_DESKTOP_APP_GATEWAY_PORT}}"',
            src,
        )
        self.assertIn(
            'WEB_PORT="${_caller_web:-${PT_DESKTOP_APP_WEB_PORT}}"',
            src,
        )

    def test_acceptance_owned_runtime_preserves_explicit_resources(self) -> None:
        src = self.source("tooling/scripts/local-dev/desktop-dev.sh")
        env_src = self.source("tooling/scripts/local-dev/env.sh")
        self.assertIn('_caller_gw="${PT_GATEWAY_PORT:-}"', src)
        self.assertIn('_caller_web="${PT_RENDERER_PORT:-}"', src)
        self.assertIn('_caller_profile="${PT_PROFILE:-}"', src)
        self.assertIn('GATEWAY_PORT="${_caller_gw:-', src)
        self.assertIn('WEB_PORT="${_caller_web:-', src)
        self.assertIn('PT_PROFILE="${_caller_profile:-', src)
        self.assertIn(
            'PT_DEV_PROFILE_FILE_AUTHORITY:-}" != "acceptance-runtime-manifest"',
            env_src,
        )
        self.assertIn("PT_ACCEPTANCE_RUNTIME_PROFILE_ROOT", env_src)
        self.assertIn("profile.parent != root", env_src)

    def test_rust_pid_file_includes_worktree_id(self) -> None:
        src = self.source("tooling/scripts/_ensure-desktop-rust.sh")
        self.assertIn("WORKTREE_ID", src)
        self.assertRegex(src, r'pid_file=.*\$\{wt_id\}')
        self.assertRegex(src, r'meta_file=.*\$\{wt_id\}')

    def test_vite_pid_file_includes_worktree_id(self) -> None:
        src = self.source("tooling/scripts/_ensure-desktop-vite.sh")
        self.assertIn("WORKTREE_ID", src)
        self.assertRegex(src, r'VITE_PID_FILE=.*\$\{wt_id\}')
        self.assertRegex(src, r'VITE_META_FILE=.*\$\{wt_id\}')

    def test_rust_tauri_config_contains_bundle_identifier(self) -> None:
        src = self.source("tooling/scripts/_ensure-desktop-rust.sh")
        self.assertIn("bundle_id", src)
        self.assertIn("com.peertouch.dev.", src)
        self.assertRegex(src, r'bundle_id="com\.peertouch\.dev\.\$\{wt_suffix\}"')
        self.assertIn('\\"identifier\\"', src)
        self.assertIn("${bundle_id}", src)

    def test_browser_rust_bff_does_not_create_a_tauri_renderer(self) -> None:
        src = self.source("tooling/scripts/_ensure-desktop-rust.sh")
        self.assertEqual(
            src.count('\\"windows\\":[{\\"create\\":false}]'),
            2,
            "Both Browser BFF configurations must remain rendererless",
        )
        self.assertNotIn(
            '\\"windows\\":[{\\"visible\\":false}]',
            src,
            "A hidden WebView still boots the Desktop frontend and competes "
            "with the Browser gateway for session ownership",
        )

    def test_native_startup_timeout_fails_closed(self) -> None:
        port = self._unused_port()
        completed = subprocess.run(
            [
                "bash",
                "-c",
                (
                    "source tooling/scripts/_ensure-desktop-rust.sh; set +e; "
                    "sleep 5 & child=$!; "
                    f"wait_for_gateway {port} 1 \"$child\"; status=$?; "
                    "kill \"$child\" 2>/dev/null || true; "
                    "wait \"$child\" 2>/dev/null || true; "
                    "exit \"$status\""
                ),
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 124, completed.stdout + completed.stderr)

    def test_native_startup_preserves_child_exit_status(self) -> None:
        port = self._unused_port()
        completed = subprocess.run(
            [
                "bash",
                "-c",
                (
                    "source tooling/scripts/_ensure-desktop-rust.sh; set +e; "
                    "(sleep 0.1; exit 73) & child=$!; "
                    f"wait_for_gateway {port} 3 \"$child\""
                ),
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 73, completed.stdout + completed.stderr)

    @staticmethod
    def _unused_port() -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            return int(listener.getsockname()[1])

    def test_machine_registry_rejects_duplicate_slots(self) -> None:
        src = self.source(
            "tooling/scripts/local-dev/machine-dev-registry.mjs"
        )
        self.assertIn("const slots = new Set();", src)
        self.assertIn("slots.has(normalized.slot)", src)
        self.assertIn("local slot is allocated more than once", src)
        self.assertIn("function assertSlotAvailable", src)
        self.assertIn("'LOCAL_SLOT_CONFLICT'", src)
        self.assertIn(
            "entry.workspaceId !== workspaceId && entry.slot === slot",
            src,
        )


class DevRuntimeProtoOwnershipTest(unittest.TestCase):
    def source(self, path: str) -> str:
        return (ROOT / path).read_text(encoding="utf-8")

    def test_lib_crate_chat_common_reexport_from_messaging_core(self) -> None:
        src = self.source(
            "apps/desktop/src-tauri/src/provider_models_lib.rs"
        )
        self.assertIn("messaging_core::proto::chat", src)
        self.assertIn("messaging_core::proto::common", src)
        self.assertNotIn(
            'peers_touch.model.chat.v1.rs',
            src,
            "Lib crate must not include! chat proto generated file — "
            "build.rs skips chat/common via extern_path; they are owned by "
            "messaging-core. Use re-export instead.",
        )
        self.assertNotIn(
            'peers_touch.model.common.v1.rs',
            src,
            "Lib crate must not include! common proto generated file — "
            "same reason as chat.",
        )

    def test_build_rust_skips_chat_common_via_extern_path(self) -> None:
        src = self.source("apps/desktop/src-tauri/build.rs")
        self.assertIn("extern_path", src)
        self.assertIn(".peers_touch.model.chat.v1", src)
        self.assertIn(".peers_touch.model.common.v1", src)
        chat_proto_in_list = any(
            f'"domain/chat/{name}"' in src
            for name in ("chat.proto", "conversation.proto")
        )
        self.assertFalse(
            chat_proto_in_list,
            "build.rs must not list chat protos — they are compiled by "
            "messaging-core's build.rs",
        )


class DevRuntimeProfileResolutionTest(unittest.TestCase):
    def source(self, path: str) -> str:
        return (ROOT / path).read_text(encoding="utf-8")

    def test_env_sh_resolves_machine_registry_profile(self) -> None:
        src = self.source("tooling/scripts/local-dev/env.sh")
        self.assertIn('node "$MACHINE_DEV_SCRIPT" resolve', src)
        self.assertIn("--format shell", src)
        self.assertIn('PROFILE_FILE="$PT_MACHINE_PROFILE_FILE"', src)
        self.assertNotIn("ACTIVE_PROFILE", src)
        self.assertNotIn(".local/dev/active", src)

    def test_env_sh_fails_when_machine_resolution_is_unavailable(self) -> None:
        src = self.source("tooling/scripts/local-dev/env.sh")
        missing_check = src.find('if ! resolved_exports="$(')
        self.assertGreater(
            missing_check, 0,
            "env.sh must require machine control-plane resolution",
        )
        exit_after_missing = src.find("exit 1", missing_check)
        self.assertGreater(
            exit_after_missing, missing_check,
            "env.sh must exit when machine resolution fails",
        )
        self.assertIn("no profile or slot fallback is allowed", src)

    def test_env_sh_rejects_uncontained_acceptance_profile(self) -> None:
        src = self.source("tooling/scripts/local-dev/env.sh")
        self.assertIn(
            'PT_DEV_PROFILE_FILE_AUTHORITY:-}" != "acceptance-runtime-manifest"',
            src,
        )
        self.assertIn('"$runtime_profile_root" != /*', src)
        self.assertIn("resolve(strict=True)", src)
        self.assertIn("stat.S_ISREG(metadata.st_mode)", src)
        self.assertIn("metadata.st_uid != os.getuid()", src)
        self.assertIn("profile.parent != root", src)

    def test_machine_registry_rejects_unreviewed_or_unauthorized_profiles(self) -> None:
        src = self.source(
            "tooling/scripts/local-dev/machine-dev-registry.mjs"
        )
        self.assertIn(
            "['ls-files', '--error-unmatch', relative]",
            src,
            "machine resolution must reject untracked env-repository profiles",
        )
        self.assertIn(
            "['status', '--porcelain', '--untracked-files=all', '--', relativeDirectory]",
            src,
            "machine resolution must reject dirty profile directories",
        )
        self.assertIn(
            "environmentAuthorizationHelperPath()",
            src,
            "machine resolution must use the canonical authorization helper",
        )
        self.assertIn(
            "'verify'",
            src,
            "machine-local profiles require a consumed authorization receipt",
        )
        self.assertIn("sourceState = 'authorized-local'", src)

    def test_env_sh_scopes_runtime_dirs_by_profile(self) -> None:
        src = self.source("tooling/scripts/local-dev/env.sh")
        for var in ("PT_DEV_PIDS", "PT_DEV_LOGS", "PT_DEV_DATA"):
            self.assertIn(var, src)
            self.assertIn(
                f'$PT_DEV_PROFILE', src,
                f"{var} must be scoped by PT_DEV_PROFILE so concurrent profiles "
                "do not collide",
            )

    def test_profile_selection_updates_machine_binding_without_symlink(self) -> None:
        make_src = self.source("tooling/make/local-dev.mk")
        profile_src = self.source("tooling/scripts/local-dev/profile.sh")
        self.assertIn(
            '@node $(MACHINE_DEV_SCRIPT) update --profile "$(PROFILE_ARG)"',
            make_src,
        )
        self.assertIn("profile.sh {authorize|init|list}", profile_src)
        self.assertNotIn("activate)", profile_src)
        self.assertNotIn("ln -sfn", profile_src)

    def test_profile_init_consumes_human_authorization(self) -> None:
        src = self.source("tooling/scripts/local-dev/profile.sh")
        self.assertIn(
            '"$AUTHORIZATION_SCRIPT" consume',
            src,
            "profile-init must consume an exact machine authorization before "
            "creating a local profile",
        )
        self.assertIn(
            "profile-init never overwrites an existing environment",
            src,
            "profile-init must not turn one authorization into overwrite authority",
        )

    def test_remote_deploy_resolves_reviewed_env_repository_definition(self) -> None:
        src = self.source("tooling/scripts/deploy/deploy.sh")
        self.assertIn("resolve_reviewed_deploy_env", src)
        self.assertIn("ls-files --error-unmatch", src)
        self.assertNotIn(
            'ENV_FILE="$ENVS_DIR/$env_name.env"',
            src,
            "remote deploy must not treat .local/deploy/envs as topology authority",
        )
        warm_cache = self.source("tooling/docker/warm-builder-cache.sh")
        self.assertIn('"$DEPLOY_SCRIPT" resolve', warm_cache)
        self.assertNotIn(
            ".local/deploy/envs",
            warm_cache,
            "builder cache mutation must use the reviewed deploy resolver",
        )


if __name__ == "__main__":
    unittest.main()
