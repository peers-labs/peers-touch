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

    def test_env_sh_uses_profile_selector_file(self) -> None:
        src = self.source("tooling/scripts/local-dev/env.sh")
        self.assertIn(
            "PROFILE_SELECTOR", src,
            "env.sh must resolve the profile name from .local/dev/profile "
            "rather than relying solely on the legacy active symlink",
        )
        self.assertIn(
            'LOCAL_DEV_DIR/profile', src,
            "the profile selector path must be $LOCAL_DEV_DIR/profile",
        )

    def test_env_sh_fails_when_no_profile_configured(self) -> None:
        src = self.source("tooling/scripts/local-dev/env.sh")
        missing_check = src.find('[[ ! -f "$PROFILE_SELECTOR" ]]')
        self.assertGreater(
            missing_check, 0,
            "env.sh must check whether the profile selector file exists",
        )
        exit_after_missing = src.find("exit 1", missing_check)
        self.assertGreater(
            exit_after_missing, missing_check,
            "env.sh must exit 1 when no profile is configured, rather than "
            "silently continuing with empty environment",
        )

    def test_env_sh_fails_when_profile_selector_empty(self) -> None:
        src = self.source("tooling/scripts/local-dev/env.sh")
        empty_check = src.find('[[ -z "$PROFILE_NAME" ]]')
        self.assertGreater(
            empty_check, 0,
            "env.sh must check whether the profile selector content is empty",
        )
        exit_after_empty = src.find("exit 1", empty_check)
        self.assertGreater(
            exit_after_empty, empty_check,
            "env.sh must exit 1 when .local/dev/profile is empty",
        )

    def test_env_sh_resolves_from_env_repo_before_local_fallback(self) -> None:
        src = self.source("tooling/scripts/local-dev/env.sh")
        env_repo_check = src.find("profile.env.example")
        local_fallback = src.find("profiles/${PROFILE_NAME}.env", env_repo_check)
        self.assertGreater(
            env_repo_check, 0,
            "env.sh must check the env repo (profile.env.example) first",
        )
        self.assertGreater(
            local_fallback, env_repo_check,
            "local profiles/ must be the fallback after the env repo",
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

    def test_profile_sh_writes_selector_on_activation(self) -> None:
        src = self.source("tooling/scripts/local-dev/profile.sh")
        write_pos = src.find('echo "$name" > "$LOCAL_DEV_DIR/profile"')
        self.assertGreater(
            write_pos, 0,
            "profile.sh activate must write the profile name to "
            ".local/dev/profile so env.sh can resolve it",
        )
        symlink_pos = src.find("ln -sfn", write_pos)
        self.assertGreater(
            symlink_pos, write_pos,
            "the legacy symlink must still be created after writing the selector "
            "for backward compatibility",
        )


if __name__ == "__main__":
    unittest.main()
