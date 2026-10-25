"""Source-contract race replays; these do not provide native pixel proof."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from unittest.mock import Mock, patch

from tooling.acceptance.core import AcceptanceGate, new_report
from tooling.acceptance.gates.chat import mobile_device_search as shared
from tooling.acceptance.gates.chat import device_search_runner as desktop
from tooling.acceptance.gates.social.content_search_desktop import SocialContentSearchDesktopGate
from tooling.acceptance.gates.social.content_search_mobile import SocialContentSearchMobileGate


# CSSOM values shared by the existing controlled DOM adapters, not a paint oracle.
PAINT_STYLE_JS = """
const paintStyle = {display: 'block', visibility: 'visible', opacity: '1',
  position: 'static', zIndex: 'auto', pointerEvents: 'auto',
  backgroundColor: 'transparent', backgroundImage: 'none', boxShadow: 'none',
  transform: 'none', translate: 'none', rotate: 'none', scale: 'none',
  filter: 'none', perspective: 'none', backdropFilter: 'none',
  overflowX: 'visible', overflowY: 'visible', clipPath: 'none', clip: 'auto',
  boxSizing: 'border-box', width: 'auto', height: 'auto',
  left: 'auto', right: 'auto', top: 'auto', bottom: 'auto'};
for (const edge of ['Top', 'Right', 'Bottom', 'Left']) {
  paintStyle['margin' + edge] = '0px';
  paintStyle['padding' + edge] = '0px';
  paintStyle['border' + edge + 'Width'] = '0px';
  paintStyle['border' + edge + 'Style'] = 'none';
}
const fixedPseudo = () => ({...paintStyle, content: '""', position: 'fixed',
  left: '0px', top: '0px', right: '0px', bottom: '0px',
  zIndex: '2147483647', pointerEvents: 'none', backgroundColor: 'rgb(0, 0, 0)'});
global.getComputedStyle = (node, pseudo) => pseudo
  ? node.pseudos?.[pseudo] || {...paintStyle, content: 'none'}
  : node.style;
"""


def verify_visibility() -> list[str]:
    # Controlled DOM adapters execute the actual capture predicate. These are
    # source-contract negatives, not a browser or native screenshot substitute.
    result = subprocess.run(
        ["node", "-e", PAINT_STYLE_JS + """
const assert = require('node:assert/strict');
global.window = {visualViewport: null};
global.innerWidth = 390; global.innerHeight = 800;
const box = {left: 40, top: 100, right: 240, bottom: 150, width: 200, height: 50};
const make = parent => ({
  isConnected: true, parentElement: parent,
  style: {...paintStyle},
  getBoundingClientRect: () => box, getAnimations: () => [],
  getClientRects() { return [this.getBoundingClientRect()]; },
  clientLeft: 0, clientTop: 0, clientWidth: 200, clientHeight: 50,
  scrollLeft: 0, scrollTop: 0,
  childNodes: [], tagName: 'DIV', compareDocumentPosition: () => 2,
  contains(hit) { for (let node = hit; node; node = node.parentElement) {
    if (node === this) return true; } return false; },
});
const parent = make(null), target = make(parent), cover = make(null);
global.document = {elementFromPoint: () => target,
  querySelectorAll: () => [parent, target, cover]};
""" + desktop.TARGET_VISIBILITY_JS + """
const cases = [];
const negative = (name, reason, mutate, restore) => {
  mutate();
  const observed = targetVisibility(target);
  assert.equal(observed.visible, false, name);
  assert.equal(observed.reason, reason, name);
  restore();
  assert.equal(targetVisibility(target).visible, true, name + '/restored');
  cases.push(name);
};
assert.equal(targetVisibility(target).visible, true);
negative('target-opacity-zero', 'style',
  () => target.style.opacity = '0', () => target.style.opacity = '1');
negative('ancestor-opacity-zero', 'style',
  () => parent.style.opacity = '0', () => parent.style.opacity = '1');
negative('cumulative-opacity', 'style',
  () => { parent.style.opacity = '0.994'; target.style.opacity = '0.994'; },
  () => { parent.style.opacity = '1'; target.style.opacity = '1'; });
negative('covered-target', 'occluded',
  () => document.elementFromPoint = () => cover,
  () => document.elementFromPoint = () => target);
negative('hidden-ancestor', 'style',
  () => parent.style.visibility = 'hidden', () => parent.style.visibility = 'visible');
negative('clipped-target', 'clipped',
  () => { parent.style.overflowY = 'hidden'; parent.clientHeight = 20; },
  () => { parent.style.overflowY = 'visible'; parent.clientHeight = 50; });
negative('outside-viewport', 'clipped',
  () => innerHeight = 90, () => innerHeight = 800);
negative('active-animation', 'motion',
  () => parent.getAnimations = () => [{pending: false, playState: 'running'}],
  () => parent.getAnimations = () => []);
negative('clip-path', 'style',
  () => parent.style.clipPath = 'inset(100%)', () => parent.style.clipPath = 'none');
negative('noninteractive-opaque-cover', 'noninteractive-cover',
  () => { cover.style.pointerEvents = 'none'; cover.style.backgroundColor = 'rgb(0, 0, 0)'; },
  () => { cover.style.pointerEvents = 'auto'; cover.style.backgroundColor = 'transparent'; });
cover.style.pointerEvents = 'none'; cover.style.backgroundColor = 'rgba(0, 0, 0, 0)';
assert.equal(targetVisibility(target).visible, true);
cases.push('transparent-cover-control');
cover.style.backgroundColor = 'rgb(0, 0, 0)';
cover.style.position = 'fixed'; cover.style.zIndex = '-1';
assert.equal(targetVisibility(target).visible, true);
cases.push('behind-cover-control');
cover.style = {...paintStyle};
parent.tagName = 'BODY';
for (const pseudo of ['::before', '::after']) {
  negative('ancestor-fixed-' + pseudo, 'noninteractive-cover',
    () => parent.pseudos = {[pseudo]: fixedPseudo()},
    () => delete parent.pseudos);
}
negative('target-fixed-pseudo', 'noninteractive-cover',
  () => target.pseudos = {'::after': fixedPseudo()}, () => delete target.pseudos);
cover.getBoundingClientRect = () => ({left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0});
negative('zero-host-fixed-pseudo', 'noninteractive-cover',
  () => cover.pseudos = {'::before': fixedPseudo()}, () => delete cover.pseudos);
negative('unknown-pseudo-geometry', 'noninteractive-cover',
  () => cover.pseudos = {'::after': {...fixedPseudo(), position: 'relative'}},
  () => delete cover.pseudos);
negative('unknown-pseudo-offset', 'noninteractive-cover',
  () => cover.pseudos = {'::after': {...fixedPseudo(), left: 'calc(50% - 20px)',
    right: 'auto', width: '100px'}}, () => delete cover.pseudos);
for (const [name, change] of [
  ['unresolved-left-with-right', {left: 'calc(50% - 100px)', right: '0px',
    width: '100px', top: '100px', height: '50px'}],
  ['unresolved-top-with-bottom', {top: 'calc(50% - 300px)', bottom: '0px',
    height: '50px', left: '40px', width: '200px'}],
]) {
  negative(name, 'noninteractive-cover',
    () => cover.pseudos = {'::after': {...fixedPseudo(), ...change}},
    () => delete cover.pseudos);
}
for (const [name, change] of [
  ['auto-left-with-right', {left: 'auto', right: '0px', width: '100px',
    top: '100px', height: '50px'}],
  ['auto-top-with-bottom', {top: 'auto', bottom: '0px', height: '50px',
    left: '40px', width: '200px'}],
]) {
  cover.pseudos = {'::after': {...fixedPseudo(), ...change}};
  assert.equal(targetVisibility(target).visible, true, name);
  delete cover.pseudos;
  cases.push(name);
}
negative('transformed-pseudo-geometry', 'noninteractive-cover',
  () => cover.pseudos = {'::after': {...fixedPseudo(), transform: 'translateX(5px)'}},
  () => delete cover.pseudos);
negative('pseudo-style-unavailable', 'paint-unqualified',
  () => cover.pseudos = {'::after': new Proxy({}, {get() {throw Error('CSSOM unavailable');}})},
  () => delete cover.pseudos);
negative('pseudo-overflow-text', 'noninteractive-cover',
  () => cover.pseudos = {'::after': {...fixedPseudo(), content: '"long text"',
    left: '500px', width: '1px', height: '1px'}}, () => delete cover.pseudos);
negative('pseudo-shadow-outside-box', 'noninteractive-cover',
  () => cover.pseudos = {'::after': {...fixedPseudo(), left: '500px',
    width: '1px', height: '1px', boxShadow: '-500px 100px 100px black'}},
  () => delete cover.pseudos);
negative('transformed-containing-block', 'noninteractive-cover',
  () => {parent.style.transform = 'translateX(0px)';
    parent.pseudos = {'::before': fixedPseudo()};},
  () => {parent.style.transform = 'none'; delete parent.pseudos;});
target.style.position = 'relative'; target.style.zIndex = '1';
negative('non-stacking-will-change', 'noninteractive-cover',
  () => {cover.style.willChange = 'color'; cover.pseudos = {'::after': fixedPseudo()};},
  () => {delete cover.style.willChange; delete cover.pseudos;});
target.style = {...paintStyle};
for (const host of [parent, cover]) {
  for (const [name, change] of [
    ['transparent', {backgroundColor: 'rgba(0, 0, 0, 0)'}],
    ['opacity-zero', {opacity: '0'}],
    ['hidden', {visibility: 'hidden'}],
    ['behind', {zIndex: '-1'}],
    ['outside', {left: '500px', width: '100px', height: '100px'}],
  ]) {
    host.pseudos = {'::before': {...fixedPseudo(), ...change}};
    assert.equal(targetVisibility(target).visible, true, name + '/pseudo-control');
    delete host.pseudos;
    cases.push((host === parent ? 'ancestor/' : 'zero-host/') + name + '-pseudo-control');
  }
}
// Match the product's positioned decoration below higher-z foreground content.
parent.style.position = 'relative';
target.style.position = 'relative'; target.style.zIndex = '3';
parent.pseudos = {'::before': {...fixedPseudo(), position: 'absolute', zIndex: 'auto',
  backgroundImage: 'linear-gradient(transparent, rgba(255,255,255,0.75))'}};
assert.equal(targetVisibility(target).visible, true);
cases.push('product-positioned-decoration-control');
delete parent.pseudos;
target.style = {...paintStyle}; parent.style = {...paintStyle};
parent.pseudos = {'::before': {...fixedPseudo(), position: 'absolute', zIndex: '1',
  left: '0px', right: '0px', top: '0px', bottom: '0px'}};
parent.style.position = 'relative';
negative('absolute-ancestor-pseudo', 'noninteractive-cover', () => {},
  () => {delete parent.pseudos; parent.style = {...paintStyle};});
cover.style = {...paintStyle, pointerEvents: 'none', backgroundColor: 'rgb(0, 0, 0)'};
cover.getClientRects = () => [box];
negative('ordinary-client-fragment', 'noninteractive-cover', () => {},
  () => cover.style = {...paintStyle});
cover.getClientRects = () => [{...box, left: NaN}];
negative('ordinary-unknown-fragment', 'noninteractive-cover',
  () => cover.style = {...paintStyle, pointerEvents: 'none', backgroundColor: 'black'},
  () => cover.style = {...paintStyle});
parent.style.pointerEvents = 'none'; parent.style.backgroundColor = 'black';
assert.equal(targetVisibility(target).visible, true);
cases.push('ordinary-ancestor-background-control');
console.log(JSON.stringify(cases));
"""],
        check=True, capture_output=True, text=True, timeout=10,
    )
    return json.loads(result.stdout)


def verify_original_surfaces() -> list[str]:
    checks = []
    for platform in ("desktop", "mobile"):
        session = Mock()
        session.execute_script.side_effect = [
            {"searchOpen": False},
            {"pending": False, "threadVisible": True, "anchorVisible": True,
             "anchorFocused": True},
        ]
        if platform == "mobile":
            SocialContentSearchMobileGate.surface(session)
        else:
            gate = object.__new__(SocialContentSearchDesktopGate)
            gate.clients = {"alice": session}
            gate.original_social_target = {
                "postId": "post", "commentId": "comment", "postText": "original body",
                "text": "historical comment",
                "item": {"sourceId": "device.social", "resource": {"id": "comment"}},
            }
            gate.surface()
        source = session.execute_script.call_args_list[1].args[0]
        result = subprocess.run(
            ["node", "-e", PAINT_STYLE_JS + """
const assert = require('node:assert/strict');
global.window = {visualViewport: null};
global.innerWidth = 390; global.innerHeight = 800;
const make = (parent, top = 0, bottom = 800) => ({
  isConnected: true, parentElement: parent, dataset: {}, innerText: '',
  style: {...paintStyle},
  getBoundingClientRect: () => ({left: 0, right: 390, top, bottom,
    width: 390, height: bottom - top}),
  getClientRects() { return [this.getBoundingClientRect()]; },
  getAnimations: () => [], clientLeft: 0, clientTop: 0,
  scrollLeft: 0, scrollTop: 0,
  clientWidth: 390, clientHeight: bottom - top,
  childNodes: [], tagName: 'DIV', compareDocumentPosition: () => 2,
  contains(hit) { for (let node = hit; node; node = node.parentElement) {
    if (node === this) return true; } return false; },
  querySelector: () => null, querySelectorAll: () => [],
});
const root = make(null), thread = make(root), card = make(root, 50, 160);
const body = make(card, 100, 150), anchor = make(thread, 200, 260);
const comment = make(anchor, 210, 240), cover = make(null);
root.dataset = {postId: 'post', sourceId: 'device.social', anchorCommentId: 'comment'};
card.dataset = {postId: 'post'}; body.innerText = 'original body';
thread.dataset = {momentsCommentThread: 'post'};
anchor.dataset = {momentsComment: 'comment', searchAnchor: 'true',
  scrollAnchorId: 'comment', searchHighlighted: 'true'};
comment.innerText = 'historical comment';
root.querySelector = selector => selector.includes('social-moment-card') ? card : null;
root.querySelectorAll = selector => selector.includes('data-scroll-anchor-id')
  ? [anchor] : selector.includes('social-moment-card') ? [card] : [];
card.querySelector = () => body; card.querySelectorAll = () => [body];
thread.querySelectorAll = () => [anchor];
thread.closest = () => ({parentElement: root});
anchor.querySelector = () => comment;
let covered = false;
global.document = {
  activeElement: anchor,
  querySelector: () => root, querySelectorAll: selector => selector === '*'
    ? [root, thread, card, body, anchor, comment, cover] : [thread],
  elementFromPoint: (_x, y) => covered ? cover
    : y >= 100 && y <= 150 ? body : y >= 210 && y <= 240 ? comment
    : y >= 200 && y <= 260 ? anchor : root,
};
const observe = new Function(""" + json.dumps(source) + """);
const sample = () => observe('post', 'comment', 'original body');
const original = sample();
assert.equal(original.postId, 'post');
assert.equal(original.postText, 'original body');
assert.equal(original.anchorText, 'historical comment');
assert.equal(original.anchorFocused, true);
assert.equal(original.threadVisible, true);
assert.equal(original.anchorVisible, true);
const cases = ['exact-original-control'];
root.style.opacity = '0';
assert.equal(sample().threadVisible, false);
assert.equal(sample().anchorVisible, false);
cases.push('opacity-original');
root.style.opacity = '1'; covered = true;
assert.equal(sample().threadVisible, false);
assert.equal(sample().anchorVisible, false);
cases.push('covered-original');
covered = false; document.activeElement = body;
assert.equal(sample().anchorFocused, false);
cases.push('wrong-focus');
document.activeElement = anchor;
cover.style.pointerEvents = 'none'; cover.style.backgroundColor = 'rgb(0, 0, 0)';
assert.equal(sample().threadVisible, false);
assert.equal(sample().anchorVisible, false);
cases.push('noninteractive-original-cover');
cover.style = {...paintStyle};
const rejected = [];
for (const [name, host, pseudo, change] of [
  ['body-fixed-before', root, '::before', {}],
  ['body-fixed-after', root, '::after', {}],
  ['zero-host-fixed-before', cover, '::before', {}],
  ['unknown-pseudo-geometry', cover, '::after', {position: 'relative'}],
  ['unresolved-left-with-right', cover, '::after', {left: 'calc(50% - 100px)',
    right: '0px', width: '100px', top: '100px', height: '50px'}],
  ['unresolved-top-with-bottom', cover, '::after', {top: 'calc(50% - 300px)',
    bottom: '0px', height: '50px', left: '40px', width: '200px'}],
]) {
  root.tagName = 'BODY';
  cover.getBoundingClientRect = () => ({left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0});
  host.pseudos = {[pseudo]: {...fixedPseudo(), ...change}};
  const observed = sample();
  assert.equal(observed.threadVisible, false, name);
  assert.equal(observed.postVisible, false, name);
  assert.equal(observed.anchorVisible, false, name);
  assert.equal(observed.anchorFocused, true, name);
  rejected.push({name, observed});
  delete host.pseudos;
  assert.equal(sample().anchorVisible, true, name + '/restored');
  cases.push(name);
}
for (const [name, change] of [
  ['transparent', {backgroundColor: 'transparent'}], ['behind', {zIndex: '-1'}],
]) {
  root.pseudos = {'::before': {...fixedPseudo(), ...change}};
  const control = sample();
  assert.equal(control.threadVisible, true);
  assert.equal(control.postVisible, true);
  assert.equal(control.anchorVisible, true);
  delete root.pseudos;
  cases.push('ancestor-' + name + '-control');
}
console.log(JSON.stringify({cases, original, rejected}));
"""],
            check=True, capture_output=True, text=True, timeout=10,
        )
        observed = json.loads(result.stdout)
        checks.extend(f"{platform}/{case}" for case in observed["cases"])
        for rejected in observed["rejected"]:
            frame = {"searchOpen": False, "searchState": "ready", "painted": True,
                     "originalSocial": rejected["observed"]}
            if platform == "desktop":
                frame["originalSocial"].update(
                    issuedSourceId="device.social", issuedResource={"id": "comment"},
                )
                assert not gate.original_matches(frame)
            else:
                assert SocialContentSearchMobileGate.capture_pending(frame, False)
            checks.append(f"{platform}/predicate-reject-{rejected['name']}")
        if platform == "desktop":
            original = {**observed["original"],
                        "issuedSourceId": "device.social", "issuedResource": {"id": "comment"}}
            rendering = {"searchOpen": False, "painted": True, "originalSocial": original}
            assert gate.original_matches(rendering)
            for key, value in (
                ("postId", "wrong"), ("commentParentId", "wrong"),
                ("issuedSourceId", "station.social.public"), ("issuedResource", {"id": "wrong"}),
                ("postText", "wrong body"), ("anchorText", "wrong comment"),
                ("anchorCommentId", "wrong"), ("anchorFocused", False), ("anchorVisible", False),
            ):
                assert not gate.original_matches({
                    **rendering, "originalSocial": {**original, key: value},
                }), key
                checks.append(f"desktop/reject-{key}")
    return checks


def verify_continuity() -> list[str]:
    checks = []
    before = {"items": [{"id": "historical", "text": "exact original"}],
              "anchor": "historical", "anchorTop": 110, "scrollTop": 200}
    terminal = {**before, "elapsedMs": 2100, "sameNodes": True}
    for platform in ("desktop", "mobile"):
        for name, change in (
            ("stable-control", {}), ("replaced-nodes", {"sameNodes": False}),
            ("reset-page", {"items": []}), ("lost-anchor", {"anchor": "newest"}),
            ("moved-anchor", {"anchorTop": 112}), ("reset-scroll", {"scrollTop": 0}),
            ("before-reconcile", {"elapsedMs": 1999}),
        ):
            session = Mock()
            session.execute_script.side_effect = [before, {**terminal, **change}, None]
            if platform == "desktop":
                gate = object.__new__(desktop.DeviceSearchGate)
                gate.clients = {"alice": session}
                gate.report = new_report(gate.gate_id)
                gate.report.runtime["search"] = {}
                gate.wait_js = Mock()
                gate.settled = Mock()
                run = lambda: gate.reconcile_continuity(name)
            else:
                gate = shared.MobileDeviceSearchGate()
                gate.wait = Mock()
                gate.capture = Mock()
                run = lambda: gate.reconcile_continuity(Mock(), session, name)
            try:
                run()
            except shared.GateError:
                assert name != "stable-control"
            else:
                assert name == "stable-control"
            assert session.execute_script.call_args.args == (
                "delete window.__PT_SEARCH_CONTINUITY__;",
            )
            checks.append(f"{platform}/{name}")
    return checks


def verify_continuity_script() -> list[str]:
    result = subprocess.run(
        ["node", "-e", """
const assert = require('node:assert/strict');
let now = 0;
global.performance = {now: () => now}; global.window = {};
const make = id => ({dataset: {resourceId: id}, innerText: 'original ' + id,
  getBoundingClientRect: () => ({top: 110, bottom: 140})});
let rows = [make('historical')];
const root = {scrollTop: 200, querySelectorAll: () => rows,
  getBoundingClientRect: () => ({top: 100, bottom: 500})};
global.document = {querySelector: () => root};
const start = new Function(""" + json.dumps(desktop.SEARCH_CONTINUITY_START_JS) + """);
const end = new Function(""" + json.dumps(desktop.SEARCH_CONTINUITY_END_JS) + """);
const before = start('root', 'rows'); now = 2100;
assert.equal(end('root', 'rows').elapsedMs, 2100);
assert.equal(end('root', 'rows').sameNodes, true);
const original = rows;
rows = [make('historical')];
assert.equal(end('root', 'rows').sameNodes, false);
rows = original;
rows[0].getBoundingClientRect = () => ({top: 112, bottom: 142});
assert.equal(end('root', 'rows').anchorTop, 112);
rows[0].dataset.resourceId = 'newest';
assert.notEqual(end('root', 'rows').anchor, before.anchor);
root.scrollTop = 0;
assert.notEqual(end('root', 'rows').scrollTop, before.scrollTop);
rows = [];
assert.deepEqual(end('root', 'rows').items, []);
console.log(JSON.stringify(['elapsed-control', 'same-node-control', 'node-replacement',
  'anchor-position', 'anchor-identity', 'scroll-reset', 'page-reset']));
"""],
        check=True, capture_output=True, text=True, timeout=10,
    )
    return json.loads(result.stdout)


def verify_return() -> list[str]:
    before = {
        "query": "original query", "filter": "social", "selected": "historical",
        "activeDescendant": "pt-search-option-3",
        "items": [{"id": "historical", "sourceId": "device.social"}],
        "scrollTop": 200, "anchor": "historical", "anchorTop": 110,
    }
    checks = []
    for name, change in (
        ("real-back-control", {}), ("broken-back", {}),
        ("query-reset", {"query": ""}), ("filter-reset", {"filter": "messages"}),
        ("selection-reset", {"selected": ""}),
        ("active-descendant-reset", {"activeDescendant": ""}),
        ("page-reset", {"items": []}), ("source-reset", {"items": [
            {"id": "historical", "sourceId": "station.social.public"}]}),
        ("scroll-reset", {"scrollTop": 0}), ("anchor-reset", {"anchor": "newest"}),
        ("anchor-moved", {"anchorTop": 112}),
    ):
        gate = object.__new__(SocialContentSearchDesktopGate)
        gate.report = new_report(gate.gate_id)
        gate.report.runtime["search"] = {}
        gate.query = before["query"]
        session = Mock()
        gate.clients = {"alice": session}
        gate.open_search = Mock(side_effect=AssertionError("global reopen substituted for Back"))
        gate.field = Mock()
        gate.wait_surface = Mock()
        gate.settled = Mock()
        gate.reconcile_continuity = Mock()
        gate.surface = Mock(return_value={"query": before["query"]})
        gate.rows = Mock(return_value="original target text")
        session.find_element.return_value.get_attribute.return_value = "true"
        session.execute_script.return_value = {**before, **change}
        if name == "broken-back":
            session.find_element.return_value.click.side_effect = shared.GateError("Back unavailable")

        def visible(_name, predicate):
            shared.require(predicate(), "captured Return context changed")

        gate.visible = visible
        try:
            gate.return_search(name, before, "original target text")
        except shared.GateError:
            assert name != "real-back-control"
        else:
            assert name == "real-back-control"
            gate.reconcile_continuity.assert_called_once()
        assert session.find_element.call_args_list[0].args == (
            "[data-search-return] button:first-child", 20,
        )
        gate.open_search.assert_not_called()
        checks.append(name)
    return checks


def verify_desktop_capture() -> list[str]:
    checks = []
    for failure in ("mutation-retry", "paint-timeout", "screenshot-failure"):
        gate = object.__new__(desktop.DeviceSearchGate)
        gate.report = new_report(gate.gate_id)
        gate.report.runtime["search"] = {"ui": {}}
        gate.report.add_evidence_file = Mock(return_value={"path": "controlled"})
        gate.evidence_dir = None
        gate.step = lambda _name, action, *_args: action()
        gate.record_geometry = Mock()
        gate.save_screenshot = Mock()
        gate.save_dom = Mock()
        session = Mock()
        gate.clients = {"alice": session}
        gate.surface = Mock(side_effect=[
            {"painted": True, "loading": False, "busy": False, "query": "",
             "searchOpen": False, "domRevision": revision}
            for revision in (0, 2, 2, 2)
        ])
        session.execute_async_script.return_value = failure != "paint-timeout"
        if failure == "screenshot-failure":
            session.save_screenshot.side_effect = OSError("controlled screenshot failure")
        session.get_page_source.return_value = "controlled DOM"

        def wait(action, _label, timeout):
            assert timeout == 30
            for _attempt in range(2):
                result = action()
                if result:
                    return result
            raise AssertionError("capture retry did not reach its own stable frame")

        with patch.object(desktop, "wait_until", side_effect=wait), \
                patch.object(Path, "write_text"):
            try:
                gate.visible(failure, lambda: True)
            except (shared.GateError, OSError):
                assert failure != "mutation-retry"
                assert not gate.report.runtime["search"]["ui"]
            else:
                assert failure == "mutation-retry"
                assert session.save_screenshot.call_count == 2
                assert session.execute_async_script.call_count == 2
            assert session.execute_script.call_args.args == (desktop.CAPTURE_END_JS,)
        checks.append(failure)
    return checks


def verify_cleanup() -> list[str]:
    checks = []
    valid = {key: True for key in (
        "portsReleased", "processesReleased", "storageReleased", "logsReleased",
    )}
    valid["cleanupErrors"] = []
    for name, change in (
        *((key, {key: False}) for key in valid if key != "cleanupErrors"),
        ("cleanup-errors", {"cleanupErrors": [{"resource": "storage", "error": "controlled"}]}),
        ("missing-release", {"storageReleased": None}),
        ("failed-release-assertion", {}),
        ("capability-close", {}),
        ("cleanup-raises", {}),
    ):
        gate = object.__new__(SocialContentSearchDesktopGate)
        gate.report = new_report(gate.gate_id)
        gate._drivers = []
        ledger = Mock()
        gate.cleanup_clients = Mock(return_value={**valid, **change})
        if name == "cleanup-raises":
            gate.cleanup_clients.side_effect = OSError("controlled cleanup failure")
        gate.capability_client = Mock() if name == "capability-close" else None
        if gate.capability_client is not None:
            gate.capability_client.close.side_effect = OSError("controlled close failure")
        if name == "failed-release-assertion":
            gate.report.add_assertion("resources_released", False, "controlled failure")
        gate.run = lambda: gate.finish_cleanup(ledger, None)
        with patch.object(type(gate.report), "write", return_value=None), \
                patch.object(gate, "_print_fail"):
            assert AcceptanceGate.execute(gate) == 1
        report = gate.report.to_dict()
        assert (report["status"], report["completionStatus"], report["proofStatus"]) == (
            "FAIL", "PARTIAL", "UNPROVEN",
        ), name
        ledger.record.assert_not_called()
        primary = RuntimeError("original journey failure")
        gate.finish_cleanup(ledger, primary)
        assert "cleanup also failed" in primary.__notes__[-1]
        ledger.record.assert_not_called()
        checks.append(name)
    gate = object.__new__(SocialContentSearchDesktopGate)
    gate.report = new_report(gate.gate_id)
    gate.capability_client = None
    gate.cleanup_clients = Mock(return_value=valid)
    ledger = Mock()
    gate.finish_cleanup(ledger, None)
    ledger.record.assert_called_once_with(shared.SuiteRuntimeAction.CLEANUP_COMPLETE)
    checks.append("successful-cleanup-control")
    return checks


def verify_selectors() -> list[str]:
    gate = shared.MobileDeviceSearchGate()
    session = Mock(client_id="sim-ios")
    requests = []

    def page(action, payload):
        assert action == "search.page"
        requests.append(payload.copy())
        if payload.get("cursor"):
            return {"accepted": True, "value": {
                "items": [{"resource": {"id": "page-two"}}], "nextCursor": "control-tail",
            }}
        cursor = "control-issued" if len(requests) == 1 else "handoff-unconsumed"
        return {"accepted": True, "value": {
            "items": [{"resource": {"id": "page-one"}}], "nextCursor": cursor,
        }}

    session.call_action.side_effect = page
    denial_request, evidence = gate.account_cursor_request(session, "history token")
    assert len(requests) == 3 and all(request["kinds"] == [3] for request in requests)
    selectors = {key: value for key, value in requests[0].items() if key != "cursor"}
    assert all({key: value for key, value in request.items() if key != "cursor"} == selectors
               for request in requests)
    assert {key: value for key, value in denial_request.items() if key != "cursor"} == selectors
    assert requests[1]["cursor"] == "control-issued"
    assert denial_request["cursor"] == "handoff-unconsumed"
    assert denial_request["cursor"] != requests[1]["cursor"]
    assert evidence["sameAccountContinuation"]["items"]
    checks = ["identical-selectors", "same-account-control", "separate-unconsumed-cursor"]
    for failure in ("selector-mismatch", "same-account-denial", "reused-consumed-cursor"):
        session.call_action.reset_mock()

        def broken(action, payload):
            if failure == "same-account-denial" and payload.get("cursor"):
                return {"accepted": False, "errorCode": "SEARCH_CURSOR_EXPIRED"}
            result = page(action, payload)
            if failure == "reused-consumed-cursor" and not payload.get("cursor"):
                result["value"]["nextCursor"] = "reused"
            if failure == "selector-mismatch":
                payload["kinds"] = []
                return {"accepted": False, "errorCode": "SEARCH_CURSOR_EXPIRED"}
            return result

        session.call_action.side_effect = broken
        try:
            gate.account_cursor_request(session, "history token")
        except shared.GateError:
            checks.append(failure)
        else:
            raise AssertionError(f"{failure} became account proof")
    return checks


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
                    "threadVisible": True, "postVisible": True,
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
    # Keep the existing contract Gate's 13 case IDs while expanding the
    # assertions within those cases. Detailed replay results are independently callable.
    assert len(verify_visibility()) == 43
    assert len(verify_cleanup()) == 10
    assert len(verify_selectors()) == 6
    assert len(verify_original_surfaces()) == 47
    assert len(verify_continuity()) == 14
    assert len(verify_continuity_script()) == 7
    assert len(verify_return()) == 11
    assert len(verify_desktop_capture()) == 3
    for platform in ("ios", "android"):
        for hidden in ("opacity", "covered"):
            gate, session, sampling, artifacts, saved = fixture(SocialContentSearchMobileGate, platform)
            observed = gate.surface(session)
            observed["originalSocial"]["anchorVisible"] = False
            gate.surface = Mock(return_value=observed)
            with patch.object(shared.time, "monotonic", side_effect=[0, 31]):
                try:
                    gate.capture(artifacts, session, hidden)
                except shared.GateError:
                    pass
                else:
                    raise AssertionError(f"{platform}/{hidden} accepted an invisible target")
            session.screenshot_bytes.assert_not_called()
            assert not saved and not sampling["watching"]
    return checks
