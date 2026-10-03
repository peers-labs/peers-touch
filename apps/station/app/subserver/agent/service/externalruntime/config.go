package externalruntime

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	defaultRoot             = "/var/lib/peers-touch/external-runtimes"
	defaultTimeout          = 10 * time.Minute
	defaultTerminationGrace = 2 * time.Second
	maxArgCount             = 64
	maxArgLength            = 4096
	maxEventCount           = 10000
	maxOutputBytes          = 4 * 1024 * 1024
	maxOutputLineBytes      = 2 * 1024 * 1024
	maxStderrCaptureLen     = 64 * 1024
)

const (
	EnvRuntimeRoot = "PT_AGENT_EXTERNAL_RUNTIME_ROOT"
	EnvStartArgv   = "PT_AGENT_EXTERNAL_START_ARGV_JSON"
	EnvResumeArgv  = "PT_AGENT_EXTERNAL_RESUME_ARGV_JSON"
	EnvResetArgv   = "PT_AGENT_EXTERNAL_RESET_ARGV_JSON"
)

type FailureKind string

const (
	FailureUnavailable       FailureKind = "unavailable"
	FailureInvalidConfig     FailureKind = "invalid_config"
	FailureStart             FailureKind = "start_failed"
	FailureOutput            FailureKind = "output_failed"
	FailureTimeout           FailureKind = "timeout"
	FailureExit              FailureKind = "execution_failed"
	FailureEmptyResponse     FailureKind = "empty_response"
	FailureResumeUnavailable FailureKind = "resume_unavailable"
	FailureCleanup           FailureKind = "cleanup_failed"
)

type ExecutionError struct {
	Kind     FailureKind
	ExitCode int
	Cause    error
}

func (e *ExecutionError) Error() string {
	return fmt.Sprintf("external Agent runtime %s", e.Kind)
}

func (e *ExecutionError) Unwrap() error {
	return e.Cause
}

func IsFailureKind(err error, kind FailureKind) bool {
	var executionErr *ExecutionError
	return errors.As(err, &executionErr) && executionErr.Kind == kind
}

type Config struct {
	RuntimeRoot      string
	StartArgv        []string
	ResumeArgv       []string
	ResetArgv        []string
	Timeout          time.Duration
	TerminationGrace time.Duration
}

func ConfigFromEnvironment() (Config, error) {
	startArgv, err := parseArgvEnv(EnvStartArgv)
	if err != nil {
		return Config{}, err
	}
	resumeArgv, err := parseArgvEnv(EnvResumeArgv)
	if err != nil {
		return Config{}, err
	}
	resetArgv, err := parseArgvEnv(EnvResetArgv)
	if err != nil {
		return Config{}, err
	}
	return normalizeConfig(Config{
		RuntimeRoot: os.Getenv(EnvRuntimeRoot),
		StartArgv:   startArgv,
		ResumeArgv:  resumeArgv,
		ResetArgv:   resetArgv,
	})
}

func EnvironmentConfigured() bool {
	return strings.TrimSpace(os.Getenv(EnvStartArgv)) != "" ||
		strings.TrimSpace(os.Getenv(EnvResumeArgv)) != "" ||
		strings.TrimSpace(os.Getenv(EnvResetArgv)) != ""
}

func normalizeConfig(config Config) (Config, error) {
	if strings.TrimSpace(config.RuntimeRoot) == "" {
		config.RuntimeRoot = defaultRoot
	}
	root, err := filepath.Abs(config.RuntimeRoot)
	if err != nil || !filepath.IsAbs(root) {
		return Config{}, &ExecutionError{Kind: FailureInvalidConfig, Cause: err}
	}
	config.RuntimeRoot = filepath.Clean(root)
	if config.Timeout <= 0 {
		config.Timeout = defaultTimeout
	}
	if config.TerminationGrace <= 0 {
		config.TerminationGrace = defaultTerminationGrace
	}
	for name, argv := range map[string][]string{
		"start":  config.StartArgv,
		"resume": config.ResumeArgv,
		"reset":  config.ResetArgv,
	} {
		if err := validateArgv(name, argv); err != nil {
			return Config{}, err
		}
	}
	return config, nil
}

func (config Config) available() bool {
	for _, argv := range [][]string{
		config.StartArgv,
		config.ResumeArgv,
		config.ResetArgv,
	} {
		if len(argv) == 0 {
			return false
		}
		if _, err := exec.LookPath(argv[0]); err != nil {
			return false
		}
	}
	return true
}

func RuntimeHomeRef(actorPTID, conversationID string, epoch uint64) (string, error) {
	actorPTID = strings.TrimSpace(actorPTID)
	conversationID = strings.TrimSpace(conversationID)
	if actorPTID == "" || conversationID == "" || epoch == 0 {
		return "", &ExecutionError{Kind: FailureInvalidConfig}
	}
	sum := sha256.Sum256([]byte(
		actorPTID + "\x00" + conversationID + "\x00" + fmt.Sprintf("%d", epoch),
	))
	return "runtime-home-" + hex.EncodeToString(sum[:16]), nil
}

func resolveRuntimeHome(root, ref string) (string, error) {
	if !strings.HasPrefix(ref, "runtime-home-") ||
		len(ref) != len("runtime-home-")+32 {
		return "", &ExecutionError{Kind: FailureInvalidConfig}
	}
	for _, value := range strings.TrimPrefix(ref, "runtime-home-") {
		if !strings.ContainsRune("0123456789abcdef", value) {
			return "", &ExecutionError{Kind: FailureInvalidConfig}
		}
	}
	root = filepath.Clean(root)
	home := filepath.Join(root, ref)
	relative, err := filepath.Rel(root, home)
	if err != nil || relative == "." || strings.HasPrefix(relative, "..") {
		return "", &ExecutionError{Kind: FailureInvalidConfig, Cause: err}
	}
	return home, nil
}

func ensurePrivateDirectory(path string) (bool, error) {
	info, err := os.Stat(path)
	if err == nil {
		if !info.IsDir() {
			return false, fmt.Errorf("runtime home is not a directory")
		}
		return false, os.Chmod(path, 0o700)
	}
	if !os.IsNotExist(err) {
		return false, err
	}
	if err := os.MkdirAll(path, 0o700); err != nil {
		return false, err
	}
	return true, nil
}

func parseArgvEnv(name string) ([]string, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return nil, nil
	}
	var argv []string
	if err := json.Unmarshal([]byte(raw), &argv); err != nil {
		return nil, &ExecutionError{Kind: FailureInvalidConfig, Cause: err}
	}
	return argv, nil
}

func validateArgv(name string, argv []string) error {
	if len(argv) == 0 || len(argv) > maxArgCount {
		return &ExecutionError{
			Kind:  FailureInvalidConfig,
			Cause: fmt.Errorf("%s argv is missing or exceeds its bound", name),
		}
	}
	for _, arg := range argv {
		if strings.TrimSpace(arg) == "" || len(arg) > maxArgLength ||
			strings.ContainsAny(arg, "\x00\r\n") {
			return &ExecutionError{
				Kind:  FailureInvalidConfig,
				Cause: fmt.Errorf("%s argv contains an invalid value", name),
			}
		}
	}
	return nil
}

func substituteArgv(argv []string, sessionID, runtimeHome string) []string {
	result := make([]string, len(argv))
	for index, arg := range argv {
		result[index] = strings.NewReplacer(
			"{session_id}", sessionID,
			"{runtime_home}", runtimeHome,
		).Replace(arg)
	}
	return result
}

func restrictedEnv() []string {
	allowed := []string{
		"HOME",
		"LANG",
		"LC_ALL",
		"PATH",
		"SSL_CERT_DIR",
		"SSL_CERT_FILE",
		"TEMP",
		"TMP",
		"TMPDIR",
		"TZ",
	}
	env := make([]string, 0, len(allowed))
	for _, key := range allowed {
		if value, ok := os.LookupEnv(key); ok {
			env = append(env, key+"="+value)
		}
	}
	return env
}
