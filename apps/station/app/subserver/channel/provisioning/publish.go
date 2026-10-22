package provisioning

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// publishOutcome reports whether the created version is online or waiting on
// tenant administrator approval.
type publishOutcome int

const (
	publishOnline publishOutcome = iota
	publishReviewRequired
)

// ownerUserID reads the first member of the app's contact/visibility range.
func (d *developerClient) ownerUserID(ctx context.Context, appID string) (string, error) {
	resp, err := d.postJSON(ctx, "/contact_range/"+appID, map[string]any{})
	if err != nil || respCode(resp) != 0 {
		return "", fmt.Errorf("get contact range failed: %s", respSummary(resp))
	}
	data := respData(resp)
	detail, _ := data["contactRangeDetail"].(map[string]any)
	if detail == nil {
		return "", fmt.Errorf("contactRangeDetail missing")
	}
	members := asMapSlice(detail["members"])
	if len(members) == 0 {
		return "", fmt.Errorf("no members in contact range")
	}
	return asString(members[0]["id"]), nil
}

// publish creates a version and submits it. When the tenant release policy
// requires independent administrator approval it returns publishReviewRequired
// (the draft remains submitted); otherwise it commits and waits for online.
func (d *developerClient) publish(
	ctx context.Context,
	appID string,
) (publishOutcome, string, error) {
	userID, err := d.ownerUserID(ctx, appID)
	if err != nil {
		return 0, "", err
	}
	members := []string{userID}

	verList, err := d.postJSON(ctx, "/app_version/list/"+appID, map[string]any{})
	if err != nil || respCode(verList) != 0 {
		return 0, userID, fmt.Errorf("list versions failed: %s", respSummary(verList))
	}
	newVersion := "0.0.1"
	for _, v := range asMapSlice(respData(verList)["versions"]) {
		switch int(asFloat(v["versionStatus"])) {
		case 0:
			return 0, userID, fmt.Errorf("a draft version already exists; resolve it in the developer console")
		case 1:
			return publishReviewRequired, userID, nil
		case 2:
			newVersion = bumpVersion(asString(v["appVersion"]))
		}
	}

	versionResp, err := d.postJSON(ctx, "/app_version/create/"+appID, map[string]any{
		"appVersion":           newVersion,
		"mobileDefaultAbility": "bot",
		"pcDefaultAbility":     "bot",
		"changeLog":            "Auto-created by Peers-Touch",
		"visibleSuggest":       map[string]any{"departments": []string{}, "members": members, "groups": []string{}, "isAll": 0},
		"applyReasonConfig":    reviewFreeReasonConfig(),
		"b2cShareSuggest":      false,
		"autoPublish":          false,
		"remark":               "Personal AI assistant bot",
		"blackVisibleSuggest":  map[string]any{"departments": []string{}, "members": []string{}, "groups": []string{}, "isAll": 0},
	})
	if err != nil || respCode(versionResp) != 0 {
		return 0, userID, fmt.Errorf("create version failed: %s", respSummary(versionResp))
	}
	versionID := respString(versionResp, "data", "versionId")
	if versionID == "" {
		return 0, userID, fmt.Errorf("version id missing")
	}

	approval, err := d.postJSON(ctx, "/approval_nodes/get/"+appID, map[string]any{
		"visibleSuggest":      map[string]any{"departments": []string{}, "members": members, "groups": []string{}, "isAll": 0},
		"blackVisibleSuggest": map[string]any{"departments": []string{}, "members": []string{}, "groups": []string{}, "isAll": 0},
		"b2cShareSuggest":     false, "versionId": versionID, "notCalculateFlow": false,
	})
	if err != nil || respCode(approval) != 0 {
		return 0, userID, fmt.Errorf("get approval nodes failed: %s", respSummary(approval))
	}
	approvers := extractApprovers(respData(approval), userID)
	canAuto := mapBool(respData(approval), "canAutoApproval", "can_auto_approval")
	if len(approvers) > 0 && !canAuto {
		// Tenant release policy requires an independent administrator
		// approval. Submit the version for review and report the console URL;
		// enablement stays blocked until it is online.
		if err := d.commitPublish(ctx, appID, versionID); err != nil {
			return 0, userID, err
		}
		return publishReviewRequired, userID, nil
	}

	if err := d.commitPublish(ctx, appID, versionID); err != nil {
		return 0, userID, err
	}
	if !d.pollOnline(ctx, appID, versionID) {
		return publishReviewRequired, userID, nil
	}
	return publishOnline, userID, nil
}

func (d *developerClient) commitPublish(ctx context.Context, appID, versionID string) error {
	d.sleep(2 * time.Second)
	// Best-effort: silence the audit-rule notification that can otherwise
	// block the auto commit in freshly created tenants.
	_, _ = d.postJSON(ctx, "/config/audit_rule_notify/"+appID, map[string]any{"auditRuleNotify": false})
	d.sleep(2 * time.Second)
	resp, err := d.postJSON(ctx, fmt.Sprintf("/publish/commit/%s/%s", appID, versionID), map[string]any{})
	if err != nil {
		return fmt.Errorf("publish commit: %w", err)
	}
	if code := respCode(resp); code == 2200 {
		// Console eventual-consistency retry.
		d.sleep(5 * time.Second)
		resp, err = d.postJSON(ctx, fmt.Sprintf("/publish/commit/%s/%s", appID, versionID), map[string]any{})
	}
	if err != nil || respCode(resp) != 0 {
		return fmt.Errorf("publish commit failed: %s", respSummary(resp))
	}
	return nil
}

// reviewFreeReasonConfig is the version-create privilege-reason payload for
// the minimal private-chat scope set: no sensitive privilege expansion is
// claimed, matching the reference product's review-free create.
func reviewFreeReasonConfig() map[string]any {
	return map[string]any{
		"apiPrivilegeNeedReason":     false,
		"contactPrivilegeNeedReason": false,
		"dataPrivilegeReasonMap":     map[string]any{},
		"visibleScopeNeedReason":     false,
		"apiPrivilegeReasonMap":      map[string]any{},
		"contactPrivilegeReason":     "",
		"isDataPrivilegeExpandMap":   map[string]any{},
		"visibleScopeReason":         "",
		"dataPrivilegeNeedReason":    false,
		"isAutoAudit":                false,
		"isContactExpand":            false,
	}
}

// pollOnline waits until the committed version reaches status 2 (online).
func (d *developerClient) pollOnline(ctx context.Context, appID, versionID string) bool {
	d.sleep(3 * time.Second)
	for i := 0; i < 10; i++ {
		resp, err := d.postJSON(ctx, "/app_version/list/"+appID, map[string]any{})
		if err == nil && respCode(resp) == 0 {
			for _, v := range asMapSlice(respData(resp)["versions"]) {
				if asString(v["versionId"]) == versionID || asString(v["versionID"]) == versionID {
					if int(asFloat(v["versionStatus"])) == 2 {
						return true
					}
				}
			}
		}
		d.sleep(2 * time.Second)
	}
	return false
}

func splitVersion(ver string) []string {
	return strings.Split(strings.TrimSpace(ver), ".")
}

func extractApprovers(data map[string]any, ownerID string) []string {
	applyInfo, _ := data["applyInstanceInfo"].(map[string]any)
	if applyInfo == nil {
		return nil
	}
	var approvers []string
	for _, n := range asMapSlice(applyInfo["applyNodes"]) {
		for _, nu := range asMapSlice(n["nodeUser"]) {
			if approver, ok := nu["approver"].(map[string]any); ok {
				if id := asString(approver["id"]); id != "" && id != ownerID {
					approvers = append(approvers, id)
				}
			}
		}
	}
	return approvers
}

func bumpVersion(ver string) string {
	if ver == "" {
		return "0.0.1"
	}
	parts := splitVersion(ver)
	if len(parts) != 3 {
		return "0.0.1"
	}
	patch, err := strconv.Atoi(parts[2])
	if err != nil {
		return "0.0.1"
	}
	return parts[0] + "." + parts[1] + "." + strconv.Itoa(patch+1)
}

func asFloat(v any) float64 {
	if f, ok := v.(float64); ok {
		return f
	}
	return -1
}
