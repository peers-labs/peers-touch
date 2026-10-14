from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]


class DevRuntimeNativeIsolationTest(unittest.TestCase):
    def source(self, path: str) -> str:
        return (ROOT / path).read_text(encoding="utf-8")

    def test_make_desktop_is_the_only_development_entrypoint(self) -> None:
        make_src = self.source("tooling/make/local-dev.mk")
        self.assertIn(
            "@$(DEVCTL) desktop start",
            make_src,
        )
        for retired in (
            "tooling/scripts/dev-desktop-app.sh",
            "tooling/scripts/e2e-desktop-launch.sh",
            "tooling/scripts/preview-desktop.sh",
            "tooling/scripts/_ensure-desktop-rust.sh",
            "tooling/scripts/_ensure-desktop-vite.sh",
            "tooling/scripts/_ensure-tauri-dev.sh",
            "tooling/scripts/local-dev/desktop-dev.sh",
        ):
            self.assertFalse((ROOT / retired).exists(), retired)
        root_package = self.source("package.json")
        desktop_package = self.source("apps/desktop/package.json")
        tauri_config = self.source("apps/desktop/src-tauri/tauri.conf.json")
        self.assertNotIn('"desktop:dev"', root_package)
        self.assertNotIn('"dev": "vite"', desktop_package)
        self.assertNotIn('"preview": "vite preview"', desktop_package)
        self.assertNotIn('"tauri:dev"', desktop_package)
        self.assertIn('"beforeDevCommand": null', tauri_config)
        main_source = self.source("apps/desktop/src/main.tsx")
        self.assertIn(
            "Desktop requires the Native Tauri runtime",
            main_source,
        )

    def test_devctl_owns_one_native_runtime(self) -> None:
        src = self.source("tooling/devctl/desktop.mjs")
        self.assertIn("desktop-native-vite", src)
        self.assertIn("desktop-native-tauri", src)
        self.assertIn("Desktop embedded renderer", src)
        self.assertIn("waitForDesktopFrontend", src)
        self.assertNotIn("gatewayPort", src)
        self.assertNotIn("PT_GATEWAY_PORT", src)
        self.assertNotIn("VITE_GATEWAY_PORT", src)

    def test_machine_registry_allocates_only_renderer_port(self) -> None:
        registry = self.source(
            "tooling/scripts/local-dev/machine-dev-registry.mjs"
        )
        profile = self.source("tooling/devctl/profile.mjs")
        self.assertIn("desktopAppWeb", registry)
        self.assertNotIn("desktopAppGateway", registry)
        self.assertIn("PT_DESKTOP_APP_WEB_PORT", profile)
        self.assertIn("RETIRED_DESKTOP_PROFILE_FIELDS", profile)
        self.assertIn(
            "withoutRetiredDesktopFields(readEnvFile(resolvedPath))",
            profile,
        )
        self.assertNotIn(
            "PT_DESKTOP_APP_GATEWAY_PORT: String(",
            profile,
        )

    def test_machine_registry_rejects_duplicate_slots(self) -> None:
        src = self.source(
            "tooling/scripts/local-dev/machine-dev-registry.mjs"
        )
        self.assertIn("const slots = new Set();", src)
        self.assertIn("slots.has(normalized.slot)", src)
        self.assertIn("local slot is allocated more than once", src)
        self.assertIn("function assertSlotAvailable", src)
        self.assertIn("'LOCAL_SLOT_CONFLICT'", src)


class DevRuntimeProtoOwnershipTest(unittest.TestCase):
    def source(self, path: str) -> str:
        return (ROOT / path).read_text(encoding="utf-8")

    def test_lib_crate_chat_common_reexport_from_messaging_core(self) -> None:
        src = self.source(
            "apps/desktop/src-tauri/src/provider_models_lib.rs"
        )
        self.assertIn("messaging_core::proto::chat", src)
        self.assertIn("messaging_core::proto::common", src)
        self.assertNotIn("peers_touch.model.chat.v1.rs", src)
        self.assertNotIn("peers_touch.model.common.v1.rs", src)

    def test_build_rust_skips_chat_common_via_extern_path(self) -> None:
        src = self.source("apps/desktop/src-tauri/build.rs")
        self.assertIn("extern_path", src)
        self.assertIn(".peers_touch.model.chat.v1", src)
        self.assertIn(".peers_touch.model.common.v1", src)
        self.assertFalse(
            any(
                f'"domain/chat/{name}"' in src
                for name in ("chat.proto", "conversation.proto")
            )
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
        self.assertGreater(missing_check, 0)
        self.assertGreater(src.find("exit 1", missing_check), missing_check)
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

    def test_machine_registry_accepts_local_and_rejects_unreviewed_remote_profiles(self) -> None:
        src = self.source(
            "tooling/scripts/local-dev/machine-dev-registry.mjs"
        )
        self.assertIn("['ls-files', '--error-unmatch', relative]", src)
        self.assertIn(
            "['status', '--porcelain', '--untracked-files=all', '--', relativeDirectory]",
            src,
            "machine resolution must reject dirty profile directories",
        )
        self.assertIn("sourceState = 'local'", src)
        self.assertNotIn("environmentAuthorizationHelperPath()", src)

    def test_env_sh_scopes_runtime_dirs_by_profile(self) -> None:
        src = self.source("tooling/scripts/local-dev/env.sh")
        for variable in ("PT_DEV_PIDS", "PT_DEV_LOGS", "PT_DEV_DATA"):
            self.assertIn(variable, src)
            self.assertIn("$PT_DEV_PROFILE", src)

    def test_profile_selection_uses_machine_binding(self) -> None:
        make_src = self.source("tooling/make/local-dev.mk")
        profile_src = self.source("tooling/scripts/local-dev/profile.sh")
        self.assertIn("@node $(MACHINE_DEV_SCRIPT) select \\", make_src)
        self.assertIn('--profile "$(PROFILE_ARG)" \\', make_src)
        self.assertIn('--owner "$(ENV_OWNER_ARG)"', make_src)
        self.assertIn("profile.sh {init|list}", profile_src)
        self.assertNotIn("activate)", profile_src)
        self.assertNotIn("ln -sfn", profile_src)

    def test_profile_init_directly_creates_non_overwriting_local_profile(self) -> None:
        src = self.source("tooling/scripts/local-dev/profile.sh")
        self.assertNotIn("AUTHORIZATION_SCRIPT", src)
        self.assertIn(
            "profile-init never overwrites an existing environment",
            src,
            "profile-init must not overwrite an existing local Profile",
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
