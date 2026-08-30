package tests

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

var stationURL string

func TestMain(m *testing.M) {
	stationURL = os.Getenv("PT_STATION_URL")
	if stationURL == "" {
		stationURL = "http://127.0.0.1:18080"
	}
	stationURL = strings.TrimRight(stationURL, "/")
	os.Exit(m.Run())
}

type testClient struct {
	t       *testing.T
	token   string
	actorID string
	email   string
}

func setupTestActor(t *testing.T, name, email, password string) *testClient {
	t.Helper()

	signupBody := map[string]string{
		"name":     name,
		"email":    email,
		"password": password,
	}
	resp := httpPost(t, "/actor/sign-up", nil, signupBody)
	if code, _ := resp["code"].(string); code != "200" {
		msg, _ := resp["message"].(string)
		if !strings.Contains(msg, "exists") {
			t.Logf("signup %s: code=%v msg=%s (proceeding to login)", email, code, msg)
		}
	}

	token, actorID := login(t, email, password)
	return &testClient{t: t, token: token, actorID: actorID, email: email}
}

func login(t *testing.T, email, password string) (string, string) {
	t.Helper()

	startResp := httpPost(t, "/actor/access/start", nil, map[string]interface{}{
		"station_url": stationURL,
		"client":      map[string]string{"platform": "desktop"},
	})
	data, _ := startResp["data"].(map[string]interface{})
	decision, _ := data["decision"].(map[string]interface{})
	attemptID, _ := decision["attempt_id"].(string)
	if attemptID == "" {
		t.Fatalf("access/start failed: no attempt_id in %v", startResp)
	}

	submitResp := httpPost(t, "/actor/access/submit", nil, map[string]interface{}{
		"attempt_id": attemptID,
		"gate_id":    "auth.login",
		"type":       2,
		"login": map[string]string{
			"email":       email,
			"password":    password,
			"device_type": "desktop",
		},
	})

	submitData, _ := submitResp["data"].(map[string]interface{})
	loginResp, _ := submitData["login_response"].(map[string]interface{})
	tokens, _ := loginResp["tokens"].(map[string]interface{})
	accessToken, _ := tokens["access_token"].(string)
	if accessToken == "" {
		t.Fatalf("login failed for %s: %v", email, submitResp)
	}

	actor, _ := loginResp["actor"].(map[string]interface{})
	actorID := fmt.Sprintf("%v", actor["id"])

	return accessToken, actorID
}

// ─── Scenario A: P2P DM ──────────────────────────────────────────

func TestP2P_A1_FriendRequestLifecycle(t *testing.T) {
	a := setupTestActor(t, "alice_p2p", "alice_p2p@test.local", "TestPass1!")
	b := setupTestActor(t, "bob_p2p_x", "bob_p2p@test.local", "TestPass1!")

	// A sends friend request to B
	sendResp := httpPost(t, "/api/v1/social/friend-request/send", &a.token, map[string]string{
		"receiver_ptid": b.actorID,
		"message":       "Hey Bob, let's chat!",
	})
	assertSuccess(t, sendResp, "send friend request")

	// B lists friend requests
	listResp := httpGet(t, "/api/v1/social/friend-requests", &b.token)
	requests := extractList(t, listResp, "requests")
	found := false
	var requestID string
	for _, r := range requests {
		req, _ := r.(map[string]interface{})
		senderPTID := fmt.Sprintf("%v", req["sender_ptid"])
		if senderPTID == a.actorID {
			found = true
			requestID = fmt.Sprintf("%v", req["id"])
			status := req["status"]
			t.Logf("[R] B sees request from A: id=%s status=%v", requestID, status)

			senderName := fmt.Sprintf("%v", req["sender_display_name"])
			if senderName == "" || senderName == "<nil>" {
				t.Error("sender_display_name is empty — profile enrichment broken")
			}
			break
		}
	}
	if !found {
		t.Fatal("[R] B did not receive friend request from A")
	}

	// [N] B checks notification
	notifResp := httpGet(t, "/notification/list?category=1&status=1", &b.token)
	notifications := extractList(t, notifResp, "notifications")
	notifFound := false
	for _, n := range notifications {
		notif, _ := n.(map[string]interface{})
		ntype := toInt(notif["type"])
		actorIDField := fmt.Sprintf("%v", notif["actor_id"])
		if ntype == 200 && actorIDField == a.actorID {
			notifFound = true
			t.Logf("[N] B received notification: type=%d actor=%s", ntype, actorIDField)
			break
		}
	}
	if !notifFound {
		t.Error("[N] B did not receive friend request notification (type=200)")
	}

	// B accepts
	acceptResp := httpPost(t, "/api/v1/social/friend-request/accept", &b.token, map[string]string{
		"request_id": requestID,
	})
	assertSuccess(t, acceptResp, "accept friend request")
	t.Log("[R] B accepted friend request")

	// A lists sessions — should see DM with B
	time.Sleep(500 * time.Millisecond)
	sessResp := httpGet(t, "/friend-chat/sessions", &a.token)
	sessions := extractList(t, sessResp, "sessions")
	if len(sessions) == 0 {
		t.Log("[R] A: no DM sessions found (session may be returned in accept response)")
	} else {
		t.Logf("[R] A sees %d DM sessions", len(sessions))
	}
}

func TestP2P_A2_TextMessage(t *testing.T) {
	a := setupTestActor(t, "alice_msg_", "alice_msg@test.local", "TestPass1!")
	b := setupTestActor(t, "bob_msg_xx", "bob_msg@test.local", "TestPass1!")

	sessionID := setupFriendship(t, a, b)
	if sessionID == "" {
		t.Skip("could not establish friendship + DM session")
	}

	// A sends text
	sendResp := httpPost(t, "/friend-chat/message/send", &a.token, map[string]interface{}{
		"session_ulid":      sessionID,
		"receiver_ptid":     b.actorID,
		"type":              1,
		"encrypted_payload": "aGVsbG8gZnJvbSBBbGljZQ==",
	})
	assertSuccess(t, sendResp, "send text message")
	t.Log("[S] A sent text message")

	// B lists messages
	time.Sleep(300 * time.Millisecond)
	msgResp := httpGet(t, fmt.Sprintf("/friend-chat/messages?session_ulid=%s&limit=10", sessionID), &b.token)
	messages := extractList(t, msgResp, "messages")
	if len(messages) > 0 {
		t.Logf("[R] B received %d messages", len(messages))
	} else {
		t.Error("[R] B did not see any messages from A")
	}
}

func TestP2P_A5_EmojiRoundTrip(t *testing.T) {
	a := setupTestActor(t, "alice_emji", "alice_emoji@test.local", "TestPass1!")
	b := setupTestActor(t, "bob_emoji_", "bob_emoji@test.local", "TestPass1!")

	sessionID := setupFriendship(t, a, b)
	if sessionID == "" {
		t.Skip("could not establish friendship + DM session")
	}

	emoji := "👍🎉🔥💯"
	_ = emoji
	sendResp := httpPost(t, "/friend-chat/message/send", &a.token, map[string]interface{}{
		"session_ulid":      sessionID,
		"receiver_ptid":     b.actorID,
		"type":              1,
		"encrypted_payload": "8J+RjfCfjok8L3htbD7wn5Sl",
	})
	assertSuccess(t, sendResp, "send emoji message")

	time.Sleep(300 * time.Millisecond)
	msgResp := httpGet(t, fmt.Sprintf("/friend-chat/messages?session_ulid=%s&limit=10", sessionID), &b.token)
	messages := extractList(t, msgResp, "messages")
	found := false
	for _, m := range messages {
		msg, _ := m.(map[string]interface{})
		body := fmt.Sprintf("%v", msg["body"])
		if body == emoji {
			found = true
			t.Log("[R] B received emoji intact: " + emoji)
			break
		}
	}
	if !found {
		t.Errorf("[R] Emoji round-trip failed. Expected %q in messages", emoji)
	}
}

func TestP2P_A8_Presence(t *testing.T) {
	a := setupTestActor(t, "alice_pres", "alice_pres@test.local", "TestPass1!")
	b := setupTestActor(t, "bob_pres_x", "bob_pres@test.local", "TestPass1!")

	// A sends heartbeat
	hbResp := httpPost(t, "/presence/heartbeat", &a.token, map[string]string{
		"session_id": "test-device-a",
	})
	assertSuccess(t, hbResp, "presence heartbeat")

	// B queries A's presence
	queryResp := httpPost(t, "/presence/query", &b.token, map[string]interface{}{
		"actor_ids": []string{a.actorID},
	})
	statuses := extractList(t, queryResp, "statuses")
	if len(statuses) > 0 {
		s, _ := statuses[0].(map[string]interface{})
		state := toInt(s["state"])
		if state == 1 {
			t.Log("[P] A is ONLINE as seen by B")
		} else {
			t.Errorf("[P] Expected A online (state=1), got state=%d", state)
		}
	} else {
		t.Error("[P] No presence status returned for A")
	}

	// A goes offline
	offResp := httpPost(t, "/presence/offline", &a.token, map[string]string{
		"session_id": "test-device-a",
	})
	assertSuccess(t, offResp, "presence offline")

	time.Sleep(200 * time.Millisecond)
	queryResp2 := httpPost(t, "/presence/query", &b.token, map[string]interface{}{
		"actor_ids": []string{a.actorID},
	})
	statuses2 := extractList(t, queryResp2, "statuses")
	if len(statuses2) > 0 {
		s, _ := statuses2[0].(map[string]interface{})
		state := toInt(s["state"])
		if state == 2 {
			t.Log("[P] A is OFFLINE as seen by B")
		} else {
			t.Errorf("[P] Expected A offline (state=2), got state=%d", state)
		}
	}
}

// ─── Scenario B: Group Chat ───────────────────────────────────────

func TestGroup_B1_CreateAndList(t *testing.T) {
	a := setupTestActor(t, "alice_grp_", "alice_grp@test.local", "TestPass1!")
	b := setupTestActor(t, "bob_grp_xx", "bob_grp@test.local", "TestPass1!")
	c := setupTestActor(t, "charl_grp_", "charlie_grp@test.local", "TestPass1!")

	// A creates group with B and C
	createResp := httpPost(t, "/group-chat/create", &a.token, map[string]interface{}{
		"name":                 "Test Group ABC",
		"initial_member_ptids": []string{b.actorID, c.actorID},
	})
	assertSuccess(t, createResp, "create group")
	group, _ := createResp["group"].(map[string]interface{})
	var groupUlid string
	if group != nil {
		groupUlid = fmt.Sprintf("%v", group["ulid"])
	}
	if groupUlid == "" {
		groupUlid = extractString(createResp, "group_ulid", "ulid")
	}
	if groupUlid == "" {
		t.Fatal("group creation did not return ulid")
	}
	t.Logf("[S] A created group: %s", groupUlid)

	// B lists groups
	bGroups := httpGet(t, "/group-chat/list", &b.token)
	groups := extractList(t, bGroups, "groups")
	found := false
	for _, g := range groups {
		grp, _ := g.(map[string]interface{})
		if fmt.Sprintf("%v", grp["ulid"]) == groupUlid {
			found = true
			break
		}
	}
	if !found {
		t.Error("[R] B does not see group in list")
	} else {
		t.Log("[R] B sees group in list")
	}

	// C lists groups
	cGroups := httpGet(t, "/group-chat/list", &c.token)
	cGroupList := extractList(t, cGroups, "groups")
	cFound := false
	for _, g := range cGroupList {
		grp, _ := g.(map[string]interface{})
		if fmt.Sprintf("%v", grp["ulid"]) == groupUlid {
			cFound = true
			break
		}
	}
	if !cFound {
		t.Error("[R] C does not see group in list")
	} else {
		t.Log("[R] C sees group in list")
	}
}

func TestGroup_B2_TextFanOut(t *testing.T) {
	a := setupTestActor(t, "alice_fan_", "alice_fan@test.local", "TestPass1!")
	b := setupTestActor(t, "bob_fan_xx", "bob_fan@test.local", "TestPass1!")
	c := setupTestActor(t, "charl_fan_", "charlie_fan@test.local", "TestPass1!")

	groupUlid := setupGroup(t, a, b, c)
	if groupUlid == "" {
		t.Skip("group setup failed")
	}

	// A sends to group
	sendResp := httpPost(t, "/group-chat/message/send", &a.token, map[string]interface{}{
		"group_ulid":        groupUlid,
		"type":              1,
		"encrypted_payload": "aGVsbG8gZ3JvdXAgZnJvbSBBbGljZQ==",
	})
	assertSuccess(t, sendResp, "group send message")

	time.Sleep(300 * time.Millisecond)

	// B reads
	bMsgs := httpGet(t, fmt.Sprintf("/group-chat/messages?group_ulid=%s&limit=10", groupUlid), &b.token)
	bMessages := extractList(t, bMsgs, "messages")
	if len(bMessages) > 0 {
		t.Logf("[R] B received %d group messages", len(bMessages))
	} else {
		t.Error("[R] B did not receive group message")
	}

	// C reads
	cMsgs := httpGet(t, fmt.Sprintf("/group-chat/messages?group_ulid=%s&limit=10", groupUlid), &c.token)
	cMessages := extractList(t, cMsgs, "messages")
	if len(cMessages) > 0 {
		t.Logf("[R] C received %d group messages (fan-out works)", len(cMessages))
	} else {
		t.Error("[R] C did not receive group message (fan-out broken)")
	}
}

// ─── Scenario F1: Reactions ──────────────────────────────────────

func TestF1_Reaction(t *testing.T) {
	a := setupTestActor(t, "alice_rct_", "alice_react@test.local", "TestPass1!")
	b := setupTestActor(t, "bob_rct_xx", "bob_react@test.local", "TestPass1!")

	groupUlid := setupGroup(t, a, b, b)
	if groupUlid == "" {
		t.Skip("group setup failed")
	}

	// A sends a message
	sendResp := httpPost(t, "/group-chat/message/send", &a.token, map[string]interface{}{
		"group_ulid":        groupUlid,
		"type":              1,
		"encrypted_payload": "dGVzdCByZWFjdGlvbg==",
	})
	assertSuccess(t, sendResp, "send message for reaction")
	msg, _ := sendResp["message"].(map[string]interface{})
	messageID := fmt.Sprintf("%v", msg["ulid"])
	if messageID == "" {
		t.Fatal("message send did not return ulid")
	}

	// B reacts with 👍
	reactResp := httpPost(t, "/conversation/command", &b.token, map[string]interface{}{
		"command": map[string]interface{}{
			"conversation_id": groupUlid,
			"react": map[string]interface{}{
				"message_id": messageID,
				"emoji":      "👍",
				"remove":     false,
			},
		},
	})
	assertSuccess(t, reactResp, "react to message")
	t.Log("[R] B reacted with 👍")

	// Verify reaction appears in events
	evResp := httpGet(t, fmt.Sprintf("/conversation/events?conversation_id=%s&after_seq=0&limit=50", groupUlid), &a.token)
	events := extractList(t, evResp, "events")
	reactionFound := false
	for _, ev := range events {
		e, _ := ev.(map[string]interface{})
		if reaction, ok := e["reaction"].(map[string]interface{}); ok {
			if fmt.Sprintf("%v", reaction["emoji"]) == "👍" && fmt.Sprintf("%v", reaction["message_id"]) == messageID {
				reactionFound = true
				t.Logf("[R] A sees B's 👍 reaction on message %s", messageID)
			}
		}
	}
	if !reactionFound {
		t.Error("[R] Reaction not found in conversation events")
	}
}

// ─── Scenario D: Error Cases ──────────────────────────────────────

func TestError_D3_FriendRequestToSelf(t *testing.T) {
	a := setupTestActor(t, "alice_self", "alice_self@test.local", "TestPass1!")

	resp := httpPost(t, "/api/v1/social/friend-request/send", &a.token, map[string]string{
		"receiver_ptid": a.actorID,
		"message":       "",
	})
	msg := fmt.Sprintf("%v", resp["message"])
	errMsg := fmt.Sprintf("%v", resp["error"])
	combined := strings.ToLower(msg + errMsg)
	if !strings.Contains(combined, "yourself") {
		t.Errorf("[D3] Expected 'yourself' error, got: %v", resp)
	} else {
		t.Log("[D3] Correctly rejected self friend request")
	}
}

// ─── Helpers ──────────────────────────────────────────────────────

func setupFriendship(t *testing.T, a, b *testClient) string {
	t.Helper()

	httpPost(t, "/api/v1/social/friend-request/send", &a.token, map[string]string{
		"receiver_ptid": b.actorID,
		"message":       "test friend request",
	})

	time.Sleep(200 * time.Millisecond)
	listResp := httpGet(t, "/api/v1/social/friend-requests", &b.token)
	requests := extractList(t, listResp, "requests")
	var requestID string
	for _, r := range requests {
		req, _ := r.(map[string]interface{})
		if fmt.Sprintf("%v", req["sender_ptid"]) == a.actorID {
			status := fmt.Sprintf("%v", req["status"])
			if status == "FRIEND_REQUEST_STATUS_PENDING" || status == "1" {
				requestID = fmt.Sprintf("%v", req["id"])
			}
			break
		}
	}

	if requestID != "" {
		httpPost(t, "/api/v1/social/friend-request/accept", &b.token, map[string]string{
			"request_id": requestID,
		})
		time.Sleep(300 * time.Millisecond)
	}

	// Look for existing DM session; create one if missing (users already friends).
	sessions := httpGet(t, "/friend-chat/sessions", &a.token)
	sList := extractList(t, sessions, "sessions")
	for _, s := range sList {
		sess, _ := s.(map[string]interface{})
		ulid := fmt.Sprintf("%v", sess["ulid"])
		if ulid != "" {
			return ulid
		}
	}

	// No session exists — create one explicitly.
	createResp := httpPost(t, "/friend-chat/session/create", &a.token, map[string]string{
		"participant_ptid": b.actorID,
	})
	sess, _ := createResp["session"].(map[string]interface{})
	if sess != nil {
		return fmt.Sprintf("%v", sess["ulid"])
	}
	return ""
}

func setupGroup(t *testing.T, a, b, c *testClient) string {
	t.Helper()
	createResp := httpPost(t, "/group-chat/create", &a.token, map[string]interface{}{
		"name":                 fmt.Sprintf("TestGroup-%d", time.Now().UnixMilli()),
		"initial_member_ptids": []string{b.actorID, c.actorID},
	})
	group, _ := createResp["group"].(map[string]interface{})
	if group != nil {
		return fmt.Sprintf("%v", group["ulid"])
	}
	return extractString(createResp, "group_ulid", "ulid")
}

func containsMessage(messages []interface{}, body string) bool {
	for _, m := range messages {
		msg, _ := m.(map[string]interface{})
		if fmt.Sprintf("%v", msg["body"]) == body {
			return true
		}
	}
	return false
}

func httpPost(t *testing.T, path string, token *string, body interface{}) map[string]interface{} {
	t.Helper()
	jsonBody, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", stationURL+path, bytes.NewReader(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	if token != nil {
		req.Header.Set("Authorization", "Bearer "+*token)
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("POST %s failed: %v", path, err)
	}
	defer resp.Body.Close()
	return parseJSON(t, resp.Body)
}

func httpGet(t *testing.T, path string, token *string) map[string]interface{} {
	t.Helper()
	req, _ := http.NewRequest("GET", stationURL+path, nil)
	if token != nil {
		req.Header.Set("Authorization", "Bearer "+*token)
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("GET %s failed: %v", path, err)
	}
	defer resp.Body.Close()
	return parseJSON(t, resp.Body)
}

func parseJSON(t *testing.T, r io.Reader) map[string]interface{} {
	t.Helper()
	body, _ := io.ReadAll(r)
	if len(body) == 0 {
		return map[string]interface{}{}
	}
	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		var arr []interface{}
		if json.Unmarshal(body, &arr) == nil {
			return map[string]interface{}{"data": arr}
		}
		t.Logf("JSON decode warning (body=%q): %v", string(body[:min(len(body), 100)]), err)
		return map[string]interface{}{}
	}
	return result
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func assertSuccess(t *testing.T, resp map[string]interface{}, context string) {
	t.Helper()
	code := fmt.Sprintf("%v", resp["code"])
	errField := fmt.Sprintf("%v", resp["error"])
	if code == "400" || code == "401" || code == "403" || code == "404" || code == "500" {
		msg := fmt.Sprintf("%v", resp["message"])
		if msg == "<nil>" {
			msg = errField
		}
		t.Errorf("%s failed: code=%s msg=%s", context, code, msg)
	}
}

func extractList(t *testing.T, resp map[string]interface{}, keys ...string) []interface{} {
	t.Helper()
	data, _ := resp["data"].(map[string]interface{})
	if data == nil {
		if list, ok := resp["data"].([]interface{}); ok {
			return list
		}
		data = resp
	}
	for _, key := range keys {
		if list, ok := data[key].([]interface{}); ok {
			return list
		}
	}
	if list, ok := data["items"].([]interface{}); ok {
		return list
	}
	return nil
}

func extractString(resp map[string]interface{}, keys ...string) string {
	data, _ := resp["data"].(map[string]interface{})
	if data == nil {
		data = resp
	}
	for _, key := range keys {
		if v, ok := data[key]; ok {
			return fmt.Sprintf("%v", v)
		}
	}
	return ""
}

func toInt(v interface{}) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	}
	return 0
}

func TestF3_GroupAdmin(t *testing.T) {
	owner := setupTestActor(t, "owner_adm_", "owner_admin@test.local", "TestPass1!")
	member := setupTestActor(t, "memb_adm_x", "member_admin@test.local", "TestPass1!")

	groupUlid := setupGroup(t, owner, member, member)
	if groupUlid == "" {
		t.Skip("group setup failed")
	}

	// Owner promotes member to admin
	promoteResp := httpPost(t, "/group-chat/member/update", &owner.token, map[string]interface{}{
		"group_ulid": groupUlid,
		"ptid":       member.actorID,
		"role":       2,
	})
	assertSuccess(t, promoteResp, "promote member")
	t.Log("[S] Owner promoted member to ADMIN")

	// Verify member is now admin
	membersResp := httpGet(t, fmt.Sprintf("/group-chat/members?group_ulid=%s", groupUlid), &owner.token)
	membersList := extractList(t, membersResp, "members")
	adminFound := false
	for _, m := range membersList {
		mem, _ := m.(map[string]interface{})
		if fmt.Sprintf("%v", mem["ptid"]) == member.actorID {
			role := fmt.Sprintf("%v", mem["role"])
			if role == "GROUP_ROLE_ADMIN" || role == "2" {
				adminFound = true
			}
		}
	}
	if adminFound {
		t.Log("[R] Member role confirmed as ADMIN")
	} else {
		t.Error("[R] Member role not updated to ADMIN")
	}

	// Non-admin cannot remove (create a third user)
	nonAdmin := setupTestActor(t, "nonadm_xxx", "nonadmin@test.local", "TestPass1!")
	// Try to update without being admin — should fail
	failResp := httpPost(t, "/group-chat/member/update", &nonAdmin.token, map[string]interface{}{
		"group_ulid": groupUlid,
		"ptid":       member.actorID,
		"role":       1,
	})
	code := fmt.Sprintf("%v", failResp["code"])
	if code == "500" || code == "403" {
		t.Log("[D] Non-admin correctly rejected from updating members")
	} else {
		t.Errorf("[D] Non-admin update should fail, got: %v", failResp)
	}
}
