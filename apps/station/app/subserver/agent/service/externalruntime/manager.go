package externalruntime

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
)

type ActivityKind string

const (
	ActivityRuntimeHomeCreated ActivityKind = "runtime_home_created"
	ActivityProcessStarted     ActivityKind = "process_started"
	ActivitySessionCreated     ActivityKind = "session_created"
)

type ExecuteRequest struct {
	ActorPTID        string
	AgentID          string
	ConversationID   string
	RuntimeProfileID string
	RuntimeHomeRef   string
	SessionID        string
	SessionEpoch     uint64
	Prompt           string
}

type ExecuteResult struct {
	SessionID string
	Content   string
	Streamed  bool
}

type CleanupRequest struct {
	RuntimeHomeRef string
	SessionID      string
}

type DeltaSink func(context.Context, Delta) error
type SessionSink func(context.Context, string) error
type ActivitySink func(ActivityKind)

type Manager struct {
	config Config
}

func NewManager(config Config) (*Manager, error) {
	normalized, err := normalizeConfig(config)
	if err != nil {
		return nil, err
	}
	return &Manager{config: normalized}, nil
}

func NewManagerFromEnvironment() (*Manager, error) {
	config, err := ConfigFromEnvironment()
	if err != nil {
		return nil, err
	}
	return NewManager(config)
}

func (m *Manager) Available() bool {
	return m != nil && m.config.available()
}

func (m *Manager) Execute(
	ctx context.Context,
	request ExecuteRequest,
	deltaSink DeltaSink,
	sessionSink SessionSink,
	activitySink ActivitySink,
) (*ExecuteResult, error) {
	if !m.Available() {
		return nil, &ExecutionError{Kind: FailureUnavailable}
	}
	if err := validateExecuteRequest(request); err != nil {
		return nil, err
	}
	home, err := resolveRuntimeHome(m.config.RuntimeRoot, request.RuntimeHomeRef)
	if err != nil {
		return nil, err
	}
	created, err := ensurePrivateDirectory(home)
	if err != nil {
		return nil, &ExecutionError{Kind: FailureStart, Cause: err}
	}
	if created && activitySink != nil {
		activitySink(ActivityRuntimeHomeCreated)
	}

	resuming := strings.TrimSpace(request.SessionID) != ""
	argv := m.config.StartArgv
	if resuming {
		argv = m.config.ResumeArgv
	}
	return m.run(
		ctx,
		substituteArgv(argv, request.SessionID, home),
		home,
		request,
		resuming,
		deltaSink,
		sessionSink,
		activitySink,
	)
}

func (m *Manager) Cleanup(ctx context.Context, request CleanupRequest) error {
	if !m.Available() {
		return &ExecutionError{Kind: FailureUnavailable}
	}
	home, err := resolveRuntimeHome(m.config.RuntimeRoot, request.RuntimeHomeRef)
	if err != nil {
		return err
	}
	workDir := home
	if _, err := os.Stat(home); os.IsNotExist(err) {
		if _, err := ensurePrivateDirectory(m.config.RuntimeRoot); err != nil {
			return &ExecutionError{Kind: FailureCleanup, Cause: err}
		}
		workDir = m.config.RuntimeRoot
	} else if err != nil {
		return &ExecutionError{Kind: FailureCleanup, Cause: err}
	}
	if strings.TrimSpace(request.SessionID) != "" {
		if err := m.runCleanup(
			ctx,
			substituteArgv(m.config.ResetArgv, request.SessionID, home),
			workDir,
			request,
		); err != nil {
			return err
		}
	}
	if err := os.RemoveAll(home); err != nil {
		return &ExecutionError{Kind: FailureCleanup, Cause: err}
	}
	return nil
}

func (m *Manager) run(
	ctx context.Context,
	argv []string,
	home string,
	request ExecuteRequest,
	resuming bool,
	deltaSink DeltaSink,
	sessionSink SessionSink,
	activitySink ActivitySink,
) (*ExecuteResult, error) {
	execCtx, cancel := context.WithTimeout(ctx, m.config.Timeout)
	defer cancel()

	command := exec.CommandContext(execCtx, argv[0], argv[1:]...)
	command.Dir = home
	command.Env = append(
		restrictedEnv(),
		"PEERS_TOUCH_AGENT_ID="+request.AgentID,
		"PEERS_TOUCH_CONVERSATION_ID="+request.ConversationID,
		"PEERS_TOUCH_RUNTIME_PROFILE_ID="+request.RuntimeProfileID,
		"PEERS_TOUCH_EXTERNAL_SESSION_EPOCH="+fmt.Sprintf("%d", request.SessionEpoch),
		"PEERS_TOUCH_EXTERNAL_RUNTIME_HOME="+home,
	)
	configureProcessGroup(command)

	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, &ExecutionError{Kind: FailureStart, Cause: err}
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, &ExecutionError{Kind: FailureStart, Cause: err}
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		return nil, &ExecutionError{Kind: FailureStart, Cause: err}
	}
	if err := command.Start(); err != nil {
		return nil, &ExecutionError{Kind: FailureStart, Cause: err}
	}
	if activitySink != nil {
		activitySink(ActivityProcessStarted)
	}

	stderrCapture := &boundedCapture{limit: maxStderrCaptureLen}
	stderrDone := make(chan struct{})
	go func() {
		_, _ = io.Copy(stderrCapture, stderr)
		close(stderrDone)
	}()
	processDone := make(chan struct{})
	supervisorDone := superviseProcess(
		execCtx,
		command.Process,
		processDone,
		m.config.TerminationGrace,
	)

	var inputErr error
	if _, err := io.WriteString(stdin, request.Prompt); err != nil {
		inputErr = err
		cancel()
	}
	_ = stdin.Close()

	result, streamErr := consumeEvents(
		execCtx,
		stdout,
		request.SessionID,
		resuming,
		deltaSink,
		sessionSink,
		activitySink,
		cancel,
	)
	scanErr := result.scanError
	waitErr := command.Wait()
	close(processDone)
	<-supervisorDone
	shutdownErr := shutdownProcessGroup(command.Process, m.config.TerminationGrace)
	<-stderrDone

	switch {
	case inputErr != nil:
		return nil, &ExecutionError{Kind: FailureStart, Cause: inputErr}
	case streamErr != nil:
		return nil, streamErr
	case errors.Is(execCtx.Err(), context.DeadlineExceeded):
		return nil, &ExecutionError{Kind: FailureTimeout, Cause: execCtx.Err()}
	case errors.Is(execCtx.Err(), context.Canceled) && ctx.Err() != nil:
		return nil, ctx.Err()
	case scanErr != nil:
		return nil, &ExecutionError{Kind: FailureOutput, Cause: scanErr}
	case waitErr != nil:
		kind := FailureExit
		if resuming && resumeUnavailableText(stderrCapture.String()) {
			kind = FailureResumeUnavailable
		}
		return nil, &ExecutionError{
			Kind:     kind,
			ExitCode: exitCode(waitErr),
			Cause:    waitErr,
		}
	case shutdownErr != nil:
		return nil, &ExecutionError{Kind: FailureExit, Cause: shutdownErr}
	case !result.sessionPersisted || result.sessionID == "":
		return nil, &ExecutionError{
			Kind:  FailureOutput,
			Cause: errors.New("external runtime did not establish a session"),
		}
	case strings.TrimSpace(result.content.String()) == "":
		return nil, &ExecutionError{Kind: FailureEmptyResponse}
	default:
		return &ExecuteResult{
			SessionID: result.sessionID,
			Content:   result.content.String(),
			Streamed:  result.streamed,
		}, nil
	}
}

type streamResult struct {
	sessionID        string
	sessionPersisted bool
	content          strings.Builder
	streamed         bool
	scanError        error
}

func consumeEvents(
	ctx context.Context,
	stdout io.Reader,
	expectedSessionID string,
	resuming bool,
	deltaSink DeltaSink,
	sessionSink SessionSink,
	activitySink ActivitySink,
	cancel context.CancelFunc,
) (streamResult, error) {
	result := streamResult{
		sessionID:        strings.TrimSpace(expectedSessionID),
		sessionPersisted: resuming,
	}
	totalBytes := 0
	eventCount := 0
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 4096), maxOutputLineBytes)
	for scanner.Scan() {
		if ctx.Err() != nil {
			break
		}
		eventCount++
		totalBytes += len(scanner.Bytes()) + 1
		if eventCount > maxEventCount || totalBytes > maxOutputBytes {
			cancel()
			return result, &ExecutionError{
				Kind:  FailureOutput,
				Cause: errors.New("external runtime output exceeded its bound"),
			}
		}
		event, err := normalizeEvent(strings.TrimSpace(scanner.Text()))
		if err != nil {
			cancel()
			return result, &ExecutionError{Kind: FailureOutput, Cause: err}
		}
		if err := acceptSessionEvent(
			ctx,
			&result,
			event.sessionID,
			sessionSink,
			activitySink,
		); err != nil {
			cancel()
			return result, err
		}
		if event.failureCode != "" {
			cancel()
			kind := FailureExit
			if resuming && event.failureCode == "resume_unavailable" {
				kind = FailureResumeUnavailable
			}
			return result, &ExecutionError{
				Kind:  kind,
				Cause: errors.New(event.failureCode),
			}
		}
		if event.delta == nil {
			continue
		}
		if !result.sessionPersisted {
			cancel()
			return result, &ExecutionError{
				Kind: FailureOutput,
				Cause: errors.New(
					"external runtime emitted output before establishing a session",
				),
			}
		}
		if event.terminal &&
			event.delta.Type == "text" &&
			result.content.Len() > 0 {
			continue
		}
		if event.delta.Type == "text" {
			result.content.WriteString(event.delta.Content)
		}
		if deltaSink != nil {
			if err := deltaSink(ctx, *event.delta); err != nil {
				cancel()
				return result, err
			}
			result.streamed = true
		}
	}
	result.scanError = scanner.Err()
	return result, nil
}

func acceptSessionEvent(
	ctx context.Context,
	result *streamResult,
	sessionID string,
	sessionSink SessionSink,
	activitySink ActivitySink,
) error {
	if sessionID == "" {
		return nil
	}
	if result.sessionID != "" && sessionID != result.sessionID {
		return &ExecutionError{
			Kind:  FailureOutput,
			Cause: errors.New("external runtime changed the bound session"),
		}
	}
	result.sessionID = sessionID
	if result.sessionPersisted {
		return nil
	}
	if sessionSink == nil {
		return &ExecutionError{
			Kind:  FailureOutput,
			Cause: errors.New("external runtime session sink is unavailable"),
		}
	}
	if err := sessionSink(ctx, sessionID); err != nil {
		return err
	}
	result.sessionPersisted = true
	if activitySink != nil {
		activitySink(ActivitySessionCreated)
	}
	return nil
}

func (m *Manager) runCleanup(
	ctx context.Context,
	argv []string,
	home string,
	request CleanupRequest,
) error {
	execCtx, cancel := context.WithTimeout(ctx, m.config.Timeout)
	defer cancel()
	command := exec.CommandContext(execCtx, argv[0], argv[1:]...)
	command.Dir = home
	command.Env = append(
		restrictedEnv(),
		"PEERS_TOUCH_EXTERNAL_SESSION_ID="+request.SessionID,
		"PEERS_TOUCH_EXTERNAL_RUNTIME_HOME="+home,
	)
	configureProcessGroup(command)
	output, err := command.CombinedOutput()
	if errors.Is(execCtx.Err(), context.DeadlineExceeded) {
		_ = shutdownProcessGroup(command.Process, m.config.TerminationGrace)
		return &ExecutionError{Kind: FailureTimeout, Cause: execCtx.Err()}
	}
	if err != nil && !resumeUnavailableText(string(output)) {
		return &ExecutionError{
			Kind:     FailureCleanup,
			ExitCode: exitCode(err),
			Cause:    err,
		}
	}
	return nil
}

func validateExecuteRequest(request ExecuteRequest) error {
	if strings.TrimSpace(request.ActorPTID) == "" ||
		strings.TrimSpace(request.AgentID) == "" ||
		strings.TrimSpace(request.ConversationID) == "" ||
		strings.TrimSpace(request.RuntimeProfileID) == "" ||
		strings.TrimSpace(request.RuntimeHomeRef) == "" ||
		request.SessionEpoch == 0 ||
		strings.TrimSpace(request.Prompt) == "" {
		return &ExecutionError{Kind: FailureInvalidConfig}
	}
	return nil
}

func exitCode(err error) int {
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}
	return -1
}

type boundedCapture struct {
	value strings.Builder
	limit int
}

func (capture *boundedCapture) Write(value []byte) (int, error) {
	remaining := capture.limit - capture.value.Len()
	if remaining > 0 {
		if len(value) > remaining {
			_, _ = capture.value.Write(value[:remaining])
		} else {
			_, _ = capture.value.Write(value)
		}
	}
	return len(value), nil
}

func (capture *boundedCapture) String() string {
	return capture.value.String()
}
