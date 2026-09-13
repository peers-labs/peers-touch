from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]


def _worktree_offset(worktree_id: str) -> int:
    import hashlib
    return int(hashlib.sha256(worktree_id.encode()).hexdigest(), 16) % 100


class DevRuntimePortIsolationTest(unittest.TestCase):
    def source(self, path: str) -> str:
        return (ROOT / path).read_text(encoding="utf-8")

    def test_desktop_dev_uses_worktree_offset_for_ports(self) -> None:
        src = self.source("tooling/scripts/local-dev/desktop-dev.sh")
        self.assertIn("_wt_offset", src)
        self.assertIn("WORKTREE_ID", src)
        self.assertRegex(src, r'GATEWAY_PORT="\$\(\(_base_gw\s*\+\s*_wt_offset\)\)"')
        self.assertRegex(src, r'WEB_PORT="\$\(\(_base_web\s*\+\s*_wt_offset\)\)"')

    def test_desktop_dev_does_not_use_profile_port_directly(self) -> None:
        src = self.source("tooling/scripts/local-dev/desktop-dev.sh")
        self.assertNotIn(
            'GATEWAY_PORT="${PT_DESKTOP_APP_GATEWAY_PORT',
            src,
            "Profile port must not be used directly — it would cause "
            "cross-worktree collisions when two worktrees share a profile",
        )

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

    def test_distinct_worktrees_produce_distinct_ports(self) -> None:
        worktrees = [
            "peers-group-chat",
            "peers-chat-high-chat",
            "peers-touch",
            "peers-oss",
            "peers-ai-agent",
        ]
        offsets = {wt: _worktree_offset(wt) for wt in worktrees}
        self.assertEqual(
            len(set(offsets.values())),
            len(worktrees),
            f"Worktree offsets must be unique: {offsets}",
        )
        base_gw = 3030
        base_web = 3210
        for wt_a, off_a in offsets.items():
            for wt_b, off_b in offsets.items():
                if wt_a >= wt_b:
                    continue
                gw_a = base_gw + off_a
                gw_b = base_gw + off_b
                web_a = base_web + off_a
                web_b = base_web + off_b
                self.assertNotEqual(
                    gw_a, gw_b,
                    f"Gateway port collision between {wt_a} and {wt_b}",
                )
                self.assertNotEqual(
                    web_a, web_b,
                    f"Web port collision between {wt_a} and {wt_b}",
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

    def test_env_sh_uses_worktree_specific_active_profile(self) -> None:
        src = self.source("tooling/scripts/local-dev/env.sh")
        self.assertIn(
            "ACTIVE_PROFILE", src,
            "env.sh must resolve the profile from the worktree-specific "
            "active symlink",
        )
        self.assertIn(
            'LOCAL_DEV_DIR/active/$WORKTREE_ID.env', src,
            "the active profile path must be scoped by worktree",
        )

    def test_env_sh_fails_when_no_profile_configured(self) -> None:
        src = self.source("tooling/scripts/local-dev/env.sh")
        missing_check = src.find('[[ ! -L "$ACTIVE_PROFILE" ]]')
        self.assertGreater(
            missing_check, 0,
            "env.sh must check whether the worktree-specific active symlink exists",
        )
        exit_after_missing = src.find("exit 1", missing_check)
        self.assertGreater(
            exit_after_missing, missing_check,
            "env.sh must exit 1 when no profile is configured, rather than "
            "silently continuing with empty environment",
        )

    def test_env_sh_fails_when_active_profile_target_is_invalid(self) -> None:
        src = self.source("tooling/scripts/local-dev/env.sh")
        invalid_target_check = src.find('[[ "$active_filename" != *.env ]]')
        self.assertGreater(
            invalid_target_check, 0,
            "env.sh must reject an active symlink target without an .env name",
        )
        exit_after_invalid_target = src.find("exit 1", invalid_target_check)
        self.assertGreater(
            exit_after_invalid_target, invalid_target_check,
            "env.sh must exit 1 when the active profile target is invalid",
        )

    def test_env_sh_rejects_unreviewed_env_and_unauthorized_local_fallback(self) -> None:
        src = self.source("tooling/scripts/local-dev/env.sh")
        self.assertIn(
            "git -C \"$ENV_REPO\" ls-files --error-unmatch",
            src,
            "env.sh must reject untracked env-repository profiles",
        )
        self.assertIn(
            'AUTHORIZATION_SCRIPT="$SCRIPT_DIR/environment-creation-authorization.py"',
            src,
            "env.sh must resolve the machine authorization verifier",
        )
        self.assertIn(
            'python3 "$AUTHORIZATION_SCRIPT" verify',
            src,
            "env.sh must require a consumed human authorization receipt for "
            "a machine-local profile",
        )
        self.assertNotIn(
            'PROFILE_FILE="$ACTIVE_PROFILE"\n  else',
            src,
            "env.sh must not silently accept a local profile fallback",
        )

    def test_env_sh_scopes_runtime_dirs_by_profile(self) -> None:
        src = self.source("tooling/scripts/local-dev/env.sh")
        for var in ("PT_DEV_PIDS", "PT_DEV_LOGS", "PT_DEV_DATA"):
            self.assertIn(var, src)
            self.assertIn(
                f'$PT_DEV_PROFILE', src,
                f"{var} must be scoped by PT_DEV_PROFILE so concurrent profiles "
                "do not collide",
            )

    def test_profile_sh_activates_only_the_worktree_specific_symlink(self) -> None:
        src = self.source("tooling/scripts/local-dev/profile.sh")
        self.assertNotIn(
            'echo "$name" > "$LOCAL_DEV_DIR/profile"',
            src,
            "profile.sh must not mutate the retired shared profile selector",
        )
        symlink_pos = src.find('ln -sfn "../profiles/$name.env" "$ACTIVE_FILE"')
        self.assertGreater(
            symlink_pos, 0,
            "profile.sh must activate the profile through the worktree-specific "
            "symlink",
        )

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
