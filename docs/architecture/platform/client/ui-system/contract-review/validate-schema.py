"""Validate the review proposal with the standard jsonschema package."""
import copy
import hashlib
import json
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError

root = Path(__file__).resolve().parent
schema_bytes = (root / "registry.schema.json").read_bytes()
registry_bytes = (root / "typed-registry.json").read_bytes()
schema = json.loads(schema_bytes)
registry = json.loads(registry_bytes)
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
validator.validate(registry)

mutations = []
extra = copy.deepcopy(registry)
extra["schemaVersion"] = 2
mutations.append(extra)
for field, value in [
    ("status", "ACCEPTED"),
    ("sourceBasisDigest", "wrong-digest"),
]:
    candidate = copy.deepcopy(registry)
    candidate[field] = value
    mutations.append(candidate)
candidate = copy.deepcopy(registry)
candidate["contracts"][0]["status"]["implementation"] = "IMPLEMENTED"
mutations.append(candidate)
candidate = copy.deepcopy(registry)
candidate["contracts"][0]["constraints"][0]["expr"] = {
    "op": "eval", "args": [{"literal": True}, {"literal": True}]
}
mutations.append(candidate)
for candidate in mutations:
    try:
        validator.validate(candidate)
    except ValidationError:
        continue
    raise AssertionError("Malformed mutation was accepted")

sha = lambda b: "sha256:" + hashlib.sha256(b).hexdigest()
report = {
    "kind": "peers-ui-standard-json-schema-validation",
    "status": "PASS",
    "claimScope": "PROPOSED_RECORD_SHAPE_ONLY",
    "standard": "JSON Schema Draft 2020-12",
    "schemaDigest": sha(schema_bytes),
    "registryDigest": sha(registry_bytes),
    "validatorSourceDigest": sha(Path(__file__).read_bytes()),
    "rejectedMutations": len(mutations),
    "usefulnessEvidence": "UNPROVEN",
}
(root / "schema-validation.json").write_text(
    json.dumps(report, indent=2, ensure_ascii=False) + "\n"
)
print(json.dumps(report, ensure_ascii=False))
