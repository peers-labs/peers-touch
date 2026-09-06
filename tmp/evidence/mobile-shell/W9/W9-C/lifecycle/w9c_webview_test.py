#!/usr/bin/env python3
"""W9-C Lifecycle acceptance test — WEBVIEW + JS execution path.

Uses JS execution in WEBVIEW context to drive the full flow,
avoiding the React controlled input + native keyboard incompatibility.
"""

import base64
import json
import os
import sys
import time
import urllib.request
import urllib.error

APPIUM_URL = "http://127.0.0.1:4723"
STATION_URL = "http://10.37.246.80:18080"
TEST_EMAIL = "mobiletest@test.com"
TEST_PASSWORD = "Test@1234"
EVIDENCE_DIR = os.path.dirname(os.path.abspath(__file__))

DEVICE_UDID = "FE067914-701D-45E9-AD5F-74B3BD1117D7"
DEVICE_NAME = "iPhone 15 Pro"
BUNDLE_ID = "com.peers.touch.mobile"

results = {}


def appium(method, path, body=None):
    url = f"{APPIUM_URL}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"value": {"error": e.read().decode()[:500]}}
    except Exception as e:
        return {"value": {"error": str(e)}}


def create_session():
    caps = {
        "capabilities": {
            "alwaysMatch": {
                "platformName": "iOS",
                "appium:automationName": "XCUITest",
                "appium:deviceName": DEVICE_NAME,
                "appium:udid": DEVICE_UDID,
                "appium:bundleId": BUNDLE_ID,
                "appium:noReset": True,
                "appium:newCommandTimeout": 120,
                "appium:webviewConnectTimeout": 30000,
            }
        }
    }
    result = appium("POST", "/session", caps)
    sid = result.get("value", {}).get("sessionId")
    if not sid:
        print(f"FAIL: Could not create session: {result}")
        sys.exit(1)
    return sid


def screenshot(sid, name):
    result = appium("GET", f"/session/{sid}/screenshot")
    b64 = result.get("value", "")
    if b64 and not isinstance(b64, dict):
        path = os.path.join(EVIDENCE_DIR, f"{name}.png")
        with open(path, "wb") as f:
            f.write(base64.b64decode(b64))
        print(f"    📸 {name}.png")
        return path
    return None


def switch_webview(sid):
    ctxs = appium("GET", f"/session/{sid}/contexts").get("value", [])
    for ctx in ctxs:
        if "WEBVIEW" in str(ctx):
            appium("POST", f"/session/{sid}/context", {"name": ctx})
            return ctx
    return None


def switch_native(sid):
    appium("POST", f"/session/{sid}/context", {"name": "NATIVE_APP"})


def js(sid, script):
    result = appium("POST", f"/session/{sid}/execute/sync", {
        "script": script, "args": []
    })
    val = result.get("value")
    if isinstance(val, dict) and "error" in val:
        if "not implemented" in str(val.get("error", "")).lower() or \
           "not implemented" in str(val.get("message", "")).lower():
            wv = switch_webview(sid)
            if wv:
                result = appium("POST", f"/session/{sid}/execute/sync", {
                    "script": script, "args": []
                })
                return result.get("value")
        return val
    return val


def visible_text(sid):
    result = js(sid, 'return document.querySelector("#root")?.innerText || ""')
    return result if isinstance(result, str) else ""


def buttons(sid):
    result = js(sid, 'return Array.from(document.querySelectorAll("button")).map(b => b.textContent.trim())')
    return result if isinstance(result, list) else []


def click_button(sid, text):
    return js(sid, f'''
        const btn = Array.from(document.querySelectorAll("button"))
            .find(b => b.textContent.trim().includes("{text}"));
        if (btn) {{ btn.click(); return true; }}
        return false;
    ''')


def set_input_by_type(sid, input_type, value):
    escaped_value = value.replace("\\", "\\\\").replace("'", "\\'")
    script = (
        "var inputs = document.querySelectorAll('input');"
        "var target = null;"
        "for (var i = 0; i < inputs.length; i++) {"
        "  if (inputs[i].type === '" + input_type + "') { target = inputs[i]; break; }"
        "}"
        "if (!target) return 'not_found';"
        "target.focus();"
        "target.select();"
        "document.execCommand('selectAll');"
        "document.execCommand('insertText', false, '" + escaped_value + "');"
        "return target.value;"
    )
    result = js(sid, script)
    if isinstance(result, dict):
        return "error"
    return result


def record(name, passed, detail=""):
    results[name] = {"passed": passed, "detail": detail}
    s = "PASS" if passed else "FAIL"
    print(f"\n  [{s}] {name}: {detail}\n")


def wait_for(sid, condition_fn, timeout=15, interval=1):
    end = time.time() + timeout
    while time.time() < end:
        if condition_fn():
            return True
        time.sleep(interval)
    return False


# ═══════════════════════════════════════════════════════════════
# TEST 1: Full Login Flow (Launch → Auth Gate → Shell)
# ═══════════════════════════════════════════════════════════════

def test_full_login(sid):
    print("\n--- TEST 1: Full Login Flow ---")

    text = visible_text(sid)
    btns = buttons(sid)
    print(f"  Page buttons: {btns}")

    # If already in Shell
    if "Chat" in text and "Contacts" in text and "Moments" in text and "Me" in text:
        is_shell = js(sid, 'return !!document.querySelector(".mobile-tabbar, [class*=tab-bar]")')
        if is_shell:
            record("full_login", True, "Already in Shell (session persisted)")
            screenshot(sid, "T1_00_already_shell")
            return True

    # If no Station configured, add one
    if "No Station" in text or ("Add Station" in btns and "Continue" not in text.split("\n")):
        print("  No Station configured, adding test Station")
        # Toggle protocol to HTTP (defaults to HTTPS)
        protocol_text = js(sid, 'var el = document.querySelector(".station-protocol-select"); return el ? el.textContent.trim() : ""')
        if protocol_text == "HTTPS":
            js(sid, 'document.querySelector(".station-protocol-select").click()')
            time.sleep(0.5)
            print("  Toggled to HTTP")
        # Fill address input
        set_input_by_type(sid, "text", "10.37.246.80:18080")
        time.sleep(0.5)
        screenshot(sid, "T1_01a_station_address")
        # Click the + (add) button next to address input
        js(sid, '''
            var addBtn = document.querySelector('.station-address-row + button, button[aria-label*="Add Station"], button[aria-label*="add station"]');
            if (!addBtn) {
                var btns = document.querySelectorAll('button');
                for (var i = 0; i < btns.length; i++) {
                    if (btns[i].querySelector('svg') && btns[i].closest('.station-input-row, .station-add-row')) {
                        addBtn = btns[i];
                        break;
                    }
                }
            }
            if (addBtn) addBtn.click();
        ''')
        time.sleep(4)
        text = visible_text(sid)
        btns = buttons(sid)
        print(f"  After add station: {btns}")
        screenshot(sid, "T1_01b_station_added")

    # Step 1: Click Continue on launch screen
    if "Continue" in btns:
        screenshot(sid, "T1_01_launch")
        click_button(sid, "Continue")
        time.sleep(3)
        screenshot(sid, "T1_02_after_continue")
        print("  Clicked Continue")

    # Step 2: Should be on Auth Gate now — if error from previous attempt, go back and get fresh attempt
    text = visible_text(sid)
    btns = buttons(sid)
    print(f"  Auth gate buttons: {btns}")

    if "error" in text.lower() or "invalid" in text.lower() or "could not" in text.lower() or "failed" in text.lower():
        print("  Previous error detected, navigating back for fresh attempt")
        if "Change Station" in btns:
            click_button(sid, "Change Station")
            time.sleep(2)
        elif "Start again" in btns:
            click_button(sid, "Start again")
            time.sleep(2)
        text = visible_text(sid)
        btns = buttons(sid)
        print(f"  After back: {btns}")
        if "Continue" in btns:
            click_button(sid, "Continue")
            time.sleep(3)
            text = visible_text(sid)
            btns = buttons(sid)
            print(f"  Fresh auth gate buttons: {btns}")

    screenshot(sid, "T1_03_auth_gate")

    # Step 3: Click Email Login tab
    if "Email Login" in btns:
        click_button(sid, "Email Login")
        time.sleep(1)
        screenshot(sid, "T1_04_email_tab")
        print("  Switched to Email Login tab")
    elif "邮箱登录" in btns:
        click_button(sid, "邮箱登录")
        time.sleep(1)
        print("  Switched to Email Login tab (zh)")

    # Step 4: Fill credentials via JS (execCommand simulates real typing)
    email_result = set_input_by_type(sid, "email", TEST_EMAIL)
    if email_result == "not_found":
        email_result = set_input_by_type(sid, "text", TEST_EMAIL)
    time.sleep(0.3)
    pwd_result = set_input_by_type(sid, "password", TEST_PASSWORD)
    time.sleep(0.3)
    print(f"  Email result: {email_result}, Password result: {pwd_result}")
    screenshot(sid, "T1_05_creds_filled")

    email_ok = email_result and email_result != "not_found"
    pwd_ok = pwd_result and pwd_result != "not_found" and pwd_result != ""

    if not email_ok or not pwd_ok:
        input_count = js(sid, 'return document.querySelectorAll("input").length')
        print(f"  Found {input_count} inputs on page")
        record("full_login", False, f"Could not fill credentials (email={email_result}, pwd={pwd_result})")
        return False

    # Step 5: Click Sign In
    clicked = click_button(sid, "Sign In")
    if not clicked:
        clicked = click_button(sid, "Log in")
    if not clicked:
        clicked = click_button(sid, "登录")
    print(f"  Sign In clicked: {clicked}")

    # Step 6: Wait for Shell
    time.sleep(5)
    screenshot(sid, "T1_06_after_login")

    def check_shell():
        t = visible_text(sid)
        return "Chat" in t and "Contacts" in t and "Moments" in t
    
    if wait_for(sid, check_shell, timeout=15):
        record("full_login", True, "Login → Shell succeeded")
        screenshot(sid, "T1_10_shell")
        return True

    text = visible_text(sid)
    screenshot(sid, "T1_99_final_state")

    if "error" in text.lower() or "failed" in text.lower() or "not found" in text.lower():
        record("full_login", False, f"Login error visible")
        return False

    record("full_login", False, f"Did not reach Shell. Visible: {text[:100]}")
    return False


# ═══════════════════════════════════════════════════════════════
# TEST 2: Tab Navigation
# ═══════════════════════════════════════════════════════════════

def test_tab_navigation(sid):
    print("\n--- TEST 2: Tab Navigation ---")

    tabs_passed = 0
    tab_labels = ["Chat", "Contacts", "Moments", "Me"]

    for label in tab_labels:
        clicked = js(sid, f'''
            const items = document.querySelectorAll(".mobile-tabbar .tabbar-item, [class*=tab-bar] [class*=tab-item], .mobile-tabbar > div");
            for (const item of items) {{
                if (item.textContent.trim().includes("{label}")) {{
                    item.click();
                    return true;
                }}
            }}
            return false;
        ''')
        if clicked:
            time.sleep(1.5)
            screenshot(sid, f"T2_{tabs_passed+1:02d}_{label}")
            tabs_passed += 1
            print(f"  Tab {label}: ✓")
        else:
            print(f"  Tab {label}: not found, trying broader search")
            clicked2 = js(sid, f'''
                const all = document.querySelectorAll("div, span, button");
                for (const el of all) {{
                    if (el.children.length <= 2 && el.textContent.trim() === "{label}") {{
                        el.click();
                        return true;
                    }}
                }}
                return false;
            ''')
            if clicked2:
                time.sleep(1.5)
                screenshot(sid, f"T2_{tabs_passed+1:02d}_{label}")
                tabs_passed += 1
                print(f"  Tab {label}: ✓ (broad)")
            else:
                print(f"  Tab {label}: ✗")

    record("tab_navigation", tabs_passed >= 4, f"{tabs_passed}/4 tabs navigated")
    return tabs_passed >= 4


# ═══════════════════════════════════════════════════════════════
# TEST 3: Session Restore (kill + relaunch)
# ═══════════════════════════════════════════════════════════════

def test_session_restore(sid):
    print("\n--- TEST 3: Session Restore ---")

    screenshot(sid, "T3_01_before_kill")

    switch_native(sid)
    print("  Terminating app...")
    appium("POST", f"/session/{sid}/appium/device/terminate_app", {"bundleId": BUNDLE_ID})
    time.sleep(3)

    print("  Relaunching...")
    appium("POST", f"/session/{sid}/appium/device/activate_app", {"bundleId": BUNDLE_ID})
    time.sleep(6)

    wv = switch_webview(sid)
    if not wv:
        record("session_restore", False, "No WEBVIEW after relaunch")
        return False

    time.sleep(3)
    screenshot(sid, "T3_02_after_relaunch")

    text = visible_text(sid)
    print(f"  After relaunch text: {text[:100]}")

    # Check if Shell is visible (tab bar with all tabs)
    has_tabbar = js(sid, 'return !!document.querySelector(".mobile-tabbar, [class*=tab-bar]")')
    if has_tabbar and "Chat" in text:
        record("session_restore", True, "Session restored — Shell visible with tab bar")
        return True

    # Check if we're on launch screen (session lost)
    if "Continue" in text or "Add Station" in text:
        record("session_restore", False, "Session NOT restored — launch screen shown")
        return False

    # Check if auth gate
    if "Sign In" in text or "Email Login" in text:
        record("session_restore", False, "Session NOT restored — auth gate shown")
        return False

    record("session_restore", False, f"Unexpected state: {text[:80]}")
    return False


# ═══════════════════════════════════════════════════════════════
# TEST 4: Background → Resume
# ═══════════════════════════════════════════════════════════════

def test_background_resume(sid):
    print("\n--- TEST 4: Background → Resume ---")

    screenshot(sid, "T4_01_before_bg")
    switch_native(sid)

    print("  Pressing home...")
    appium("POST", f"/session/{sid}/appium/device/press_button", {"name": "home"})
    time.sleep(3)

    print("  Reactivating...")
    appium("POST", f"/session/{sid}/appium/device/activate_app", {"bundleId": BUNDLE_ID})
    time.sleep(3)

    wv = switch_webview(sid)
    if not wv:
        record("background_resume", False, "No WEBVIEW after resume")
        return False

    time.sleep(2)
    screenshot(sid, "T4_02_after_resume")

    text = visible_text(sid)
    has_tabbar = js(sid, 'return !!document.querySelector(".mobile-tabbar, [class*=tab-bar]")')

    if has_tabbar and ("Chat" in text or "Contacts" in text):
        record("background_resume", True, "App resumed to Shell")
        return True

    record("background_resume", False, f"App did not resume to Shell: {text[:80]}")
    return False


# ═══════════════════════════════════════════════════════════════

def main():
    print("=" * 60)
    print("W9-C LIFECYCLE ACCEPTANCE TEST (WEBVIEW + JS)")
    print(f"Station: {STATION_URL} | Account: {TEST_EMAIL}")
    print(f"Device:  {DEVICE_NAME}")
    print("=" * 60)

    sid = create_session()
    print(f"  Session: {sid}")

    wv = switch_webview(sid)
    if not wv:
        print("FATAL: No WEBVIEW context available")
        sys.exit(1)
    print(f"  WEBVIEW: {wv}")

    try:
        login_ok = test_full_login(sid)

        if login_ok:
            test_tab_navigation(sid)

            # Need to re-login if session restore fails
            test_session_restore(sid)

            if results.get("session_restore", {}).get("passed"):
                test_background_resume(sid)
            else:
                record("background_resume", False, "SKIPPED (session restore failed)")
        else:
            record("tab_navigation", False, "SKIPPED (login failed)")
            record("session_restore", False, "SKIPPED (login failed)")
            record("background_resume", False, "SKIPPED (login failed)")

    finally:
        print("\n" + "=" * 60)
        print("SUMMARY")
        print("=" * 60)
        passed = sum(1 for r in results.values() if r["passed"])
        total = len(results)
        for name, r in results.items():
            s = "PASS" if r["passed"] else "FAIL"
            print(f"  [{s}] {name}: {r['detail']}")
        print(f"\n  Result: {passed}/{total} passed")

        report = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "station": STATION_URL, "account": TEST_EMAIL,
            "device": DEVICE_NAME, "webview_mode": "dev-url",
            "results": results,
            "summary": f"{passed}/{total}"
        }
        with open(os.path.join(EVIDENCE_DIR, "w9c_webview_report.json"), "w") as f:
            json.dump(report, f, indent=2)

        appium("DELETE", f"/session/{sid}")


if __name__ == "__main__":
    main()
