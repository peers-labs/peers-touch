package cli

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
)

const (
	defaultTimeout          = 5 * time.Minute
	defaultTerminationGrace = 2 * time.Second
	maxOutputBytes          = 2 * 1024 * 1024
	maxOutputLineBytes      = 2 * 1024 * 1024
	maxStderrCaptureLen     = 64 * 1024
)

type FailureKind string

const (
	FailureInvalidCommand FailureKind = "invalid_command"
	FailureBinaryMissing  FailureKind = "binary_missing"
	FailureStart          FailureKind = "start_failed"
	FailureOutput         FailureKind = "output_failed"
	FailureTimeout        FailureKind = "timeout"
	FailureExit           FailureKind = "execution_failed"
	FailureEmptyResponse  FailureKind = "empty_response"
)

type ExecutionError struct {
	Kind     FailureKind
	Program  string
	ExitCode int
	Cause    error
}

func (e *ExecutionError) Error() string {
	program := filepath.Base(strings.TrimSpace(e.Program))
	switch e.Kind {
	case FailureInvalidCommand:
		return "CLI provider command is invalid"
	case FailureBinaryMissing:
		return fmt.Sprintf("CLI provider binary %q is unavailable", program)
	case FailureStart:
		return fmt.Sprintf("CLI provider %q could not start", program)
	case FailureOutput:
		return fmt.Sprintf("CLI provider %q output could not be processed", program)
	case FailureTimeout:
		return fmt.Sprintf("CLI provider %q timed out", program)
	case FailureExit:
		if e.ExitCode >= 0 {
			return fmt.Sprintf("CLI provider %q exited with status %d", program, e.ExitCode)
		}
		return fmt.Sprintf("CLI provider %q exited with an error", program)
	case FailureEmptyResponse:
		return fmt.Sprintf("CLI provider %q returned no assistant response", program)
	default:
		return "CLI provider execution failed"
	}
}

func (e *ExecutionError) Unwrap() error {
	return e.Cause
}

func IsFailureKind(err error, kind FailureKind) bool {
	var executionErr *ExecutionError
	return errors.As(err, &executionErr) && executionErr.Kind == kind
}

type Delta struct {
	Type    string
	Content string
}

type DeltaSink func(context.Context, Delta) error

type ExecuteRequest struct {
	ActorPTID      string
	AgentID        string
	ConversationID string
	Provider       string
	Model          string
	Effort         string
	Command        []string
	StartupArgs    []string
	Environment    map[string]string
	Timeout        time.Duration
	SystemPrompt   string
	Messages       []domain.Message
	AllowedRoots   []string
}

type ExecuteResult struct {
	Content  string
	Streamed bool
}

type Executor struct {
	WorkspaceManager *WorkspaceManager
	Timeout          time.Duration
	TerminationGrace time.Duration
}

func NewExecutor(workspaceManager *WorkspaceManager) *Executor {
	if workspaceManager == nil {
		workspaceManager = NewWorkspaceManager("")
	}
	return &Executor{
		WorkspaceManager: workspaceManager,
		Timeout:          defaultTimeout,
		TerminationGrace: defaultTerminationGrace,
	}
}

func (e *Executor) Execute(
	ctx context.Context,
	req *ExecuteRequest,
	sink DeltaSink,
) (*ExecuteResult, error) {
	if req == nil {
		return nil, &ExecutionError{Kind: FailureInvalidCommand}
	}
	if len(req.Command) == 0 || strings.TrimSpace(req.Command[0]) == "" {
		return nil, &ExecutionError{
			Kind:    FailureInvalidCommand,
			Program: strings.Join(req.Command, " "),
		}
	}
	program := req.Command[0]
	adapter := adapterName(program)
	delivery := promptMethod(adapter)
	if _, err := exec.LookPath(program); err != nil {
		return nil, &ExecutionError{
			Kind:    FailureBinaryMissing,
			Program: program,
			Cause:   err,
		}
	}

	sessionID := e.WorkspaceManager.SessionID()
	workDir, err := e.WorkspaceManager.Create(req.ActorPTID, sessionID)
	if err != nil {
		return nil, &ExecutionError{
			Kind:    FailureStart,
			Program: program,
			Cause:   err,
		}
	}
	defer func() {
		_ = e.WorkspaceManager.Cleanup(req.ActorPTID, sessionID)
	}()

	prompt := BuildConversationPrompt(req.SystemPrompt, req.Messages)
	args := append([]string{}, req.Command[1:]...)
	args = appendStartupArgs(args, req.StartupArgs, delivery)
	if delivery == PromptViaArgument {
		args = append(args, prompt)
	}

	timeout := req.Timeout
	if timeout <= 0 {
		timeout = e.Timeout
	}
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	process := exec.Command(program, args...)
	process.Dir = workDir
	configureProcessGroup(process)
	process.Env = append(restrictedEnv(),
		"RUST_LOG=error",
		"PEERS_TOUCH_AGENT_ID="+req.AgentID,
		"PEERS_TOUCH_CONVERSATION_ID="+req.ConversationID,
		"PEERS_TOUCH_PROVIDER="+req.Provider,
		"PEERS_TOUCH_MODEL="+req.Model,
		"PEERS_TOUCH_EFFORT="+req.Effort,
		"PEERS_TOUCH_CLI_ADAPTER="+adapter,
		"PEERS_TOUCH_AGENT_WORKSPACE="+workDir,
	)
	for key, value := range req.Environment {
		process.Env = append(process.Env, key+"="+value)
	}
	if len(req.AllowedRoots) > 0 {
		process.Env = append(
			process.Env,
			"PEERS_TOUCH_ALLOWED_ROOTS="+strings.Join(req.AllowedRoots, ":"),
		)
	}

	stdout, err := process.StdoutPipe()
	if err != nil {
		return nil, &ExecutionError{
			Kind:    FailureStart,
			Program: program,
			Cause:   err,
		}
	}
	stderr, err := process.StderrPipe()
	if err != nil {
		return nil, &ExecutionError{
			Kind:    FailureStart,
			Program: program,
			Cause:   err,
		}
	}

	var stdin io.WriteCloser
	if delivery == PromptViaStdin {
		stdin, err = process.StdinPipe()
		if err != nil {
			return nil, &ExecutionError{
				Kind:    FailureStart,
				Program: program,
				Cause:   err,
			}
		}
	}

	if err := process.Start(); err != nil {
		return nil, &ExecutionError{
			Kind:    FailureStart,
			Program: program,
			Cause:   err,
		}
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
		process.Process,
		processDone,
		e.TerminationGrace,
	)

	var inputErr error
	if stdin != nil {
		if _, err := io.WriteString(stdin, prompt); err != nil {
			inputErr = err
			cancel()
		}
		_ = stdin.Close()
	}

	var content strings.Builder
	totalOutputBytes := 0
	streamed := false
	streamError := ""
	var sinkErr error
	var outputErr error
	terminalSeen := false
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 4096), maxOutputLineBytes)
	for scanner.Scan() {
		if execCtx.Err() != nil {
			break
		}
		totalOutputBytes += len(scanner.Bytes()) + 1
		if totalOutputBytes > maxOutputBytes {
			outputErr = errors.New("CLI provider output exceeded the allowed limit")
			cancel()
			break
		}
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if terminalSeen {
			continue
		}

		eventType, eventContent, eventError, terminal := normalizeOutputLine(line)
		if eventError != "" {
			streamError = eventError
			cancel()
			break
		}
		if eventContent != "" {
			if eventType == "text" {
				content.WriteString(eventContent)
			}
			if sink != nil {
				if err := sink(execCtx, Delta{
					Type:    eventType,
					Content: eventContent,
				}); err != nil {
					sinkErr = err
					cancel()
					break
				}
				streamed = true
			}
		}
		if terminal {
			terminalSeen = true
		}
	}

	scanErr := scanner.Err()
	if scanErr != nil {
		cancel()
	}
	waitErr := process.Wait()
	close(processDone)
	<-supervisorDone
	shutdownErr := shutdownProcessGroup(process.Process, e.TerminationGrace)
	<-stderrDone

	if inputErr != nil {
		return nil, &ExecutionError{
			Kind:    FailureStart,
			Program: program,
			Cause:   inputErr,
		}
	}
	if sinkErr != nil {
		return nil, &ExecutionError{
			Kind:    FailureOutput,
			Program: program,
			Cause:   sinkErr,
		}
	}
	if outputErr != nil {
		return nil, &ExecutionError{
			Kind:    FailureOutput,
			Program: program,
			Cause:   outputErr,
		}
	}
	if streamError != "" {
		return nil, &ExecutionError{
			Kind:    FailureExit,
			Program: program,
			Cause:   errors.New(streamError),
		}
	}
	if execCtx.Err() != nil {
		kind := FailureTimeout
		if errors.Is(execCtx.Err(), context.Canceled) &&
			!errors.Is(execCtx.Err(), context.DeadlineExceeded) {
			return nil, execCtx.Err()
		}
		return nil, &ExecutionError{
			Kind:    kind,
			Program: program,
			Cause:   execCtx.Err(),
		}
	}
	if scanErr != nil {
		return nil, &ExecutionError{
			Kind:    FailureOutput,
			Program: program,
			Cause:   scanErr,
		}
	}
	if waitErr != nil {
		exitCode := -1
		var exitErr *exec.ExitError
		if errors.As(waitErr, &exitErr) {
			exitCode = exitErr.ExitCode()
		}
		cause := waitErr
		if stderrText := strings.TrimSpace(stderrCapture.String()); stderrText != "" {
			cause = fmt.Errorf("%w: %s", waitErr, stderrText)
		}
		return nil, &ExecutionError{
			Kind:     FailureExit,
			Program:  program,
			ExitCode: exitCode,
			Cause:    cause,
		}
	}
	if shutdownErr != nil {
		return nil, &ExecutionError{
			Kind:    FailureExit,
			Program: program,
			Cause:   shutdownErr,
		}
	}
	if strings.TrimSpace(content.String()) == "" {
		return nil, &ExecutionError{
			Kind:    FailureEmptyResponse,
			Program: program,
		}
	}

	return &ExecuteResult{
		Content:  content.String(),
		Streamed: streamed,
	}, nil
}

func normalizeOutputLine(line string) (eventType, content, errorMessage string, terminal bool) {
	var event map[string]any
	if err := json.Unmarshal([]byte(line), &event); err != nil {
		if strings.HasPrefix(line, "{") || strings.HasPrefix(line, "[") {
			return "", "", "", false
		}
		return "text", line + "\n", "", false
	}

	rawType, _ := event["type"].(string)
	switch strings.ToLower(strings.TrimSpace(rawType)) {
	case "error", "turn.failed", "failed", "turn.error":
		return "", "", extractErrorMessage(event), false
	case "thinking", "reasoning":
		return "thinking", extractContent(event), "", false
	case "done", "complete", "completed", "end", "turn.complete",
		"turn.completed", "turn.done":
		return "text", extractContent(event), "", true
	case "thread.started", "turn.started", "thread.created", "turn.created",
		"initialized", "progress", "status", "stage", "tool_use", "tool_result":
		return "", "", "", false
	case "item.completed":
		item, _ := event["item"].(map[string]any)
		itemType, _ := item["type"].(string)
		if itemType == "reasoning" || itemType == "thinking" {
			return "thinking", extractContent(item), "", false
		}
		return "text", extractContent(item), "", false
	default:
		return "text", extractContent(event), "", false
	}
}

func extractErrorMessage(event map[string]any) string {
	if message, ok := event["message"].(string); ok && message != "" {
		return message
	}
	if nested, ok := event["error"].(map[string]any); ok {
		if message, ok := nested["message"].(string); ok && message != "" {
			return message
		}
	}
	if message, ok := event["error"].(string); ok && message != "" {
		return message
	}
	return "CLI provider reported an error"
}

func extractContent(event map[string]any) string {
	for _, key := range []string{"content", "text", "delta", "result"} {
		if value, ok := event[key].(string); ok && value != "" {
			return value
		}
	}
	if content, ok := event["content"].([]any); ok {
		var parts []string
		for _, item := range content {
			if object, ok := item.(map[string]any); ok {
				if text, ok := object["text"].(string); ok && text != "" {
					parts = append(parts, text)
				}
			}
		}
		if len(parts) > 0 {
			return strings.Join(parts, "")
		}
	}
	if message, ok := event["message"].(map[string]any); ok {
		return extractContent(message)
	}
	if item, ok := event["item"].(map[string]any); ok {
		return extractContent(item)
	}
	return ""
}

type CliVerifyResult struct {
	Available   bool
	Program     string
	Path        string
	Error       string
	InstallHint string
}

func VerifyCliBinary(command []string) CliVerifyResult {
	if len(command) == 0 || strings.TrimSpace(command[0]) == "" {
		return CliVerifyResult{
			Available: false,
			Error:     "CLI provider command is invalid",
		}
	}

	program := command[0]
	path, err := exec.LookPath(program)
	if err != nil {
		return CliVerifyResult{
			Available:   false,
			Program:     program,
			InstallHint: installHint(adapterName(program)),
		}
	}

	return CliVerifyResult{
		Available: true,
		Program:   program,
		Path:      path,
	}
}

func appendStartupArgs(
	commandArgs []string,
	startupArgs []string,
	delivery PromptDelivery,
) []string {
	if len(startupArgs) == 0 {
		return commandArgs
	}
	if delivery == PromptViaStdin &&
		len(commandArgs) > 0 &&
		commandArgs[len(commandArgs)-1] == "-" {
		result := append([]string{}, commandArgs[:len(commandArgs)-1]...)
		result = append(result, startupArgs...)
		return append(result, "-")
	}
	return append(commandArgs, startupArgs...)
}

func installHint(adapter string) string {
	switch adapter {
	case "trae":
		return "Install TRAE CLI and ensure traecli is available on PATH"
	case "codex":
		return "Install Codex CLI and ensure codex is available on PATH"
	case "claude":
		return "Install Claude CLI and ensure claude is available on PATH"
	case "cursor":
		return "Install Cursor Agent and ensure cursor-agent is available on PATH"
	default:
		return "Install the CLI provider and ensure it is available on PATH"
	}
}

func restrictedEnv() []string {
	allowed := []string{
		"HOME",
		"LANG",
		"LC_ALL",
		"SSL_CERT_DIR",
		"SSL_CERT_FILE",
		"TEMP",
		"TMP",
		"TMPDIR",
		"TZ",
	}
	env := make([]string, 0, len(allowed)+1)
	for _, key := range allowed {
		if value, ok := os.LookupEnv(key); ok {
			env = append(env, key+"="+value)
		}
	}
	pathDirs := []string{
		os.ExpandEnv("$HOME/.local/bin"),
		os.ExpandEnv("$HOME/.cargo/bin"),
		"/usr/local/bin",
		"/opt/homebrew/bin",
	}
	if existingPath := os.Getenv("PATH"); existingPath != "" {
		pathDirs = append(pathDirs, existingPath)
	}
	return append(env, "PATH="+strings.Join(pathDirs, string(os.PathListSeparator)))
}

func superviseProcess(
	ctx context.Context,
	process *os.Process,
	processDone <-chan struct{},
	grace time.Duration,
) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		defer close(done)
		select {
		case <-processDone:
			return
		case <-ctx.Done():
		}

		_ = terminateProcessGroup(process)
		if grace <= 0 {
			grace = defaultTerminationGrace
		}
		timer := time.NewTimer(grace)
		defer timer.Stop()
		select {
		case <-processDone:
		case <-timer.C:
			_ = killProcessGroup(process)
		}
	}()
	return done
}

type boundedCapture struct {
	data  []byte
	limit int
}

func (w *boundedCapture) Write(data []byte) (int, error) {
	remaining := w.limit - len(w.data)
	if remaining > 0 {
		if remaining > len(data) {
			remaining = len(data)
		}
		w.data = append(w.data, data[:remaining]...)
	}
	return len(data), nil
}

func (w *boundedCapture) String() string {
	return string(w.data)
}
