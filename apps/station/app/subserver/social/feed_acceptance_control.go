//go:build social_acceptance

package social

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/app_meta"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
)

const feedAcceptanceLease = 90 * time.Second
const feedAcceptanceMaxRuleBytes = 4096

var feedAcceptanceRunPattern = regexp.MustCompile(`^[0-9]{8}T[0-9]{12}Z-[0-9a-f]{32}$`)
var feedAcceptanceProfilePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

type feedAcceptanceScope struct {
	RunID   string `json:"runId"`
	Profile string `json:"profile"`
	Commit  string `json:"commit"`
	Station string `json:"station"`
}

type feedAcceptanceRule struct {
	feedAcceptanceScope
	ID                  string `json:"id"`
	Actor               string `json:"actor"`
	SourceStation       string `json:"sourceStation"`
	MinimumHead         uint64 `json:"minimumHead"`
	IssuedMillis        int64  `json:"issuedMillis"`
	ExpiresMillis       int64  `json:"expiresMillis"`
	EffectCount         uint32 `json:"effectCount"`
	ObservedHead        uint64 `json:"observedHead"`
	FrameSHA256         string `json:"frameSha256"`
	RepairReads         uint32 `json:"repairReads"`
	RepairApplied       bool   `json:"repairApplied"`
	RepairAfterSequence uint64 `json:"repairAfterSequence"`
	RepairVerifiedHead  uint64 `json:"repairVerifiedHead"`
	MaxEvents           int    `json:"maxEvents"`
	MaxThreads          int    `json:"maxThreads"`
	MaxBytes            int    `json:"maxBytes"`
	Bounded             bool   `json:"bounded"`
}

type feedAcceptanceControl struct {
	scope feedAcceptanceScope
	root  string
	mu    sync.Mutex
}

func configureFeedAcceptance(service *application.FeedLogService, station string) error {
	run, profile := os.Getenv("PT_SOCIAL_ACCEPTANCE_RUN_ID"), os.Getenv("PT_SOCIAL_ACCEPTANCE_PROFILE")
	if run == "" && profile == "" {
		return nil
	}
	commit := app_meta.BuildCommit
	if commit == "unknown" {
		commit = os.Getenv("PEERS_TOUCH_BUILD_COMMIT")
	}
	if !feedAcceptanceRunPattern.MatchString(run) || !feedAcceptanceProfilePattern.MatchString(profile) ||
		strings.HasSuffix(strings.ToLower(profile), "stable") ||
		len(commit) != 40 || strings.Trim(commit, "0123456789abcdef") != "" || station == "" {
		return errors.New("SOCIAL_ACCEPTANCE_SCOPE_INVALID")
	}
	service.SetFederationObservation(&feedAcceptanceControl{
		scope: feedAcceptanceScope{RunID: run, Profile: profile, Commit: commit, Station: station},
		root:  "/tmp/peers-social-acceptance-" + run,
	})
	return nil
}

func (c *feedAcceptanceControl) DropNotification(actor, source string,
	head uint64, frameSHA256 string, now time.Time,
) bool {
	return c.update(now, func(rule *feedAcceptanceRule) bool {
		if rule.EffectCount != 0 || rule.Actor != actor ||
			rule.SourceStation != source || head < rule.MinimumHead ||
			len(frameSHA256) != 64 || strings.Trim(frameSHA256, "0123456789abcdef") != "" {
			return false
		}
		rule.EffectCount = 1
		rule.ObservedHead = head
		rule.FrameSHA256 = frameSHA256
		return true
	})
}

func (c *feedAcceptanceControl) ObserveRepair(actor, source string,
	afterSequence, verifiedHead uint64, events, threads, responseBytes int,
	applied bool, now time.Time,
) {
	c.update(now, func(rule *feedAcceptanceRule) bool {
		if rule.Actor != actor || rule.SourceStation != source || rule.EffectCount != 1 {
			return false
		}
		if rule.RepairReads != ^uint32(0) {
			rule.RepairReads++
		}
		rule.MaxEvents = max(rule.MaxEvents, events)
		rule.MaxThreads = max(rule.MaxThreads, threads)
		rule.MaxBytes = max(rule.MaxBytes, responseBytes)
		if applied && events > 0 && afterSequence < rule.ObservedHead &&
			verifiedHead >= rule.ObservedHead {
			if !rule.RepairApplied {
				rule.RepairAfterSequence = afterSequence
			}
			rule.RepairApplied = true
			rule.RepairVerifiedHead = max(rule.RepairVerifiedHead, verifiedHead)
		}
		rule.Bounded = rule.Bounded && events >= 0 && events <= 32 &&
			threads >= 0 && threads <= 32 && responseBytes >= 0 && responseBytes <= 1<<20
		return true
	})
}

// No HTTP or product command receives authority to write this directory.
// The parent Fixture and this process use the same private OS lock.
func (c *feedAcceptanceControl) update(now time.Time,
	change func(*feedAcceptanceRule) bool,
) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !feedAcceptanceRunPattern.MatchString(c.scope.RunID) ||
		!feedAcceptanceProfilePattern.MatchString(c.scope.Profile) ||
		len(c.scope.Commit) != 40 || strings.Trim(c.scope.Commit, "0123456789abcdef") != "" ||
		c.scope.Station == "" || len(c.scope.Station) > 512 {
		return false
	}
	root, err := os.Lstat(c.root)
	if err != nil || !root.IsDir() || root.Mode().Perm() != 0700 {
		return false
	}
	stat, ok := root.Sys().(*syscall.Stat_t)
	if !ok || int(stat.Uid) != os.Geteuid() {
		return false
	}
	lock, err := feedAcceptanceOpen(filepath.Join(c.root, "control.lock"),
		syscall.O_RDWR|syscall.O_CREAT)
	if err != nil {
		return false
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return false
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	input, err := feedAcceptanceOpen(filepath.Join(c.root, "rule.json"), syscall.O_RDONLY)
	if err != nil {
		return false
	}
	defer input.Close()
	decoder := json.NewDecoder(io.LimitReader(input, feedAcceptanceMaxRuleBytes+1))
	decoder.DisallowUnknownFields()
	var rule feedAcceptanceRule
	if err := decoder.Decode(&rule); err != nil || decoder.Decode(new(any)) != io.EOF {
		return false
	}
	if rule.feedAcceptanceScope != c.scope || rule.ID == "" || len(rule.ID) > 160 ||
		rule.Actor == "" || len(rule.Actor) > 512 ||
		rule.SourceStation == "" || len(rule.SourceStation) > 512 ||
		rule.MinimumHead == 0 || rule.EffectCount > 1 ||
		rule.ExpiresMillis <= rule.IssuedMillis ||
		rule.ExpiresMillis-rule.IssuedMillis > feedAcceptanceLease.Milliseconds() ||
		now.UnixMilli() < rule.IssuedMillis || now.UnixMilli() >= rule.ExpiresMillis {
		return false
	}
	if !change(&rule) {
		return false
	}
	output, err := os.CreateTemp(c.root, ".rule-")
	if err != nil {
		return false
	}
	path := output.Name()
	defer os.Remove(path)
	if err := json.NewEncoder(output).Encode(rule); err != nil {
		output.Close()
		return false
	}
	if err := output.Sync(); err != nil {
		output.Close()
		return false
	}
	if err := output.Close(); err != nil {
		return false
	}
	if err := os.Rename(path, filepath.Join(c.root, "rule.json")); err != nil {
		return false
	}
	return true
}

func feedAcceptanceOpen(path string, flags int) (*os.File, error) {
	fd, err := syscall.Open(path, flags|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0600)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), path)
	stat, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}
	owner, ok := stat.Sys().(*syscall.Stat_t)
	if !stat.Mode().IsRegular() || stat.Mode().Perm() != 0600 ||
		!ok || int(owner.Uid) != os.Geteuid() || stat.Size() > feedAcceptanceMaxRuleBytes {
		file.Close()
		return nil, errors.New("SOCIAL_ACCEPTANCE_CONTROL_INVALID")
	}
	return file, nil
}
