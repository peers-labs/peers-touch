from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


CHECK_MODULE = Path(__file__).resolve().parents[1] / "devctl" / "checks.mjs"


def run_scanner(root: Path) -> subprocess.CompletedProcess[str]:
    script = (
        "import { checkSocialRuntimeBoundaries } from "
        + json.dumps(CHECK_MODULE.as_uri())
        + "; const violations = checkSocialRuntimeBoundaries(process.argv[1]);"
        + " process.stdout.write(JSON.stringify(violations));"
        + " process.exitCode = violations.length ? 1 : 0;"
    )
    return subprocess.run(
        ["node", "--input-type=module", "-e", script, str(root)],
        cwd=root,
        check=False,
        capture_output=True,
        text=True,
    )


class SocialRuntimeBoundaryScannerTest(unittest.TestCase):
    def test_rejects_page_created_ingress_and_projection_owners(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in (
                "apps/desktop/src/pages",
                "apps/desktop/src/components",
                "apps/mobile/src/pages",
                "apps/mobile/src/components",
            ):
                (root / relative).mkdir(parents=True)
            (root / "apps/mobile/src/pages/BadPage.tsx").write_text(
                "\n".join(
                    (
                        "const ingress = createSocialEventIngress({ onEvent() {} });",
                        "const moments = createMomentsProjection();",
                        "const profile = createProfileProjection(gateway);",
                        "const momentsGateway = createMomentsGateway(session);",
                        "const profileGateway = createProfileGateway(session);",
                        "const ingress = stubIngress;",
                    )
                ),
                encoding="utf-8",
            )

            result = run_scanner(root)

        self.assertNotEqual(result.returncode, 0)
        violations = json.loads(result.stdout)
        self.assertEqual(len(violations), 6)
        for violation in violations:
            self.assertEqual(violation["rule"], "ui-must-not-install-social-runtime")
            self.assertTrue(violation["file"].endswith("BadPage.tsx"))

    def test_accepts_page_consuming_runtime_owned_projection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in (
                "apps/desktop/src/pages",
                "apps/desktop/src/components",
                "apps/mobile/src/pages",
                "apps/mobile/src/components",
            ):
                (root / relative).mkdir(parents=True)
            (root / "apps/mobile/src/pages/GoodPage.tsx").write_text(
                "const runtime = readActiveMomentsRuntime(session);\n",
                encoding="utf-8",
            )

            result = run_scanner(root)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [])

    def test_rejects_mobile_ui_refreshing_social_projections_directly(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in (
                "apps/desktop/src/pages",
                "apps/desktop/src/components",
                "apps/mobile/src/pages",
                "apps/mobile/src/components",
            ):
                (root / relative).mkdir(parents=True)
            (root / "apps/mobile/src/pages/BadRefreshPage.tsx").write_text(
                "\n".join(
                    (
                        "void loadCurrentUserProfile();",
                        "void loadPeerProfile(peerPtid);",
                        "void loadFriendshipStatus(peerPtid);",
                    )
                ),
                encoding="utf-8",
            )

            result = run_scanner(root)

        self.assertNotEqual(result.returncode, 0)
        violations = json.loads(result.stdout)
        self.assertEqual(len(violations), 3)
        for violation in violations:
            self.assertEqual(
                violation["rule"],
                "mobile-ui-must-not-refresh-social-projections",
            )
            self.assertTrue(violation["file"].endswith("BadRefreshPage.tsx"))


if __name__ == "__main__":
    unittest.main()
