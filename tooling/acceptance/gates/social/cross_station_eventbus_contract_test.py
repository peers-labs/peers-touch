from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
DESKTOP = ROOT / "apps" / "desktop" / "src"
MOMENTS_OWNER = DESKTOP / "runtimes" / "momentsRuntime.ts"
SEARCH_OBSERVER = DESKTOP / "runtimes" / "searchInvalidations.ts"
MOMENT_SUBSCRIPTION = re.compile(
    r"eventBus\.subscribe(?:\(\s*EVENT\.MOMENT_[A-Z_]+"
    r"|Many\(\s*\[[^\]]*EVENT\.MOMENT_[A-Z_]+)"
)
GUARDED_SEARCH_SUBSCRIPTION = re.compile(
    r"eventBus\.subscribeMany\(\s*\["
    r"(?:\s*EVENT\.MOMENT_[A-Z_]+\s*,?)+\s*\],\s*"
    r"\(\s*\{\s*payload\s*\}\s*\)\s*=>\s*\{\s*"
    r"if\s*\(\s*matchesCurrentMomentEvent\(\s*payload\s*\)\s*\)"
    r"\s*social\(\s*\);\s*\}\s*\)"
)
SEARCH_RESYNC_SUBSCRIPTION = re.compile(
    r"eventBus\.subscribe\(\s*EVENT\.MOMENT_RESYNC_REQUESTED\s*,\s*social\s*\)"
)


def source(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def is_read_only_search_observer(text: str) -> bool:
    """Admit the declared invalidation observer, never a second Store owner."""
    for imports, module in re.findall(
        r"import\s*\{([^}]+)\}\s*from\s*['\"]([^'\"]+)['\"]", text
    ):
        if module == "../runtimes/momentsRuntime" or module == "./momentsRuntime":
            if imports.strip() != "matchesCurrentMomentEvent":
                return False
        if module.startswith("../store/") and imports.strip() not in (
            "useMomentsStore",
            "usePrivateMomentsStore",
            "usePrivateCommentsStore",
        ):
            return False

    body = re.sub(r"^\s*import[\s\S]*?;\s*", "", text, flags=re.MULTILINE)
    for use in re.finditer(r"\buse(?:Private)?(?:Moments|Comments)Store\b", body):
        if not re.match(r"\s*\.subscribe\s*\(", body[use.end():]):
            return False
    if re.search(r"\.\s*(?:getState|setState)\s*\(", body):
        return False
    if not re.search(
        r"const\s+social\s*=\s*\(\s*\)\s*=>\s*changed\(\s*"
        r"\[\s*'device\.social'\s*,\s*'station\.social\.public'\s*\]\s*\);",
        body,
    ):
        return False
    return all(
        GUARDED_SEARCH_SUBSCRIPTION.match(body, subscription.start())
        or SEARCH_RESYNC_SUBSCRIPTION.match(body, subscription.start())
        for subscription in MOMENT_SUBSCRIPTION.finditer(body)
    )


def duplicate_projection_owners(sources: dict[Path, str]) -> list[str]:
    return sorted(
        str(path.relative_to(ROOT))
        for path, text in sources.items()
        if path != MOMENTS_OWNER
        and MOMENT_SUBSCRIPTION.search(text)
        and not (path == SEARCH_OBSERVER and is_read_only_search_observer(text))
    )


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

        consumers = set(
            re.findall(
                r"eventBus\.subscribe\(\s*EVENT\.(MOMENT_[A-Z_]+)",
                source(MOMENTS_OWNER),
            )
        )

        self.assertEqual(catalog, producers, "orphan Moment event producer")
        self.assertEqual(catalog, consumers, "orphan Moment event consumer")

        duplicate_owners = duplicate_projection_owners({
            path: source(path)
            for path in DESKTOP.rglob("*.ts*")
            if ".test." not in path.name
        })
        self.assertEqual([], duplicate_owners, "duplicate Moments projection owner")

    def test_search_observes_original_stores_without_owning_projection(self) -> None:
        self.assertEqual(
            [],
            duplicate_projection_owners({SEARCH_OBSERVER: source(SEARCH_OBSERVER)}),
        )

    def test_search_cannot_acquire_or_mutate_moments_store(self) -> None:
        text = source(SEARCH_OBSERVER)
        for replacement in (
            "useMomentsStore.getState().syncProjection('search');",
            "useMomentsStore.setState({ postsById: {} });",
            "const projection = useMomentsStore;",
            "usePrivateMomentsStore.getState().reconcileMomentsProjection();",
            "usePrivateMomentsStore.setState({ postsById: {} });",
            "const projection = usePrivateMomentsStore;",
            "usePrivateCommentsStore.getState().reset();",
        ):
            with self.subTest(replacement=replacement):
                mutated = text.replace(
                    "const social = () =>",
                    replacement + "\n  const social = () =>",
                    1,
                )
                self.assertNotEqual(text, mutated)
                self.assertEqual(
                    [str(SEARCH_OBSERVER.relative_to(ROOT))],
                    duplicate_projection_owners({SEARCH_OBSERVER: mutated}),
                )

    def test_search_cannot_drop_moment_identity_guard(self) -> None:
        text = source(SEARCH_OBSERVER)
        mutated = text.replace("if (matchesCurrentMomentEvent(payload)) ", "", 1)
        self.assertNotEqual(text, mutated)
        self.assertEqual(
            [str(SEARCH_OBSERVER.relative_to(ROOT))],
            duplicate_projection_owners({SEARCH_OBSERVER: mutated}),
        )

    def test_another_subscriber_is_not_a_declared_search_observer(self) -> None:
        other = DESKTOP / "runtimes" / "secondMomentsProjection.ts"
        for text in (
            "eventBus.subscribe(EVENT.MOMENT_CREATED, writeProjection);",
            "eventBus.subscribeMany([EVENT.MOMENT_CREATED], writeProjection);",
            source(SEARCH_OBSERVER),
        ):
            with self.subTest(text=text):
                self.assertEqual(
                    [str(other.relative_to(ROOT))],
                    duplicate_projection_owners({other: text}),
                )

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

        desktop_api = source(DESKTOP / "services" / "desktop_api.ts")
        self.assertIn(
            "eventBus.publish(EVENT.STATION_ACTIVE_CHANGED",
            desktop_api,
        )

    def test_one_host_policy_controls_all_social_registration(self) -> None:
        host_policy = source(DESKTOP / "kernel" / "hostPolicy.ts")
        self.assertIn("nativeSocialEnabled", host_policy)
        self.assertIn("__TAURI_INTERNALS__", host_policy)
        self.assertNotIn("__PT_GATEWAY_BASE__", host_policy)

        modules = source(DESKTOP / "modules" / "index.ts")
        self.assertNotIn("moments", modules)
        self.assertNotIn("social", modules)
        registrations = {
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
        self.assertIn("initializeDesktopHostPolicy();", main)


if __name__ == "__main__":
    unittest.main()
