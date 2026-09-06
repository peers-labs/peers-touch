"""W9-C render loop fix verification.
After fixing ChatPage useEffect peerProfiles dependency,
verify login → Shell transition completes without render loop.
"""
import json, time, urllib.request, sys, os

APPIUM = "http://127.0.0.1:4723"
STATION = "10.37.246.80:18080"
EMAIL = "mobiletest@test.com"
PASSWORD = "Test@1234"
EVIDENCE = os.path.dirname(os.path.abspath(__file__))

def req(method, path, body=None):
    data = json.dumps(body).encode() if body else None
    r = urllib.request.urlopen(urllib.request.Request(
        f"{APPIUM}{path}", data=data,
        headers={"Content-Type": "application/json"} if data else {},
        method=method
    ), timeout=30)
    return json.loads(r.read())

def create_session():
    caps = {
        "capabilities": {"alwaysMatch": {
            "platformName": "iOS",
            "appium:automationName": "XCUITest",
            "appium:udid": "FE067914-701D-45E9-AD5F-74B3BD1117D7",
            "appium:bundleId": "com.nicepeersx.app.nicePeers",
            "appium:noReset": True,
            "appium:webviewConnectTimeout": 10000,
            "appium:includeSafariInWebviews": False,
        }}
    }
    resp = req("POST", "/session", caps)
    return resp["value"]["sessionId"]

def screenshot(sid, name):
    resp = req("GET", f"/session/{sid}/screenshot")
    import base64
    path = os.path.join(EVIDENCE, f"RENDERLOOP_{name}.png")
    with open(path, "wb") as f:
        f.write(base64.b64decode(resp["value"]))
    print(f"  screenshot: {name}")
    return path

def switch_webview(sid):
    ctxs = req("GET", f"/session/{sid}/contexts")["value"]
    wv = [c for c in ctxs if c.startswith("WEBVIEW")]
    if not wv:
        print(f"  no WEBVIEW contexts: {ctxs}")
        return False
    req("POST", f"/session/{sid}/context", {"name": wv[0]})
    print(f"  switched to {wv[0]}")
    return True

def js(sid, script):
    try:
        return req("POST", f"/session/{sid}/execute/sync",
                    {"script": script, "args": []})["value"]
    except Exception as e:
        if "Method is not implemented" in str(e):
            switch_webview(sid)
            return req("POST", f"/session/{sid}/execute/sync",
                        {"script": script, "args": []})["value"]
        raise

def set_input(sid, input_type, value):
    js(sid, f"""
        var inp = document.querySelector('input[type="{input_type}"]');
        if (!inp) return 'not_found';
        inp.focus();
        inp.value = '';
        document.execCommand('insertText', false, '{value}');
        return inp.value;
    """)

def main():
    print("=== W9-C Render Loop Fix Verification ===")

    sid = create_session()
    print(f"session: {sid}")

    # First terminate and relaunch to get fresh state with HMR code
    print("\n1. Terminate + relaunch app for fresh HMR code...")
    try:
        req("POST", f"/session/{sid}/appium/device/terminate_app",
            {"bundleId": "com.nicepeersx.app.nicePeers"})
    except:
        pass
    time.sleep(1)
    req("POST", f"/session/{sid}/appium/device/activate_app",
        {"bundleId": "com.nicepeersx.app.nicePeers"})
    time.sleep(3)

    # Switch to webview
    print("\n2. Switch to WEBVIEW context...")
    for attempt in range(5):
        if switch_webview(sid):
            break
        time.sleep(2)
    else:
        print("FAIL: could not find WEBVIEW")
        screenshot(sid, "01_no_webview")
        req("DELETE", f"/session/{sid}")
        return 1

    screenshot(sid, "01_app_state")

    # Check current state
    print("\n3. Check current app state...")
    state = js(sid, """
        var shell = document.querySelector('[data-testid="mobile-shell"]');
        var gate = document.querySelector('[data-testid="access-gate"]');
        var launch = document.querySelector('[data-testid="station-launch"]');
        var err = document.querySelector('.root-error-boundary');
        var errText = err ? err.innerText.substring(0, 200) : '';
        return JSON.stringify({
            shell: !!shell,
            gate: !!gate,
            launch: !!launch,
            error: !!err,
            errorText: errText,
            url: location.href,
            title: document.title
        });
    """)
    print(f"  state: {state}")
    state_obj = json.loads(state) if isinstance(state, str) else state

    # If we're already in shell with no error — render loop is fixed!
    if state_obj.get("shell") and not state_obj.get("error"):
        print("\n✅ SUCCESS: Shell rendered without render loop!")
        screenshot(sid, "02_shell_ok")
        req("DELETE", f"/session/{sid}")
        return 0

    # If there's an error, the render loop might still be there
    if state_obj.get("error"):
        print(f"\n  Error detected: {state_obj.get('errorText', '')[:100]}")
        screenshot(sid, "02_error")

    # If on launch screen, need full login flow
    if state_obj.get("launch") or state_obj.get("gate") or state_obj.get("error"):
        print("\n4. Need to do login flow...")

        # Navigate to launch screen if needed
        if state_obj.get("error"):
            # Try reloading to clear the error boundary
            js(sid, "location.reload()")
            time.sleep(4)
            for attempt in range(5):
                if switch_webview(sid):
                    break
                time.sleep(2)
            screenshot(sid, "03_after_reload")

        # Check state again
        state2 = js(sid, """
            var launch = document.querySelector('[data-testid="station-launch"]');
            var gate = document.querySelector('[data-testid="access-gate"]');
            var shell = document.querySelector('[data-testid="mobile-shell"]');
            var err = document.querySelector('.root-error-boundary');
            return JSON.stringify({launch: !!launch, gate: !!gate, shell: !!shell, error: !!err});
        """)
        print(f"  state after reload: {state2}")
        state2_obj = json.loads(state2) if isinstance(state2, str) else state2

        if state2_obj.get("shell") and not state2_obj.get("error"):
            print("\n✅ SUCCESS: Shell rendered after reload!")
            screenshot(sid, "04_shell_ok")
            req("DELETE", f"/session/{sid}")
            return 0

        # If on launch screen, add station and login
        if state2_obj.get("launch"):
            print("  On launch screen, adding station...")
            # Check if station already exists
            has_station = js(sid, """
                var items = document.querySelectorAll('[data-testid="station-entry"]');
                return items.length;
            """)
            if not has_station or has_station == 0:
                # Toggle to HTTP
                js(sid, """
                    var toggle = document.querySelector('[data-testid="protocol-toggle"]');
                    if (toggle) toggle.click();
                """)
                time.sleep(0.5)
                # Enter station address
                set_input(sid, "text", STATION)
                time.sleep(0.3)
                # Click add button
                js(sid, """
                    var btn = document.querySelector('button[aria-label*="Add"]');
                    if (btn) btn.click();
                """)
                time.sleep(3)

            # Click Continue
            js(sid, """
                var btns = document.querySelectorAll('button');
                for (var b of btns) {
                    if (b.textContent.includes('Continue')) { b.click(); break; }
                }
            """)
            time.sleep(3)
            screenshot(sid, "04_after_continue")

        # Now should be on access gate — switch to Email Login tab
        print("  Switching to Email Login tab...")
        js(sid, """
            var tabs = document.querySelectorAll('[role="tab"]');
            for (var t of tabs) {
                if (t.textContent.includes('Email')) { t.click(); break; }
            }
        """)
        time.sleep(1)

        # Fill credentials
        print("  Filling credentials...")
        set_input(sid, "text", EMAIL)
        time.sleep(0.3)
        set_input(sid, "password", PASSWORD)
        time.sleep(0.3)
        screenshot(sid, "05_credentials")

        # Click Sign In
        print("  Clicking Sign In...")
        js(sid, """
            var btns = document.querySelectorAll('button');
            for (var b of btns) {
                if (b.textContent.includes('Sign In')) { b.click(); break; }
            }
        """)

        # Wait for shell transition (up to 15s)
        print("  Waiting for Shell transition...")
        for i in range(15):
            time.sleep(1)
            check = js(sid, """
                var shell = document.querySelector('[data-testid="mobile-shell"]');
                var err = document.querySelector('.root-error-boundary');
                var errText = err ? err.innerText.substring(0, 300) : '';
                return JSON.stringify({shell: !!shell, error: !!err, errorText: errText});
            """)
            check_obj = json.loads(check) if isinstance(check, str) else check
            if check_obj.get("shell") and not check_obj.get("error"):
                print(f"\n✅ SUCCESS: Shell rendered at t+{i+1}s — render loop FIXED!")
                screenshot(sid, "06_shell_success")
                req("DELETE", f"/session/{sid}")
                return 0
            if check_obj.get("error"):
                print(f"  t+{i+1}s: error detected — {check_obj.get('errorText', '')[:80]}")
                if "Maximum update depth" in check_obj.get("errorText", ""):
                    print("\n❌ FAIL: Render loop still present!")
                    screenshot(sid, "06_renderloop_still")
                    req("DELETE", f"/session/{sid}")
                    return 1
            sys.stdout.write(f"  t+{i+1}s... ")
            sys.stdout.flush()

        screenshot(sid, "06_timeout")
        print("\n⚠️  Timeout waiting for Shell")

    req("DELETE", f"/session/{sid}")
    return 1

if __name__ == "__main__":
    sys.exit(main())
