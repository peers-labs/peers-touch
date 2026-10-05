from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
DESKTOP = ROOT / "apps" / "desktop" / "src"


def source(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class CrossStationEventBusContractTest(unittest.TestCase):
    def test_moment_event_catalog_has_producers_and_one_runtime_owner(self) -> None:
        catalog = set(
            re.findall(
                r"^\s*(MOMENT_[A-Z_]+):",
                source(DESKTOP / "kernel" / "events" / "catalog.ts"),
                flags=re.MULTILINE,
            )
        )
        producers = set()
        for path in (
            DESKTOP / "services" / "eventStream.ts",
            DESKTOP / "services" / "social_api.ts",
        ):
            text = source(path)
            producers.update(
                re.findall(
                    r"eventBus\.publish\(\s*EVENT\.(MOMENT_[A-Z_]+)",
                    text,
                )
            )

        owner = DESKTOP / "runtimes" / "momentsRuntime.ts"
        consumers = set(
            re.findall(
                r"eventBus\.subscribe\(\s*EVENT\.(MOMENT_[A-Z_]+)",
                source(owner),
            )
        )

        self.assertEqual(catalog, producers, "orphan Moment event producer")
        self.assertEqual(catalog, consumers, "orphan Moment event consumer")

        duplicate_owners: list[str] = []
        for path in DESKTOP.rglob("*.ts*"):
            if ".test." in path.name or path == owner:
                continue
            if re.search(
                r"eventBus\.subscribe\(\s*EVENT\.MOMENT_[A-Z_]+",
                source(path),
            ):
                duplicate_owners.append(str(path.relative_to(ROOT)))
        self.assertEqual([], duplicate_owners, "duplicate Moments projection owner")

    def test_pages_do_not_own_freshness_or_private_native_listeners(self) -> None:
        violations: list[str] = []
        freshness_effect = re.compile(
            r"useEffect\s*\(\s*\(\)\s*=>\s*\{[\s\S]{0,2500}?"
            r"(?:loadFeed|syncProjection|ensureMoment|ensureUser|"
            r"ensureCircle|reconcileMomentsProjection)\s*\(",
        )
        for path in (DESKTOP / "pages" / "moments").glob("*.tsx"):
            text = source(path)
            if "eventBus.subscribe(" in text or "setInterval(" in text:
                violations.append(str(path.relative_to(ROOT)))
            if "@tauri-apps/api/event" in text or re.search(r"\blisten\s*[<(]", text):
                violations.append(str(path.relative_to(ROOT)))
            if freshness_effect.search(text):
                violations.append(str(path.relative_to(ROOT)))
        self.assertEqual([], sorted(set(violations)))

    def test_native_events_do_not_mutate_moments_stores_directly(self) -> None:
        checked = [
            DESKTOP / "runtimes" / "momentsRuntime.ts",
            DESKTOP / "store" / "moments.ts",
            DESKTOP / "store" / "privateMoments.ts",
            DESKTOP / "store" / "privateComments.ts",
        ]
        violations = [
            str(path.relative_to(ROOT))
            for path in checked
            if "@tauri-apps/api/event" in source(path)
            or re.search(r"\blisten\s*[<(]", source(path))
        ]
        self.assertEqual([], violations, "direct Tauri-to-store listener bypass")

    def test_runtime_owns_reconcile_identity_and_teardown(self) -> None:
        runtime = source(DESKTOP / "runtimes" / "momentsRuntime.ts")
        for marker in (
            "MOMENTS_RECONCILE_INTERVAL_MS",
            "sessionEpoch",
            "stationIdentity",
            "eventBus.subscribe(EVENT.STATION_ACTIVE_CHANGED",
            "invalidateScope()",
            "resetProjection(",
            "eventBus.subscribe(EVENT.MOMENT_CREATED",
            "eventBus.subscribe(EVENT.MOMENT_DELETED",
            "eventBus.subscribe(EVENT.MOMENT_REVOKED",
            "eventBus.subscribe(EVENT.MOMENT_COMMENTED",
            "eventBus.subscribe(EVENT.MOMENT_REACTED",
            "eventBus.subscribe(EVENT.MOMENT_RESYNC_REQUESTED",
        ):
            self.assertIn(marker, runtime)

        app_runtime = source(DESKTOP / "services" / "appRuntime.ts")
        self.assertIn("onWindowStationActiveChanged", app_runtime)
        self.assertIn(
            "eventBus.publish(EVENT.STATION_ACTIVE_CHANGED",
            app_runtime,
        )

    def test_one_host_policy_controls_all_social_registration(self) -> None:
        host_policy = source(DESKTOP / "kernel" / "hostPolicy.ts")
        self.assertIn("nativeSocialEnabled", host_policy)
        self.assertIn("__TAURI_INTERNALS__", host_policy)
        self.assertNotIn("__PT_GATEWAY_BASE__", host_policy)

        registrations = {
            "module": source(DESKTOP / "modules" / "index.ts"),
            "page": source(DESKTOP / "pages" / "registry.ts"),
            "runtime": source(DESKTOP / "services" / "appRuntime.ts"),
        }
        for owner, text in registrations.items():
            self.assertIn(
                "getDesktopHostPolicy().nativeSocialEnabled",
                text,
                f"{owner} does not consume the boot host policy",
            )

        main = source(DESKTOP / "main.tsx")
        self.assertNotIn("installBrowserGateway", main)
        self.assertFalse((DESKTOP / "kernel" / "gateway.ts").exists())
        self.assertLess(
            main.index("initializeDesktopHostPolicy();"),
            main.index("registerModulesForHost();"),
        )


if __name__ == "__main__":
    unittest.main()
