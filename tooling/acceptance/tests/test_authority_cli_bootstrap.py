from __future__ import annotations

import hashlib
import subprocess
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import finalization_contracts as contracts
from tooling.acceptance.core.authority_cli_bootstrap import (
    AuthorityBootstrapError,
    confirmation_challenge,
    load_verified_source_module,
    mutate_after_runtime_persisted,
    require_confirmation,
    verify_authority_source,
    verify_kernel_principal_and_tty,
)


class _Tty:
    def isatty(self) -> bool:
        return True


class AuthorityCliBootstrapTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        (self.root / "docs").mkdir()
        (self.root / "core").mkdir()
        self.approval = b"# Accepted D-19 authority\n"
        (self.root / "docs" / "approval.md").write_bytes(self.approval)
        (self.root / "core" / "authority.py").write_text(
            "import json\nVALUE = json.loads('1')\n",
            encoding="utf-8",
        )
        subprocess.run(("git", "init", "-q"), cwd=self.root, check=True)
        subprocess.run(
            ("git", "config", "user.email", "test@example.invalid"),
            cwd=self.root,
            check=True,
        )
        subprocess.run(
            ("git", "config", "user.name", "Acceptance Test"),
            cwd=self.root,
            check=True,
        )
        subprocess.run(("git", "add", "."), cwd=self.root, check=True)
        subprocess.run(
            ("git", "commit", "-qm", "fixture"),
            cwd=self.root,
            check=True,
        )
        self.commit = (
            subprocess.check_output(("git", "rev-parse", "HEAD"), cwd=self.root)
            .decode()
            .strip()
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def verified(self):
        return verify_authority_source(
            self.root,
            expected_commit=self.commit,
            approval_document_path="docs/approval.md",
            expected_approval_sha256=hashlib.sha256(self.approval).hexdigest(),
            source_paths=("core/authority.py",),
        )

    def test_clean_source_and_source_only_loader(self) -> None:
        verified = self.verified()
        module = load_verified_source_module(
            self.root,
            verified,
            relative_path="core/authority.py",
            module_name="_authority_fixture",
            allowed_modules=frozenset({"json"}),
        )
        self.assertEqual(module.VALUE, 1)
        (self.root / "core" / "authority.py").write_text(
            "import subprocess\n", encoding="utf-8"
        )
        with self.assertRaises(AuthorityBootstrapError):
            self.verified()

    def test_confirmation_principal_and_runtime_first_order(self) -> None:
        self.assertTrue(
            verify_kernel_principal_and_tty(
                input_stream=_Tty(),
                output_stream=_Tty(),
            ).startswith("uid:")
        )
        payload = {"action": "PROMOTE_ACTIVE_ANCHOR"}
        expected = confirmation_challenge(payload)
        self.assertEqual(
            require_confirmation(
                payload,
                read_confirmation=lambda presented: presented,
            ),
            expected,
        )
        events = []
        completed = object.__new__(
            contracts.PersistAuthorityRuntimeCompleted
        )
        result = mutate_after_runtime_persisted(
            persist_runtime=lambda: events.append("persist") or completed,
            mutation=lambda: events.append("mutate") or "done",
        )
        self.assertEqual(result, "done")
        self.assertEqual(events, ["persist", "mutate"])
        with self.assertRaises(AuthorityBootstrapError):
            mutate_after_runtime_persisted(
                persist_runtime=lambda: object(),
                mutation=lambda: self.fail("mutation must not run"),
            )


if __name__ == "__main__":
    unittest.main()
