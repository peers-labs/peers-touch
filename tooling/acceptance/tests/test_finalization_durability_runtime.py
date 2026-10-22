"""Synthetic qualification runtime and controller reference integrity."""

from __future__ import annotations

import copy
import unittest

from tooling.acceptance.core import finalization_contracts as contracts
from tooling.acceptance.tests import test_finalization_runtime_capture as fixtures


def signed(payload, field, domain):
    payload = {key: value for key, value in payload.items() if key != field}
    return {**payload, field: contracts.domain_separated_sha256(domain, payload)}


def anchor_wire():
    return signed({
        "artifactKind": "acceptance-power-controller-trust-anchor-ref",
        "schemaVersion": 1, "workspaceId": "0123456789abcdef",
        "gateId": "synthetic-gate", "trustGeneration": 1,
        "controllerIdentityDigest": "a" * 64, "trustAnchorDigest": "b" * 64,
    }, "trustAnchorRefDigest",
        "pt.acceptance.finalization.durability-power-controller-trust-anchor-ref.v1")


def runtime_wire():
    capture = fixtures.completed(fixtures.request())
    refs = []
    for item in capture["files"]:
        refs.append(contracts.DurabilityCapabilityArtifactRef.create(
            workspace_id="0123456789abcdef", gate_id="synthetic-gate",
            crash_fixture_id="synthetic-fixture",
            artifact_name=contracts.DurabilityCapabilityArtifactName.PROBE_RUNTIME_BLOB,
            object_digest=None, content_sha256=item["fileSha256"],
            byte_length=item["byteLength"],
        ).to_dict())
    return sign_runtime({
        "artifactKind": "acceptance-durability-probe-runtime", "schemaVersion": 1,
        "probeSourceDigest": "a" * 64, "runtimeMeasurement": capture["measurement"],
        "capturedRuntimeFiles": capture["files"], "runtimeArtifacts": refs,
        "runtimeCaptureBundleDigest": capture["runtimeCaptureBundleDigest"],
        "runtimeCaptureId": capture["captureId"],
        "runtimeCaptureDigest": capture["runtimeCaptureDigest"],
    })


def sign_runtime(payload):
    return signed(payload, "probeRuntimeDigest",
                  "pt.acceptance.finalization.durability-probe-runtime.v1")


def sign_blob(payload):
    return signed(payload, "durabilityCapabilityRefDigest",
                  "pt.acceptance.finalization.durability-capability-ref.v1")


class DurabilityRuntimeTests(unittest.TestCase):
    def test_anchor_roundtrip_and_closed_schema(self):
        wire = anchor_wire()
        self.assertEqual(contracts.PowerControllerTrustAnchorRef.from_dict(wire).to_dict(), wire)
        for field in wire:
            changed = dict(wire)
            changed.pop(field)
            with self.subTest(missing=field), self.assertRaises(ValueError):
                contracts.PowerControllerTrustAnchorRef.from_dict(changed)
        for field, value in (
            ("schemaVersion", True), ("trustGeneration", True),
            ("trustGeneration", 0),
            ("workspaceId", "bad"), ("gateId", "../escape"),
            ("controllerIdentityDigest", "bad"), ("trustAnchorDigest", None),
            ("path", "/tmp/anchor"),
        ):
            changed = signed({**wire, field: value}, "trustAnchorRefDigest",
                            "pt.acceptance.finalization.durability-power-controller-trust-anchor-ref.v1")
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                contracts.PowerControllerTrustAnchorRef.from_dict(changed)
        with self.assertRaises(ValueError):
            contracts.PowerControllerTrustAnchorRef.from_dict({**wire, "trustAnchorRefDigest": "0" * 64})
        with self.assertRaises(ValueError):
            contracts.PowerControllerTrustAnchorRef.from_dict({**wire, "trustGeneration": 9007199254740992})

    def test_probe_roundtrip_and_closed_schema(self):
        wire = runtime_wire()
        self.assertEqual(contracts.DurabilityProbeRuntimeManifest.from_dict(wire).to_dict(), wire)
        for field in wire:
            changed = dict(wire)
            changed.pop(field)
            with self.subTest(missing=field), self.assertRaises(ValueError):
                contracts.DurabilityProbeRuntimeManifest.from_dict(changed)
        for field, value in (
            ("artifactKind", "unknown"), ("schemaVersion", True),
            ("runtimeCaptureId", ""), ("probeSourceDigest", "bad"),
            ("runtimeCaptureDigest", "0" * 64), ("runtimeArtifacts", []),
            ("capturedRuntimeFiles", []), ("path", "/tmp"),
        ):
            with self.subTest(field=field), self.assertRaises(ValueError):
                contracts.DurabilityProbeRuntimeManifest.from_dict(sign_runtime({**wire, field: value}))
        with self.assertRaises(ValueError):
            contracts.DurabilityProbeRuntimeManifest.from_dict({**wire, "probeRuntimeDigest": "0" * 64})

    def test_probe_rejects_resigned_scope_content_and_order_mismatch(self):
        wire = runtime_wire()
        for field, value in (
            ("workspaceId", "fedcba9876543210"), ("gateId", "different-gate"),
            ("crashFixtureId", "different-fixture"), ("contentSha256", "0" * 64),
            ("byteLength", 100), ("artifactName", "MANIFEST"),
        ):
            changed = copy.deepcopy(wire)
            changed["runtimeArtifacts"][0] = sign_blob({
                **changed["runtimeArtifacts"][0], field: value,
                **({"objectDigest": "a" * 64} if field == "artifactName" else {}),
            })
            with self.subTest(field=field), self.assertRaises(ValueError):
                contracts.DurabilityProbeRuntimeManifest.from_dict(sign_runtime(changed))
        for field in ("runtimeArtifacts", "capturedRuntimeFiles"):
            for operation in ("reverse", "remove", "duplicate"):
                changed = copy.deepcopy(wire)
                if operation == "reverse":
                    changed[field].reverse()
                elif operation == "remove":
                    changed[field].pop()
                else:
                    changed[field].append(changed[field][0])
                with self.subTest(field=field, operation=operation), self.assertRaises(ValueError):
                    contracts.DurabilityProbeRuntimeManifest.from_dict(sign_runtime(changed))

    def test_probe_rejects_resigned_measured_closure_mismatch(self):
        changed = runtime_wire()
        changed["capturedRuntimeFiles"][0]["fileSha256"] = "0" * 64
        changed["runtimeArtifacts"][0] = sign_blob({
            **changed["runtimeArtifacts"][0], "contentSha256": "0" * 64,
        })
        changed["runtimeCaptureDigest"] = contracts.domain_separated_sha256(
            "pt.acceptance.finalization.runtime-capture.v1",
            {"captureId": changed["runtimeCaptureId"], "measurement": changed["runtimeMeasurement"],
             "files": changed["capturedRuntimeFiles"],
             "runtimeCaptureBundleDigest": changed["runtimeCaptureBundleDigest"]},
        )
        with self.assertRaises(ValueError):
            contracts.DurabilityProbeRuntimeManifest.from_dict(sign_runtime(changed))


if __name__ == "__main__":
    unittest.main()
