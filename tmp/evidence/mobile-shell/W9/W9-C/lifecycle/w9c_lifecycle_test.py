#!/usr/bin/env python3
"""W9-C Lifecycle automated acceptance test.

Tests:
  1. Email login → Shell transition
  2. Tab navigation (all 4 tabs)
  3. Session restore (kill + relaunch)
  4. Background → resume (home + reactivate)
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
EVIDENCE_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)))

DEVICE_UDID = "FE067914-701D-45E9-AD5F-74B3BD1117D7"
DEVICE_NAME = "iPhone 15 Pro"
BUNDLE_ID = "com.peers.touch.mobile"


def appium_request(method, path, body=None):
    url = f"{APPIUM_URL}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"value": {"error": e.read().decode()[:200]}}
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
                "appium:wdaStartupRetries": 3,
                "appium:wdaStartupRetryInterval": 20000,
                "appium:webviewConnectTimeout": 30000,
            }
        }
    }
    result = appium_request("POST", "/session", caps)
    sid = result.get("value", {}).get("sessionId")
    if not sid:
        print(f"FAIL: Could not create session: {result}")
        sys.exit(1)
    print(f"  Session: {sid}")
    return sid


def screenshot(sid, name):
    result = appium_request("GET", f"/session/{sid}/screenshot")
    b64 = result.get("value", "")
    if b64 and not isinstance(b64, dict):
        path = os.path.join(EVIDENCE_DIR, f"{name}.png")
        with open(path, "wb") as f:
            f.write(base64.b64decode(b64))
        print(f"  📸 {name}.png")
        return path
    return None


def find_el(sid, strategy, selector, timeout=8):
    end = time.time() + timeout
    while time.time() < end:
        result = appium_request("POST", f"/session/{sid}/element", {
            "using": strategy, "value": selector
        })
        val = result.get("value", {})
        el_id = val.get("element-6066-11e4-a52e-4f735466cecf") or val.get("ELEMENT")
        if el_id:
            return el_id
        time.sleep(0.8)
    return None


def find_els(sid, strategy, selector):
    result = appium_request("POST", f"/session/{sid}/elements", {
        "using": strategy, "value": selector
    })
    ids = []
    for v in result.get("value", []):
        el_id = v.get("element-6066-11e4-a52e-4f735466cecf") or v.get("ELEMENT")
        if el_id:
            ids.append(el_id)
    return ids


def click(sid, el_id):
    appium_request("POST", f"/session/{sid}/element/{el_id}/click")


def send_keys(sid, el_id, text):
    appium_request("POST", f"/session/{sid}/element/{el_id}/value", {"text": text})


def get_text(sid, el_id):
    return appium_request("GET", f"/session/{sid}/element/{el_id}/text").get("value", "")


def get_attr(sid, el_id, attr):
    return appium_request("GET", f"/session/{sid}/element/{el_id}/attribute/{attr}").get("value", "")


def switch_webview(sid):
    ctxs = appium_request("GET", f"/session/{sid}/contexts").get("value", [])
    for ctx in ctxs:
        if "WEBVIEW" in str(ctx):
            appium_request("POST", f"/session/{sid}/context", {"name": ctx})
            return True
    return False


def switch_native(sid):
    appium_request("POST", f"/session/{sid}/context", {"name": "NATIVE_APP"})


def get_page_text(sid):
    src = appium_request("GET", f"/session/{sid}/source")
    return str(src.get("value", "")).lower()


def find_button_by_text(sid, text, timeout=8):
    end = time.time() + timeout
    while time.time() < end:
        buttons = find_els(sid, "css selector", "button")
        for btn_id in buttons:
            btn_text = get_text(sid, btn_id)
            if text.lower() in btn_text.lower():
                return btn_id
        time.sleep(0.8)
    return None


results = {}


def record(name, passed, detail=""):
    results[name] = {"passed": passed, "detail": detail}
    s = "PASS" if passed else "FAIL"
    print(f"\n  [{s}] {name}: {detail}\n")


# ═══════════════════════════════════════════════════════════════
# TEST 1: Email Login → Shell
# ═══════════════════════════════════════════════════════════════

def test_email_login(sid):
    print("\n--- TEST 1: Email Login → Shell ---")

    if not switch_webview(sid):
        record("email_login", False, "No webview")
        return False

    time.sleep(2)
    screenshot(sid, "T1_01_start")

    page = get_page_text(sid)

    # If we're already in shell, skip login
    if "moments" in page and "contacts" in page:
        record("email_login", True, "Already in Shell (session persisted)")
        screenshot(sid, "T1_10_already_shell")
        return True

    # If on launch screen, click Continue
    continue_btn = find_button_by_text(sid, "Continue", timeout=5)
    if not continue_btn:
        continue_btn = find_button_by_text(sid, "继续", timeout=3)

    if continue_btn:
        click(sid, continue_btn)
        time.sleep(3)
        screenshot(sid, "T1_02_after_continue")
        print("  Clicked Continue")

    # Check if we landed on auth gate
    time.sleep(2)
    page = get_page_text(sid)

    if "moments" in page and "contacts" in page:
        record("email_login", True, "Went directly to Shell (no auth needed)")
        screenshot(sid, "T1_10_shell")
        return True

    # Look for email input
    email_input = find_el(sid, "css selector", "input[type='email']", timeout=5)
    if not email_input:
        email_input = find_el(sid, "css selector", "input[type='text']", timeout=3)

    if not email_input:
        screenshot(sid, "T1_03_no_email")
        # Maybe we need to look for the login form more carefully
        inputs = find_els(sid, "css selector", "input")
        print(f"  Found {len(inputs)} inputs total")
        if len(inputs) >= 2:
            email_input = inputs[0]
        else:
            record("email_login", False, "No email input found")
            return False

    # Clear and type email
    click(sid, email_input)
    time.sleep(0.3)
    send_keys(sid, email_input, TEST_EMAIL)
    time.sleep(0.5)

    # Find password input
    password_input = find_el(sid, "css selector", "input[type='password']", timeout=5)
    if not password_input:
        inputs = find_els(sid, "css selector", "input")
        if len(inputs) >= 2:
            password_input = inputs[1]

    if not password_input:
        screenshot(sid, "T1_04_no_password")
        record("email_login", False, "No password input found")
        return False

    click(sid, password_input)
    time.sleep(0.3)
    send_keys(sid, password_input, TEST_PASSWORD)
    time.sleep(0.5)
    screenshot(sid, "T1_05_creds_filled")

    # Find and click login button
    login_btn = find_button_by_text(sid, "Log", timeout=5)
    if not login_btn:
        login_btn = find_button_by_text(sid, "登", timeout=3)
    if not login_btn:
        login_btn = find_el(sid, "css selector", "button[type='submit']", timeout=3)

    if not login_btn:
        screenshot(sid, "T1_06_no_login_btn")
        record("email_login", False, "No login button")
        return False

    click(sid, login_btn)
    print("  Clicked login, waiting...")
    time.sleep(6)
    screenshot(sid, "T1_07_after_login")

    # Check if we reached Shell
    page = get_page_text(sid)
    if "chat" in page and ("contacts" in page or "moment" in page):
        record("email_login", True, "Login → Shell succeeded")
        screenshot(sid, "T1_10_shell")
        return True

    # Maybe error
    if "not found" in page or "error" in page or "failed" in page:
        record("email_login", False, "Login error on page")
        return False

    # Wait more
    time.sleep(5)
    page = get_page_text(sid)
    if "chat" in page and ("contacts" in page or "moment" in page):
        record("email_login", True, "Login → Shell succeeded (delayed)")
        screenshot(sid, "T1_10_shell")
        return True

    record("email_login", False, f"Did not reach Shell")
    return False


# ═══════════════════════════════════════════════════════════════
# TEST 2: Tab Navigation
# ═══════════════════════════════════════════════════════════════

def test_tab_navigation(sid):
    print("\n--- TEST 2: Tab Navigation ---")

    tab_labels = ["Chat", "Contacts", "Moments", "Me"]
    tab_cn = ["消息", "联系人", "动态", "我"]
    tabs_passed = 0

    # Find tab items by looking at the bottom bar
    tab_items = find_els(sid, "css selector", "[class*='tab-item'], [class*='tabbar-item']")
    print(f"  Found {len(tab_items)} tab items")

    if len(tab_items) < 4:
        # Try broader: all divs/spans in the tab bar
        tab_items = find_els(sid, "css selector", ".mobile-tabbar > div, [class*='tab-bar'] > div")
        print(f"  Broader search: {len(tab_items)} items")

    if len(tab_items) >= 4:
        for i, tab_id in enumerate(tab_items[:4]):
            label = tab_labels[i] if i < len(tab_labels) else f"Tab{i+1}"
            click(sid, tab_id)
            time.sleep(1.5)
            screenshot(sid, f"T2_{i+1:02d}_{label}")
            tabs_passed += 1
            print(f"  Tab {label}: clicked")
    else:
        # Try clicking by text
        for i, (en, cn) in enumerate(zip(tab_labels, tab_cn)):
            btn = find_button_by_text(sid, en, timeout=3)
            if not btn:
                # Try finding span/div with text
                els = find_els(sid, "xpath", f"//*[contains(text(), '{en}') or contains(text(), '{cn}')]")
                if els:
                    btn = els[0]
            if btn:
                click(sid, btn)
                time.sleep(1.5)
                screenshot(sid, f"T2_{i+1:02d}_{en}")
                tabs_passed += 1
                print(f"  Tab {en}: clicked")
            else:
                print(f"  Tab {en}: NOT FOUND")

    record("tab_navigation", tabs_passed >= 4, f"{tabs_passed}/4 tabs navigated")
    return tabs_passed >= 4


# ═══════════════════════════════════════════════════════════════
# TEST 3: Session Restore
# ═══════════════════════════════════════════════════════════════

def test_session_restore(sid):
    print("\n--- TEST 3: Session Restore ---")

    screenshot(sid, "T3_01_before_kill")

    switch_native(sid)
    print("  Terminating app...")
    appium_request("POST", f"/session/{sid}/appium/device/terminate_app", {"bundleId": BUNDLE_ID})
    time.sleep(3)

    print("  Relaunching...")
    appium_request("POST", f"/session/{sid}/appium/device/activate_app", {"bundleId": BUNDLE_ID})
    time.sleep(5)

    if not switch_webview(sid):
        record("session_restore", False, "No webview after relaunch")
        return False

    time.sleep(3)
    screenshot(sid, "T3_02_after_relaunch")

    page = get_page_text(sid)
    if "chat" in page and ("contacts" in page or "moment" in page):
        record("session_restore", True, "Session restored — Shell visible")
        return True
    elif "login" in page or "password" in page or "登录" in page:
        record("session_restore", False, "Session NOT restored — auth screen shown")
        return False
    elif "station" in page and "continue" in page:
        record("session_restore", False, "Session NOT restored — launch screen")
        return False
    else:
        # Could be loading
        time.sleep(5)
        page = get_page_text(sid)
        if "chat" in page:
            record("session_restore", True, "Session restored (delayed)")
            return True
        record("session_restore", False, f"Unexpected state after relaunch")
        return False


# ═══════════════════════════════════════════════════════════════
# TEST 4: Background → Resume
# ═══════════════════════════════════════════════════════════════

def test_background_resume(sid):
    print("\n--- TEST 4: Background → Resume ---")

    screenshot(sid, "T4_01_before_bg")
    switch_native(sid)

    print("  Pressing home...")
    appium_request("POST", f"/session/{sid}/appium/device/press_button", {"name": "home"})
    time.sleep(3)

    print("  Reactivating...")
    appium_request("POST", f"/session/{sid}/appium/device/activate_app", {"bundleId": BUNDLE_ID})
    time.sleep(3)

    if not switch_webview(sid):
        record("background_resume", False, "No webview after resume")
        return False

    time.sleep(2)
    screenshot(sid, "T4_02_after_resume")

    page = get_page_text(sid)
    if "chat" in page or "contacts" in page or "moment" in page:
        record("background_resume", True, "App resumed to Shell")
        return True
    else:
        record("background_resume", False, "App did not resume to Shell")
        return False


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

def main():
    print("=" * 60)
    print("W9-C LIFECYCLE ACCEPTANCE TEST")
    print(f"Station: {STATION_URL} | Account: {TEST_EMAIL}")
    print(f"Device:  {DEVICE_NAME}")
    print("=" * 60)

    sid = create_session()

    try:
        login_ok = test_email_login(sid)

        if login_ok:
            test_tab_navigation(sid)
            test_session_restore(sid)

            # Re-login if session restore failed
            if not results.get("session_restore", {}).get("passed"):
                print("  Re-doing login for background test...")
                switch_webview(sid)
                page = get_page_text(sid)
                if "continue" in page:
                    btn = find_button_by_text(sid, "Continue", timeout=3)
                    if btn:
                        click(sid, btn)
                        time.sleep(3)
                if "login" in page or "password" in page:
                    # Quick re-login
                    email_input = find_el(sid, "css selector", "input[type='email'], input[type='text']", timeout=5)
                    if email_input:
                        send_keys(sid, email_input, TEST_EMAIL)
                        pwd = find_el(sid, "css selector", "input[type='password']", timeout=3)
                        if pwd:
                            send_keys(sid, pwd, TEST_PASSWORD)
                            login_btn = find_button_by_text(sid, "Log", timeout=3)
                            if login_btn:
                                click(sid, login_btn)
                                time.sleep(5)

            test_background_resume(sid)
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

        with open(os.path.join(EVIDENCE_DIR, "w9c_lifecycle_report.json"), "w") as f:
            json.dump({
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "station": STATION_URL, "account": TEST_EMAIL,
                "device": DEVICE_NAME, "results": results,
                "summary": f"{passed}/{total}"
            }, f, indent=2)

        appium_request("DELETE", f"/session/{sid}")


if __name__ == "__main__":
    main()
