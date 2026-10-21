from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import finalization_contracts as contracts
from tooling.acceptance.core.proof_admission import (
    ProofAdmissionRejected,
    build_source_inventory,
    run_restricted_claim,
    scan_forbidden_process_apis,
)


SHA_A = "a" * 64
SHA_B = "b" * 64
SHA_C = "c" * 64


def scanner_identity() -> contracts.PythonScannerInterpreterIdentity:
    build = contracts.LinuxRuntimeHostBuild.create(
        os_release_file_sha256=SHA_A,
        kernel_release="6.8.0",
        kernel_version="synthetic",
        machine="x86_64",
    )
    identity = contracts.LinuxRuntimeHostIdentity.create(
        host_build=build,
        machine_id_hash=SHA_B,
    )
    return contracts.PythonScannerInterpreterIdentity.create(
        host_os_family=contracts.RuntimeOsFamily.LINUX,
        host_build=build,
        host_identity=identity,
        executable_path_hash=SHA_A,
        executable_sha256=SHA_B,
        implementation="CPython",
        version="3.15",
        ast_grammar_feature_version="3.12",
        stdlib_digest=SHA_C,
    )


def resolution() -> contracts.AuthoritativeLatestResolution:
    return contracts.AuthoritativeLatestResolution.create(
        authority_mode=contracts.LatestAuthorityMode.FINALIZER_ENFORCED,
        workspace_id="0123456789abcdef",
        gate_id="synthetic-gate",
        interlock_digest=SHA_A,
        generation=1,
        enforcement_digest=SHA_B,
        manifest_ref=contracts.ArtifactRef(
            workspace_id="0123456789abcdef",
            gate_id="synthetic-gate",
            run_id="20261018T000000000000Z-" + "1" * 32,
            path="manifest.json",
            sha256=SHA_C,
            media_type="application/json",
        ),
        result_tuple=contracts.CanonicalResultTuple.PassedDoneProven,
    )


class ProofAdmissionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        core = self.root / "tooling" / "acceptance" / "core"
        fixture = self.root / "tooling" / "acceptance" / "fixtures"
        core.mkdir(parents=True)
        fixture.mkdir(parents=True)
        repository = Path(__file__).resolve().parents[3]
        for name in ("finalization_contracts.py", "proof_admission.py"):
            shutil.copy2(
                repository / "tooling" / "acceptance" / "core" / name,
                core / name,
            )
        self.claim = fixture / "claim.py"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_inventory_and_forbidden_process_scan(self) -> None:
        self.claim.write_text(
            "authoritative_result = authoritative_input.resolution\n",
            encoding="utf-8",
        )
        nodes = build_source_inventory(
            self.root,
            ("tooling/acceptance/fixtures/claim.py",),
        )
        scan = scan_forbidden_process_apis(
            repo_root=self.root,
            nodes=nodes,
            scanner_interpreter=scanner_identity(),
        )
        self.assertEqual(scan.findings, ())
        self.assertEqual(
            scan.proof_admission_source_digest,
            contracts.proof_admission_source_digest(nodes),
        )

        self.claim.write_text(
            "import subprocess\nsubprocess.run(['false'])\n",
            encoding="utf-8",
        )
        malicious = build_source_inventory(
            self.root,
            ("tooling/acceptance/fixtures/claim.py",),
        )
        with self.assertRaises(ProofAdmissionRejected):
            scan_forbidden_process_apis(
                repo_root=self.root,
                nodes=malicious,
                scanner_interpreter=scanner_identity(),
            )

    def test_restricted_claim_is_identity_only(self) -> None:
        expected = resolution()
        output = run_restricted_claim(
            b"authoritative_result = authoritative_input.resolution\n",
            resolution=expected,
        )
        self.assertEqual(output.resolution, expected)
        with self.assertRaises(ProofAdmissionRejected):
            run_restricted_claim(
                b"import os\nauthoritative_result = authoritative_input.resolution\n",
                resolution=expected,
            )


if __name__ == "__main__":
    unittest.main()
