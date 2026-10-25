"""Source-contract race replays; these do not provide native pixel proof."""
from __future__ import annotations

from unittest.mock import Mock, patch

from tooling.acceptance.gates.chat import mobile_device_search as shared
from tooling.acceptance.gates.social.content_search_mobile import SocialContentSearchMobileGate


def verify_capture() -> list[str]:
    checks = []

    def fixture(gate_type, platform="ios", state=""):
        gate = gate_type()
        session = Mock(platform=platform, client_id=f"sim-{platform}")
        sampling = {"watching": False, "revision": 0, "pixels": b"preceding private row"}

        def script(source, *args):
            if "new MutationObserver" in source:
                sampling["watching"] = True
            elif "delete window.__PT_SEARCH_CAPTURE_WATCH__" in source:
                sampling["watching"] = False

        def paint(source, milliseconds):
            assert source.count("requestAnimationFrame(") == 2
            assert 0 < milliseconds <= 30_000
            sampling["pixels"] = b"current terminal page"
            return True

        session.execute_script.side_effect = script
        session.execute_async_script.side_effect = paint
        session.screenshot_bytes.side_effect = lambda: sampling["pixels"]
        session.get_page_source.return_value = "<html>current terminal page</html>"

        def surface(_session):
            return {
                "searchState": state, "painted": True, "documentWidth": 390,
                "viewportWidth": 390, "unresolvedCopy": False, "rawIdentityCopy": False,
                "textContrasts": [8], "controls": [], "rows": [],
                "domRevision": sampling["revision"] if sampling["watching"] else 0,
                "originalSocial": {
                    "pending": False, "anchorCommentId": "historical-comment",
                    "anchorFocused": True, "anchorVisible": True,
                },
            }

        gate.surface = surface
        saved = {}
        artifacts = Mock()

        def write(path, content, **kwargs):
            saved[path] = content
            reference = Mock()
            reference.to_dict.return_value = {"path": path}
            return reference

        artifacts.write_bytes.side_effect = write
        return gate, session, sampling, artifacts, saved

    for platform in ("ios", "android"):
        for name, state in (("settings", ""), ("suspended", "concealed")):
            gate, session, sampling, artifacts, saved = fixture(
                shared.MobileDeviceSearchGate, platform, state,
            )
            gate.capture(artifacts, session, name, concealed=name == "suspended")
            assert saved[f"mobile-device-search/sim-{platform}/{name}/screenshot.png"] == (
                b"current terminal page"
            ), "current DOM accepted the preceding compositor frame"
            assert not sampling["watching"]
            checks.append(f"{platform}/{name}/paint")

    for gate_type in (shared.MobileDeviceSearchGate, SocialContentSearchMobileGate):
        gate, session, sampling, artifacts, saved = fixture(gate_type)
        images = 0

        def screenshot():
            nonlocal images
            images += 1
            if images == 1:
                sampling["revision"] += 2
                sampling["pixels"] = b"intermediate loading frame"
            return sampling["pixels"]

        session.screenshot_bytes.side_effect = screenshot
        with patch.object(shared.time, "sleep"):
            gate.capture(artifacts, session, "original-target")
        assert images == 2, "equal terminal snapshots hid an intermediate mutation"
        assert saved["mobile-device-search/sim-ios/original-target/screenshot.png"] == (
            b"current terminal page"
        ), "retry did not wait for its own painted frame"
        assert not sampling["watching"]
        checks.append(f"{gate_type.__name__}/mutation-and-repaint")

    gate, session, sampling, artifacts, saved = fixture(SocialContentSearchMobileGate)
    terminal = gate.surface(session)
    for pending in (
        {**terminal, "searchState": "loading"},
        {**terminal, "originalSocial": {**terminal["originalSocial"], "pending": True}},
        {**terminal, "originalSocial": {**terminal["originalSocial"], "anchorFocused": False}},
    ):
        gate.surface = Mock(side_effect=[pending, terminal, terminal])
        with patch.object(shared.time, "sleep"):
            gate.capture(artifacts, session, "original-target")
        assert not gate.frames["sim-ios/original-target"]["rendering"]["originalSocial"]["pending"]
        assert gate.frames["sim-ios/original-target"]["rendering"]["originalSocial"]["anchorFocused"]
        assert not sampling["watching"]
        checks.append(f"pending/{len(checks)}")

    gate, session, sampling, artifacts, saved = fixture(shared.MobileDeviceSearchGate, state="loading")
    with patch.object(shared.time, "monotonic", side_effect=[0, 31]):
        try:
            gate.capture(artifacts, session, "permanent-pending")
        except shared.GateError:
            pass
        else:
            raise AssertionError("permanent pending frame became terminal evidence")
    session.screenshot_bytes.assert_not_called()
    assert not sampling["watching"]
    checks.append("pending/deadline")

    gate, session, sampling, artifacts, saved = fixture(shared.MobileDeviceSearchGate)
    session.execute_async_script.side_effect = lambda *_args: False
    try:
        gate.capture(artifacts, session, "paint-timeout")
    except shared.GateError:
        pass
    else:
        raise AssertionError("missing paint frames became terminal evidence")
    session.screenshot_bytes.assert_not_called()
    assert not sampling["watching"]
    checks.append("paint/deadline")

    gate, session, sampling, artifacts, saved = fixture(shared.MobileDeviceSearchGate)
    session.screenshot_bytes.side_effect = RuntimeError("native screenshot failed")
    try:
        gate.capture(artifacts, session, "screenshot-failure")
    except RuntimeError:
        pass
    else:
        raise AssertionError("native screenshot failure was swallowed")
    session.switch_to_app_webview.assert_called_once()
    assert not sampling["watching"]
    checks.append("failure/finalization")

    gate, session, sampling, artifacts, saved = fixture(shared.MobileDeviceSearchGate, state="loading")
    gate.capture(artifacts, session, "diagnostic", diagnostic=True)
    assert not gate.frames["sim-ios/diagnostic"]["assertionPassed"]
    session.execute_async_script.assert_not_called()
    assert not sampling["watching"]
    checks.append("diagnostic/unasserted")
    return checks
