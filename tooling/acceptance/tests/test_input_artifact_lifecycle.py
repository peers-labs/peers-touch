"""Actual equipment, original artifacts and cleanup through the canonical Runner."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from tooling.acceptance.core import ArtifactRef, EvidenceError, EvidenceStore
from tooling.acceptance.core.input_artifacts import validate_input_artifacts
from tooling.acceptance.core.execution_identity import InputIdentityError


REPO_ROOT = Path(__file__).resolve().parents[3]


class InputArtifactLifecycleTest(unittest.TestCase):
    def fixture(self, root: Path, *, slow_probe: bool = False, with_cell: bool = False):
        source = root / "source"
        source.mkdir()
        (source / "README.md").write_text("synthetic source")
        (source / ".gitignore").write_text(".local/\n")
        for args in (
            ("init", "-q"), ("add", "."),
            ("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
             "-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture"),
        ):
            subprocess.run(["git", *args], cwd=source, capture_output=True, check=True, timeout=5)
        (root / "input").write_text("material-input")
        contracts = root / "contracts"
        contracts.mkdir()
        (contracts / "synthetic-input-lifecycle.yaml").write_text(
            json.dumps({"id": "synthetic-input-lifecycle"}),
        )
        probe = f"""
import hashlib,json,os,sys,time
from pathlib import Path
sys.path.insert(0, {str(REPO_ROOT)!r})
from tooling.acceptance.core import EvidenceStore,ArtifactRef
c=json.loads(os.environ['PT_ACCEPTANCE_INPUT_CONTEXT'])
v=c['inputArtifacts']
assert v['gateId']==c['gate']['id']=='producer'
ref=ArtifactRef.from_dict(v['artifacts']['environment'])
store=EvidenceStore(Path(os.environ['PT_ACCEPTANCE_ARTIFACT_ROOT']),worktree=Path.cwd())
m=store.read_json(ref)
assert m['state']=='FIXTURE_READY'
equipment_bytes=store.resolve(ref).read_bytes()
if {with_cell!r}:
    cell=ArtifactRef.from_dict(v['artifacts']['runtimeCell'])
    assert store.read_json(cell)['state']=='LEASED'
    equipment_bytes+=store.resolve(cell).read_bytes()
    assert Path({str(root / 'cell')!r}).exists()==(c['observationStage']=='execution-inputs')
lease=Path({str(root / 'lease')!r})
assert lease.exists()==(c['observationStage']=='execution-inputs')
assert 'PT_MACHINE_LEASE_FD' not in os.environ
with Path({str(root / 'observations')!r}).open('a') as out:
    out.write(json.dumps({{'stage':c['observationStage'],'reference':ref.to_dict()}})+'\\n')
if {slow_probe!r} and c['observationStage']=='execution-inputs':
    Path({str(root / 'probe-pid')!r}).write_text(str(os.getpid()))
    time.sleep(10)
h=hashlib.sha256(equipment_bytes+Path(os.environ['INPUT_FILE']).read_bytes()).hexdigest()
print(json.dumps({{'artifactKind':'acceptance-gate-input-observation',
    'gateId':'producer','ownerId':'synthetic-equipment',
    'inputs':{{k:h for k in ('runtime','provider','oracle','actionPlan','fixture')}}}}))
"""
        gate = {
            "environment": "synthetic-input-lifecycle", "provisioner": "synthetic-input-lifecycle",
            "tier": "ci-cheap",
            "argv": [sys.executable, "-c",
                     f"from pathlib import Path;assert Path({str(root / 'lease')!r}).exists();"
                     f"p=Path({str(root / 'commands')!r});"
                     "p.write_text(p.read_text()+'x' if p.exists() else 'x')"],
            "executionInputs": {"environmentKeys": ["INPUT_FILE"], "identityProbe": {
                "ownerId": "synthetic-equipment", "argv": [sys.executable, "-c", probe],
                "timeoutSeconds": 10 if slow_probe else 1,
            }},
        }
        if with_cell:
            gate["requiredRuntimeCells"] = ["desktop-macos-native"]
        catalog = root / "catalog.json"
        catalog.write_text(json.dumps({"gates": {
            "producer": gate,
            "second": {"tier": "ci-cheap", "argv": [sys.executable, "-c",
                f"from pathlib import Path;import time;p=Path({str(root / 'second')!r});"
                "first=not p.exists();p.write_text(p.read_text()+'x' if p.exists() else 'x');"
                "time.sleep(10 if first else 0)"]},
            "consumer": {"tier": "ci-cheap", "judgment": "all-prerequisites",
                         "dependsOn": ["producer", "second"]},
        }}))
        policy = root / "policy.json"
        policy.write_text(json.dumps({
            "requestSeconds": 4, "planningSeconds": 1.5,
            "lifecycle": {"cleanupSeconds": 1, "publishSeconds": 1}, "gates": {},
        }))
        program = f"""
import importlib.util,sys,types
from pathlib import Path
from tooling.acceptance import core,provisioners
from tooling.acceptance.core import provisioner as base
from tooling.acceptance.core.provisioning import new_manifest
core.ENVIRONMENTS_DIR=Path({str(contracts)!r})
base.REPO_ROOT=Path({str(source)!r})
class SyntheticEquipment(base.EnvironmentProvisioner):
    environment_id='synthetic-input-lifecycle'
    def provision(self,gate_id):
        lease=Path({str(root / 'lease')!r})
        lease.write_text('owned')
        self.register_cleanup('synthetic-equipment',lambda:lease.unlink())
        count=Path({str(root / 'equipment')!r})
        count.write_text(count.read_text()+'x' if count.exists() else 'x')
        return self._ready(new_manifest(self.environment_id,gate_id,'synthetic','synthetic',
            0,self.evidence_run.source['commit'],str(base.REPO_ROOT),
            self.evidence_run.source['workspaceDigest']))
module=types.ModuleType('tooling.acceptance.provisioners.synthetic_input_lifecycle')
module.SyntheticEquipment=SyntheticEquipment
class SyntheticCell:
    contract=types.SimpleNamespace(cell_id='desktop-macos-native')
    def ready(self,gate_id,*,artifact_kind):
        assert Path({str(root / 'lease')!r}).exists()
        Path({str(root / 'cell')!r}).write_text('owned cell')
        return types.SimpleNamespace(to_dict=lambda:{{
            'artifactKind':'acceptance-runtime-cell-manifest','gateId':gate_id,
            'state':'LEASED','nativeAdapter':{{'inputMode':'semantic-nonintrusive'}}}})
    def stop(self):
        Path({str(root / 'cell')!r}).unlink()
        return {{'state':'CLEANED'}}
module.SyntheticCell=SyntheticCell
sys.modules[module.__name__]=module
provisioners._PROVISIONERS['synthetic-input-lifecycle']=(
    'synthetic_input_lifecycle','SyntheticEquipment','none')
provisioners._RUNTIME_CELL_LIFECYCLES['desktop-macos-native']=(
    'synthetic_input_lifecycle','SyntheticCell')
s=importlib.util.spec_from_file_location('runner',{str(REPO_ROOT / 'tooling/scripts/acceptance-run.py')!r})
m=importlib.util.module_from_spec(s)
s.loader.exec_module(m)
m.REPO_ROOT=base.REPO_ROOT
sys.argv=['acceptance-run.py',*sys.argv[1:]]
raise SystemExit(m.main())
"""
        command = [sys.executable, "-B", "-c", program, "--gates", str(catalog),
                   "--execution-budget", str(policy), "--gate", "consumer", "--stop-on-failure"]
        if with_cell:
            command += ["--runtime-cell", "desktop-macos-native"]
        environment = {**os.environ, "INPUT_FILE": str(root / "input"),
                       "PT_ACCEPTANCE_ARTIFACT_ROOT": str(root / "evidence")}
        store = EvidenceStore(root / "evidence", worktree=source)
        return gate, command, environment, store

    def report(self, store):
        latest = store.latest("acceptance-run")
        return (
            store.read_json(ArtifactRef.from_dict(latest["artifacts"]["run"])),
            store.read_json(ArtifactRef.from_dict(latest["artifacts"]["execution-session"])),
            latest,
        )

    def test_equipment_precedes_probe_and_original_context_survives_cleanup_and_resume(self):
        for drift in (False, True):
            with self.subTest(drift=drift), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                _, command, environment, store = self.fixture(root)
                first = subprocess.run(command, cwd=REPO_ROOT, env=environment,
                                       capture_output=True, text=True, timeout=10)
                original, session, latest = self.report(store)
                self.assertEqual(session["state"], "PAUSED_REQUEST_EXHAUSTED",
                                 first.stdout + first.stderr)
                self.assertFalse((root / "lease").exists())
                producer = original["results"][0]
                if drift:
                    (root / "input").write_text("changed material input")
                manifest = store.workspace_dir / "acceptance-run" / latest["runId"] / "manifest.json"
                reference = ArtifactRef(
                    latest["workspaceId"], "acceptance-run", latest["runId"], "manifest.json",
                    hashlib.sha256(manifest.read_bytes()).hexdigest(), "application/json",
                )
                resume = root / "resume.json"
                resume.write_text(json.dumps(reference.to_dict()))
                completed = subprocess.run(
                    command + ["--resume-session", str(resume)], cwd=REPO_ROOT,
                    env=environment, capture_output=True, text=True, timeout=10,
                )
                current, session, _ = self.report(store)
                self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
                self.assertEqual(session["state"], "QUALIFIED")
                self.assertFalse((root / "lease").exists())
                self.assertEqual((root / "equipment").read_text(), "xx" if drift else "x")
                self.assertEqual((root / "commands").read_text(), "xx" if drift else "x")
                result = next(item for item in current["results"] if item["id"] == "producer")
                self.assertEqual(result["runManifest"] == producer["runManifest"], not drift)
                observations = [json.loads(line) for line in (root / "observations").read_text().splitlines()]
                self.assertEqual(
                    [item["stage"] for item in observations[:3]],
                    ["execution-inputs", "input-revalidate", "original-input-validation"],
                )
                self.assertEqual(len({json.dumps(item["reference"], sort_keys=True)
                                      for item in observations[:3]}), 1)

    def test_runtime_cell_is_equipped_and_captured_before_its_probe(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            _, command, environment, store = self.fixture(root, with_cell=True)
            completed = subprocess.run(command, cwd=REPO_ROOT, env=environment,
                                       capture_output=True, text=True, timeout=10)
            report, session, _ = self.report(store)
            self.assertEqual(session["state"], "PAUSED_REQUEST_EXHAUSTED",
                             completed.stdout + completed.stderr)
            producer = report["results"][0]
            self.assertEqual(producer["proofStatus"], "PROVEN")
            ref = ArtifactRef.from_dict(producer["runManifest"])
            manifest = store.read_run_manifest(ref, manifest_sha256=ref.sha256)
            inputs = store.read_json(ArtifactRef.from_dict(manifest["artifacts"]["input-artifacts"]))
            self.assertEqual(set(inputs["artifacts"]), {"environment", "runtimeCell"})
            self.assertFalse((root / "cell").exists())
            self.assertFalse((root / "lease").exists())

    def test_actual_probe_cancellation_still_releases_already_equipped_resources(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            _, command, environment, store = self.fixture(root, slow_probe=True)
            completed = subprocess.run(command, cwd=REPO_ROOT, env=environment,
                                       capture_output=True, text=True, timeout=10)
            report, session, _ = self.report(store)
            self.assertEqual(session["state"], "PAUSED_REQUEST_EXHAUSTED",
                             completed.stdout + completed.stderr)
            self.assertFalse((root / "commands").exists())
            self.assertFalse((root / "lease").exists())
            self.assertEqual(report["results"][0]["cleanupStatus"], "passed")
            with self.assertRaises(ProcessLookupError):
                os.kill(int((root / "probe-pid").read_text()), 0)

    def test_wrong_missing_and_mutated_equipment_artifacts_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gate, command, environment, store = self.fixture(root)
            subprocess.run(command, cwd=REPO_ROOT, env=environment,
                           capture_output=True, text=True, timeout=10)
            report, _, _ = self.report(store)
            producer_ref = ArtifactRef.from_dict(report["results"][0]["runManifest"])
            manifest = store.read_run_manifest(producer_ref, manifest_sha256=producer_ref.sha256)
            context = store.read_json(ArtifactRef.from_dict(manifest["artifacts"]["input-artifacts"]))
            gate = {"id": "producer", **gate}
            for field, value in (("gateId", "wrong"), ("runId", "wrong"), ("artifacts", {})):
                changed = {**context, field: value}
                with self.subTest(field=field), self.assertRaises(InputIdentityError):
                    validate_input_artifacts(gate, changed, store, manifest["artifacts"], [])
            ref = ArtifactRef.from_dict(context["artifacts"]["environment"])
            store.resolve(ref).write_text("{}")
            with self.assertRaises(EvidenceError):
                validate_input_artifacts(gate, context, store, manifest["artifacts"], [])


if __name__ == "__main__":
    unittest.main()
