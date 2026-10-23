"""Fail-closed validator for the native device Search report."""
from __future__ import annotations

from tooling.acceptance.core import ArtifactRef, ArtifactSession, EvidenceStore, REPO_ROOT
from tooling.acceptance.gates.chat.device_search_runner import (
    GATE_ID, JOURNEY_ID, REQUIRED_ASSERTIONS, REQUIRED_STEPS, UI_ASSERTIONS, read_counts,
)
from tooling.acceptance.gates.chat.native_two_client_e2e import load_report, require, validate_report


def validate_search_report(report: dict, source_ref: ArtifactRef, store: EvidenceStore) -> None:
    validate_report(
        report, source_ref=source_ref, store=store, gate_id=GATE_ID,
        required_assertions=REQUIRED_ASSERTIONS, required_steps=REQUIRED_STEPS,
        expected_journey=JOURNEY_ID,
    )
    search = report["runtime"].get("search")
    require(isinstance(search, dict), "Search evidence is required")
    ui = search.get("ui", {})
    require(set(ui) == UI_ASSERTIONS, "all Search UI obligations require evidence")
    for name in UI_ASSERTIONS:
        require(ui[name].get("actor") == "alice", f"{name} must use the receiving native window")
        rendering = ui[name].get("rendering", {})
        require(rendering.get("painted") is True, f"{name} requires a painted native surface")
        if rendering.get("searchOpen"):
            require(
                "prepare" not in rendering.get("modalClass", "")
                and float(rendering.get("opacity", "0")) >= 0.99,
                f"{name} cannot use an invisible modal animation frame",
            )
        for suffix in ("screenshot", "dom"):
            ref = ArtifactRef.from_dict(ui[name].get(suffix))
            require(
                ref.workspace_id == source_ref.workspace_id and ref.gate_id == source_ref.gate_id
                and ref.run_id == source_ref.run_id, f"{name} requires current-run {suffix}",
            )
            store.resolve(ref)
    cache = search.get("cache", {})
    names = {"repeat_cache", "reopen_cache", "backspace_cache", "return_cache", "explicit_refresh"}
    require(set(cache) == names, "Search cache evidence is incomplete")
    log_ref = ArtifactRef.from_dict(report["evidence"]["alice-app-log"])
    lines = store.resolve(log_ref).read_text(errors="replace").splitlines()
    for name in names:
        observed = cache[name]
        for edge in ("before", "after"):
            counts = observed.get(edge)
            require(isinstance(counts, dict), f"{name} requires {edge} counters")
            length = counts.get("lineCount")
            require(isinstance(length, int) and 0 < length <= len(lines), "invalid final-log boundary")
            require(read_counts(lines[:length]) == counts, f"{name} counters differ from final native log")
        before, after = observed["before"], observed["after"]
        require(after["lineCount"] >= before["lineCount"], f"{name} log boundary is reversed")
        require(before["sourceReads"] > 0, "source-read tracing must actually observe source I/O")
        if name == "explicit_refresh":
            require(after["sourceReads"] > before["sourceReads"], "explicit refresh must query the source")
        else:
            require(after["sourceReads"] == before["sourceReads"], f"{name} queried the source")
            require(after["hydrationReads"] == before["hydrationReads"], f"{name} rehydrated cached content")
    denials = search.get("denials", {})
    for name, code in (
        ("forged_authority_denied", 7), ("stale_content_denied", 8),
        ("hidden_reference_denied", 8), ("previous_session_cursor_denied", 5),
    ):
        result = denials.get(name, {})
        require(result.get("accepted") is False and result.get("errorCode") == code,
                f"{name} must provide the expected typed native denial")
    handoff = search.get("sessionHandoff", {})
    before, after = handoff.get("before", {}), handoff.get("after", {})
    require(
        handoff.get("actor") == "bob"
        and str(handoff.get("actorPtid", "")).startswith("ptid:")
        and before.get("authenticated") is True
        and before.get("actorPtid") == handoff.get("actorPtid")
        and after.get("authenticated") is False
        and after.get("phase") in {"revoked", "accountGate"}
        and after.get("reason") == "revoked" and after.get("actorPtid") == "",
        "same-window account switch requires authoritative original Bob session revocation",
    )
    resources = search.get("resources", {})
    require(bool(resources.get("messageId")) and bool(resources.get("replyId")), "real message IDs required")
    require(len(set(resources.get("fillerIds", []))) == 55, "history must exceed the latest window")
    require(
        bool(resources.get("attachmentMessageId")) and len(resources.get("attachmentIds", [])) == 1
        and bool(resources.get("attachmentFilename")),
        "attachment filename evidence requires the real uploaded Messaging resource",
    )


def main() -> int:
    store = EvidenceStore.from_environment(repo_root=REPO_ROOT, worktree=REPO_ROOT)
    report, source_ref = load_report(store, GATE_ID)
    validate_search_report(report, source_ref, store)
    reference = ArtifactSession(repo_root=REPO_ROOT, gate_id=GATE_ID).write_json(
        f"reports/{GATE_ID}-validation.json", {
            "artifactKind": "chat-device-search-validation", "gate": GATE_ID,
            "status": "pass", "completionStatus": "DONE", "proofStatus": "PROVEN",
            "sampleEmissionAllowed": False, "sourceArtifact": source_ref.to_dict(),
            "testedCommit": report["runtime"]["sourceIdentity"]["orchestrator"]["commit"],
            "assertionCount": len(REQUIRED_ASSERTIONS),
        }, role="validation",
    )
    print(f"PASS: {GATE_ID} validation {reference.path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
