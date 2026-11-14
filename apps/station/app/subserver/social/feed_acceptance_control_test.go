//go:build social_acceptance

package social

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/app_meta"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
)

func testFeedAcceptanceControl(t *testing.T) (*feedAcceptanceControl, feedAcceptanceRule, time.Time) {
	t.Helper()
	root := t.TempDir()
	if err := os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	scope := feedAcceptanceScope{
		RunID:   "144e7dea1a920510",
		Profile: "reviewed-fixture", Commit: strings.Repeat("a", 40), Station: "receiver",
	}
	rule := feedAcceptanceRule{
		feedAcceptanceScope: scope, ID: "lost-notification",
		Actor: "author", SourceStation: "sender", MinimumHead: 7,
		IssuedMillis: now.UnixMilli(), ExpiresMillis: now.Add(feedAcceptanceLease).UnixMilli(),
		Bounded: true,
	}
	writeFeedAcceptanceRule(t, root, rule)
	return &feedAcceptanceControl{root: root, scope: scope}, rule, now
}

func TestNotificationControlCompositionRequiresProvisioningEpoch(t *testing.T) {
	buildCommit := app_meta.BuildCommit
	app_meta.BuildCommit = "unknown"
	t.Cleanup(func() { app_meta.BuildCommit = buildCommit })
	t.Setenv("PEERS_TOUCH_BUILD_COMMIT", strings.Repeat("a", 40))
	t.Setenv("PT_SOCIAL_ACCEPTANCE_PROFILE", "reviewed-fixture")
	for _, input := range []struct {
		run      string
		accepted bool
	}{
		{"144e7dea1a920510", true},
		{"20261108T163511078101Z-144e7dea1a92051044b7986f84702d67", false},
		{strings.Repeat("a", 32), false},
		{strings.Repeat("A", 16), false},
		{"", false},
	} {
		t.Run(input.run, func(t *testing.T) {
			t.Setenv("PT_SOCIAL_ACCEPTANCE_RUN_ID", input.run)
			err := configureFeedAcceptance(&application.FeedLogService{}, "receiver")
			if (err == nil) != input.accepted {
				t.Fatal("composition confused provisioning epoch and evidence run")
			}
		})
	}
}

func writeFeedAcceptanceRule(t *testing.T, root string, rule feedAcceptanceRule) {
	t.Helper()
	wire, err := json.Marshal(rule)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "rule.json"), wire, 0600); err != nil {
		t.Fatal(err)
	}
}

func readFeedAcceptanceRule(t *testing.T, root string) feedAcceptanceRule {
	t.Helper()
	wire, err := os.ReadFile(filepath.Join(root, "rule.json"))
	if err != nil {
		t.Fatal(err)
	}
	var rule feedAcceptanceRule
	if err := json.Unmarshal(wire, &rule); err != nil {
		t.Fatal(err)
	}
	return rule
}

func TestNotificationControlConsumesOnlyOneActualMatchingHint(t *testing.T) {
	c, _, now := testFeedAcceptanceControl(t)
	hash := strings.Repeat("b", 64)
	for _, input := range []struct {
		actor, source string
		head          uint64
		hash          string
	}{
		{"foreign", "sender", 7, hash}, {"author", "foreign", 7, hash},
		{"author", "sender", 6, hash}, {"author", "sender", 7, "bad"},
	} {
		if c.DropNotification(input.actor, input.source, input.head, input.hash, now) {
			t.Fatal("foreign or stale notification consumed fault")
		}
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	count := 0
	secondOwner := &feedAcceptanceControl{root: c.root, scope: c.scope}
	for index := range 16 {
		owner := c
		if index%2 == 1 {
			owner = secondOwner
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			if owner.DropNotification("author", "sender", 7, hash, now) {
				mu.Lock()
				count++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	rule := readFeedAcceptanceRule(t, c.root)
	if count != 1 || rule.EffectCount != 1 || rule.FrameSHA256 != hash || rule.ObservedHead != 7 {
		t.Fatal("one-shot actual notification observation lost")
	}
}

func TestNotificationControlRejectsChangedScopeAndExpiredLease(t *testing.T) {
	for _, boundary := range []string{
		"run", "profile", "commit", "station", "expired", "future", "long",
		"empty-expected-profile", "empty-expected-commit", "empty-expected-station",
	} {
		t.Run(boundary, func(t *testing.T) {
			c, rule, now := testFeedAcceptanceControl(t)
			switch boundary {
			case "run":
				rule.RunID = "foreign"
			case "profile":
				rule.Profile = "foreign"
			case "commit":
				rule.Commit = strings.Repeat("c", 40)
			case "station":
				rule.Station = "foreign"
			case "expired":
				now = now.Add(feedAcceptanceLease)
			case "future":
				rule.IssuedMillis = now.Add(time.Second).UnixMilli()
			case "long":
				rule.ExpiresMillis++
			case "empty-expected-profile":
				c.scope.Profile = ""
				rule.Profile = ""
			case "empty-expected-commit":
				c.scope.Commit = ""
				rule.Commit = ""
			case "empty-expected-station":
				c.scope.Station = ""
				rule.Station = ""
			}
			writeFeedAcceptanceRule(t, c.root, rule)
			if c.DropNotification("author", "sender", 7, strings.Repeat("b", 64), now) {
				t.Fatal("identity/lease fence bypassed")
			}
		})
	}
}

func TestNotificationControlRejectsSymlinkAndPermissiveFiles(t *testing.T) {
	for _, boundary := range []string{"root", "rule", "symlink", "oversize", "unknown"} {
		t.Run(boundary, func(t *testing.T) {
			c, _, now := testFeedAcceptanceControl(t)
			path := filepath.Join(c.root, "rule.json")
			switch boundary {
			case "root":
				os.Chmod(c.root, 0755)
			case "rule":
				os.Chmod(path, 0644)
			case "symlink":
				os.Rename(path, filepath.Join(c.root, "other.json"))
				os.Symlink(filepath.Join(c.root, "other.json"), path)
			case "oversize":
				os.WriteFile(path, []byte(strings.Repeat(" ", 4097)), 0600)
			case "unknown":
				os.WriteFile(path, []byte(`{"unknown":"field"}`), 0600)
			}
			if c.DropNotification("author", "sender", 7, strings.Repeat("b", 64), now) {
				t.Fatal("unsafe OS control accepted")
			}
		})
	}
}

func TestNotificationControlCountsOnlyPostLossRepairAndRetainsBounds(t *testing.T) {
	c, _, now := testFeedAcceptanceControl(t)
	c.ObserveRepair("author", "sender", 0, 7, 32, 32, 1000, true, now)
	if readFeedAcceptanceRule(t, c.root).RepairReads != 0 {
		t.Fatal("pre-loss read claimed as repair")
	}
	if !c.DropNotification("author", "sender", 7, strings.Repeat("b", 64), now) {
		t.Fatal("matching hint was not consumed")
	}
	c.ObserveRepair("foreign", "sender", 0, 7, 32, 32, 1000, true, now)
	c.ObserveRepair("author", "sender", 7, 7, 0, 31, 1000, true, now)
	if readFeedAcceptanceRule(t, c.root).RepairApplied {
		t.Fatal("already-seen head claimed as missing-hint repair")
	}
	c.ObserveRepair("author", "sender", 6, 7, 1, 31, 1000, false, now)
	if readFeedAcceptanceRule(t, c.root).RepairApplied {
		t.Fatal("unverified import claimed as repair")
	}
	c.ObserveRepair("author", "sender", 6, 7, 1, 31, 1000, true, now)
	c.ObserveRepair("author", "sender", 7, 8, 33, 32, 1<<20+1, true, now)
	rule := readFeedAcceptanceRule(t, c.root)
	if rule.RepairReads != 4 || rule.Bounded || rule.MaxEvents != 33 ||
		rule.MaxThreads != 32 || rule.MaxBytes != 1<<20+1 ||
		!rule.RepairApplied || rule.RepairAfterSequence != 6 || rule.RepairVerifiedHead != 7 {
		t.Fatal("actual read bounds were not retained")
	}
}
