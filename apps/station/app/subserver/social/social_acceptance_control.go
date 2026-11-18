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
)

const feedAcceptanceLease = 90 * time.Second
const feedAcceptanceMaxRuleBytes = 4096

var feedAcceptanceRunPattern = regexp.MustCompile(`^[0-9a-f]{16}$`)
var feedAcceptanceProfilePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

type socialAcceptanceScope struct {
	RunID   string `json:"runId"`
	Profile string `json:"profile"`
	Commit  string `json:"commit"`
	Station string `json:"station"`
}

func (s socialAcceptanceScope) valid() bool {
	return feedAcceptanceRunPattern.MatchString(s.RunID) &&
		feedAcceptanceProfilePattern.MatchString(s.Profile) &&
		!strings.HasSuffix(strings.ToLower(s.Profile), "stable") &&
		len(s.Commit) == 40 && strings.Trim(s.Commit, "0123456789abcdef") == "" &&
		s.Station != "" && len(s.Station) <= 512
}

func socialAcceptanceRuntimeScope(station string) (socialAcceptanceScope, bool, error) {
	scope := socialAcceptanceScope{
		RunID:   os.Getenv("PT_SOCIAL_ACCEPTANCE_RUN_ID"),
		Profile: os.Getenv("PT_SOCIAL_ACCEPTANCE_PROFILE"),
		Commit:  app_meta.BuildCommit, Station: station,
	}
	if scope.RunID == "" && scope.Profile == "" {
		return scope, false, nil
	}
	if scope.Commit == "unknown" {
		scope.Commit = os.Getenv("PEERS_TOUCH_BUILD_COMMIT")
	}
	if !scope.valid() {
		return scope, false, errors.New("SOCIAL_ACCEPTANCE_SCOPE_INVALID")
	}
	return scope, true, nil
}

func socialAcceptanceLeaseValid(issued, expires int64, now time.Time) bool {
	return expires > issued && expires-issued <= feedAcceptanceLease.Milliseconds() &&
		now.UnixMilli() >= issued && now.UnixMilli() < expires
}

// No HTTP or product command receives authority to write this directory.
// Each domain rule supplies its own strict schema and scope/lease predicate.
func updateSocialAcceptanceRule(rootPath string, mu *sync.Mutex, rule any, change func() bool) bool {
	mu.Lock()
	defer mu.Unlock()
	root, err := os.Lstat(rootPath)
	if err != nil || !root.IsDir() || root.Mode().Perm() != 0700 {
		return false
	}
	stat, ok := root.Sys().(*syscall.Stat_t)
	if !ok || int(stat.Uid) != os.Geteuid() {
		return false
	}
	lock, err := feedAcceptanceOpen(filepath.Join(rootPath, "control.lock"), syscall.O_RDWR|syscall.O_CREAT)
	if err != nil {
		return false
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return false
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	input, err := feedAcceptanceOpen(filepath.Join(rootPath, "rule.json"), syscall.O_RDONLY)
	if err != nil {
		return false
	}
	defer input.Close()
	decoder := json.NewDecoder(io.LimitReader(input, feedAcceptanceMaxRuleBytes+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(rule); err != nil || decoder.Decode(new(any)) != io.EOF || !change() {
		return false
	}
	wire, err := json.Marshal(rule)
	if err != nil || len(wire)+1 > feedAcceptanceMaxRuleBytes {
		return false
	}
	output, err := os.CreateTemp(rootPath, ".rule-")
	if err != nil {
		return false
	}
	path := output.Name()
	defer os.Remove(path)
	if _, err := output.Write(append(wire, '\n')); err != nil {
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
	return os.Rename(path, filepath.Join(rootPath, "rule.json")) == nil
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
