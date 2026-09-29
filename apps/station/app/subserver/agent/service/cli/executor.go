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
	defaultTimeout      = 5 * time.Minute
	maxOutputLineBytes  = 2 * 1024 * 1024
	maxStderrCaptureLen = 64 * 1024
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
	CliCommand     string
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
}

func NewExecutor(workspaceManager *WorkspaceManager) *Executor {
	if workspaceManager == nil {
		workspaceManager = NewWorkspaceManager("")
	}
	return &Executor{
		WorkspaceManager: workspaceManager,
		Timeout:          defaultTimeout,
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
	command, err := NormalizeCommand(req.CliCommand)
	if err != nil {
		return nil, &ExecutionError{
			Kind:    FailureInvalidCommand,
			Program: req.CliCommand,
			Cause:   err,
		}
	}
	if _, err := exec.LookPath(command.Program); err != nil {
		return nil, &ExecutionError{
			Kind:    FailureBinaryMissing,
			Program: command.Program,
			Cause:   err,
		}
	}

	sessionID := e.WorkspaceManager.SessionID()
	workDir, err := e.WorkspaceManager.Create(req.ActorPTID, sessionID)
	if err != nil {
		return nil, &ExecutionError{
			Kind:    FailureStart,
			Program: command.Program,
			Cause:   err,
		}
	}
	defer func() {
		_ = e.WorkspaceManager.Cleanup(req.ActorPTID, sessionID)
	}()

	prompt := BuildConversationPrompt(req.SystemPrompt, req.Messages)
	args := append([]string{}, command.Args...)
	if command.PromptMethod == PromptViaArgument {
		args = append(args, prompt)
	}

	timeout := e.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	process := exec.CommandContext(execCtx, command.Program, args...)
	process.Dir = workDir
	process.Env = append(enrichedEnv(),
		"RUST_LOG=error",
		"PEERS_TOUCH_AGENT_ID="+req.AgentID,
		"PEERS_TOUCH_CONVERSATION_ID="+req.ConversationID,
		"PEERS_TOUCH_PROVIDER="+req.Provider,
		"PEERS_TOUCH_MODEL="+req.Model,
		"PEERS_TOUCH_EFFORT="+req.Effort,
		"PEERS_TOUCH_CLI_ADAPTER="+command.AdapterName,
		"PEERS_TOUCH_AGENT_WORKSPACE="+workDir,
	)
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
			Program: command.Program,
			Cause:   err,
		}
	}
	stderr, err := process.StderrPipe()
	if err != nil {
		return nil, &ExecutionError{
			Kind:    FailureStart,
			Program: command.Program,
			Cause:   err,
		}
	}

	var stdin io.WriteCloser
	if command.PromptMethod == PromptViaStdin {
		stdin, err = process.StdinPipe()
		if err != nil {
			return nil, &ExecutionError{
				Kind:    FailureStart,
				Program: command.Program,
				Cause:   err,
			}
		}
	}

	if err := process.Start(); err != nil {
		return nil, &ExecutionError{
			Kind:    FailureStart,
			Program: command.Program,
			Cause:   err,
		}
	}

	stderrCapture := &boundedCapture{limit: maxStderrCaptureLen}
	stderrDone := make(chan struct{})
	go func() {
		_, _ = io.Copy(stderrCapture, stderr)
		close(stderrDone)
	}()

	if stdin != nil {
		if _, err := io.WriteString(stdin, prompt); err != nil {
			_ = process.Process.Kill()
			_ = stdin.Close()
			_ = process.Wait()
			<-stderrDone
			return nil, &ExecutionError{
				Kind:    FailureStart,
				Program: command.Program,
				Cause:   err,
			}
		}
		_ = stdin.Close()
	}

	var content strings.Builder
	streamed := false
	streamError := ""
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 4096), maxOutputLineBytes)
	for scanner.Scan() {
		if execCtx.Err() != nil {
			break
		}
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		eventType, eventContent, eventError, terminal := normalizeOutputLine(line)
		if eventError != "" {
			streamError = eventError
			_ = process.Process.Kill()
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
					_ = process.Process.Kill()
					_ = process.Wait()
					<-stderrDone
					return nil, &ExecutionError{
						Kind:    FailureOutput,
						Program: command.Program,
						Cause:   err,
					}
				}
				streamed = true
			}
		}
		if terminal {
			break
		}
	}

	scanErr := scanner.Err()
	waitErr := process.Wait()
	<-stderrDone

	if execCtx.Err() != nil {
		kind := FailureTimeout
		if errors.Is(execCtx.Err(), context.Canceled) &&
			!errors.Is(execCtx.Err(), context.DeadlineExceeded) {
			return nil, execCtx.Err()
		}
		return nil, &ExecutionError{
			Kind:    kind,
			Program: command.Program,
			Cause:   execCtx.Err(),
		}
	}
	if scanErr != nil {
		return nil, &ExecutionError{
			Kind:    FailureOutput,
			Program: command.Program,
			Cause:   scanErr,
		}
	}
	if streamError != "" {
		return nil, &ExecutionError{
			Kind:    FailureExit,
			Program: command.Program,
			Cause:   errors.New(streamError),
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
			Program:  command.Program,
			ExitCode: exitCode,
			Cause:    cause,
		}
	}
	if strings.TrimSpace(content.String()) == "" {
		return nil, &ExecutionError{
			Kind:    FailureEmptyResponse,
			Program: command.Program,
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

func VerifyCliBinary(cliCommand string) CliVerifyResult {
	command, err := NormalizeCommand(cliCommand)
	if err != nil {
		return CliVerifyResult{
			Available: false,
			Error:     err.Error(),
		}
	}

	path, err := exec.LookPath(command.Program)
	if err != nil {
		return CliVerifyResult{
			Available:   false,
			Program:     command.Program,
			InstallHint: installHint(command.AdapterName),
		}
	}

	return CliVerifyResult{
		Available: true,
		Program:   command.Program,
		Path:      path,
	}
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

func enrichedEnv() []string {
	env := os.Environ()
	pathDirs := []string{
		os.ExpandEnv("$HOME/.local/bin"),
		os.ExpandEnv("$HOME/.cargo/bin"),
		"/usr/local/bin",
		"/opt/homebrew/bin",
	}
	if existingPath := os.Getenv("PATH"); existingPath != "" {
		pathDirs = append(pathDirs, existingPath)
	}
	newPath := "PATH=" + strings.Join(pathDirs, ":")
	for index, value := range env {
		if strings.HasPrefix(value, "PATH=") {
			env[index] = newPath
			return env
		}
	}
	return append(env, newPath)
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
