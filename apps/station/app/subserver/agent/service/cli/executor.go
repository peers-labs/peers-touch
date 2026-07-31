package cli

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"
)

const defaultTimeout = 5 * time.Minute

type EventSink func(eventType string, data map[string]any)

type CliTurnRequest struct {
	ConversationID   string
	AgentID          string
	UserInput        string
	CliCommand       string
	Identity         string
	AgentConfigPrompt string
	Provider         string
	Model            string
	Effort           string
	RuntimeBackend   string
	AllowedRoots     []string
}

type CliExecutor struct {
	WorkspaceMgr *WorkspaceManager
	Timeout      time.Duration
}

type CliVerifyResult struct {
	Available   bool
	Program     string
	Path        string
	Error       string
	InstallHint string
}

func NewCliExecutor(workspaceMgr *WorkspaceManager) *CliExecutor {
	return &CliExecutor{
		WorkspaceMgr: workspaceMgr,
		Timeout:      defaultTimeout,
	}
}

func (e *CliExecutor) Execute(ctx context.Context, req *CliTurnRequest, actorID string, sink EventSink) error {
	cmd, err := NormalizeCommand(req.CliCommand)
	if err != nil {
		return fmt.Errorf("normalize cli command: %w", err)
	}

	if _, lookErr := exec.LookPath(cmd.Program); lookErr != nil {
		return fmt.Errorf("cli binary not found: %s (install it on this Station)", cmd.Program)
	}

	sessionID := e.WorkspaceMgr.SessionID()
	workDir, err := e.WorkspaceMgr.Create(actorID, sessionID)
	if err != nil {
		return fmt.Errorf("create workspace: %w", err)
	}
	defer func() {
		go e.WorkspaceMgr.Cleanup(actorID, sessionID)
	}()

	prompt := BuildCliPrompt(req.Identity, req.AgentConfigPrompt, req.UserInput)

	args := append([]string{}, cmd.Args...)
	if cmd.PromptMethod == PromptViaArgument {
		args = append(args, prompt)
	}

	timeout := e.Timeout
	if timeout == 0 {
		timeout = defaultTimeout
	}
	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	process := exec.CommandContext(execCtx, cmd.Program, args...)
	process.Dir = workDir
	process.Env = append(enrichedEnv(),
		"RUST_LOG=error",
		"PEERS_TOUCH_AGENT_ID="+req.AgentID,
		"PEERS_TOUCH_CONVERSATION_ID="+req.ConversationID,
		"PEERS_TOUCH_PROVIDER="+req.Provider,
		"PEERS_TOUCH_MODEL="+req.Model,
		"PEERS_TOUCH_EFFORT="+req.Effort,
		"PEERS_TOUCH_CLI_ADAPTER="+cmd.AdapterName,
		"PEERS_TOUCH_AGENT_WORKSPACE="+workDir,
	)
	if len(req.AllowedRoots) > 0 {
		process.Env = append(process.Env, "PEERS_TOUCH_ALLOWED_ROOTS="+strings.Join(req.AllowedRoots, ":"))
	}

	stdout, err := process.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}
	stderr, err := process.StderrPipe()
	if err != nil {
		return fmt.Errorf("stderr pipe: %w", err)
	}

	var stdinPipe io.WriteCloser
	if cmd.PromptMethod == PromptViaStdin {
		stdinPipe, err = process.StdinPipe()
		if err != nil {
			return fmt.Errorf("stdin pipe: %w", err)
		}
	}

	sink("progress", map[string]any{
		"step":    "cli_started",
		"command": cmd.Program,
	})

	if err := process.Start(); err != nil {
		return fmt.Errorf("start cli process: %w", err)
	}

	if stdinPipe != nil {
		_, _ = io.WriteString(stdinPipe, prompt)
		_ = stdinPipe.Close()
	}

	var streamErrMsg string
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	for scanner.Scan() {
		if execCtx.Err() != nil {
			break
		}
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}

		var event map[string]any
		if err := json.Unmarshal([]byte(trimmed), &event); err != nil {
			if strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") {
				continue
			}
			sink("text", map[string]any{
				"content": trimmed + "\n",
			})
			continue
		}

		eventType, _ := event["type"].(string)
		switch eventType {
		case "message", "assistant", "response", "delta":
			if text := extractCliContent(event); text != "" {
				sink("text", map[string]any{"content": text})
			}
		case "thinking", "reasoning":
			if text := extractCliContent(event); text != "" {
				sink("thinking", map[string]any{"content": text})
			}
		case "error":
			streamErrMsg = extractCliErrorMessage(event)
			_ = process.Process.Kill()
		case "turn.failed", "failed", "turn.error":
			streamErrMsg = extractCliErrorMessage(event)
			_ = process.Process.Kill()
		case "done", "complete", "completed", "end", "turn.complete", "turn.completed", "turn.done":
			goto scanDone
		case "thread.started", "turn.started", "thread.created", "turn.created",
			"initialized", "progress", "status", "stage", "tool_use", "tool_result":
		case "item.completed":
			if item, ok := event["item"].(map[string]any); ok {
				itemType, _ := item["type"].(string)
				if text := extractCliContent(item); text != "" {
					if itemType == "reasoning" || itemType == "thinking" {
						sink("thinking", map[string]any{"content": text})
					} else {
						sink("text", map[string]any{"content": text})
					}
				}
			}
		default:
			if text := extractCliContent(event); text != "" {
				sink("text", map[string]any{"content": text})
			}
		}
	}
scanDone:
	if scanErr := scanner.Err(); scanErr != nil && execCtx.Err() == nil {
		return fmt.Errorf("read cli stdout: %w", scanErr)
	}

	stderrBytes, _ := io.ReadAll(stderr)
	stderrStr := strings.TrimSpace(string(stderrBytes))

	if err := process.Wait(); err != nil {
		if streamErrMsg != "" {
			return fmt.Errorf("CLI provider error: %s", streamErrMsg)
		}
		exitMsg := stderrStr
		if exitMsg == "" {
			exitMsg = err.Error()
		}
		return fmt.Errorf("CLI provider exited with error: %s", exitMsg)
	}

	if streamErrMsg != "" {
		return fmt.Errorf("CLI provider error: %s", streamErrMsg)
	}

	sink("done", map[string]any{
		"model":          req.Model,
		"executionOwner": "station-cli",
	})

	return nil
}

func extractCliErrorMessage(event map[string]any) string {
	if msg, ok := event["message"].(string); ok && msg != "" {
		return msg
	}
	if errObj, ok := event["error"].(map[string]any); ok {
		if msg, ok := errObj["message"].(string); ok && msg != "" {
			return msg
		}
	}
	if msg, ok := event["error"].(string); ok && msg != "" {
		return msg
	}
	return "CLI error"
}

func extractCliContent(event map[string]any) string {
	if content, ok := event["content"].(string); ok && content != "" {
		return content
	}
	if text, ok := event["text"].(string); ok && text != "" {
		return text
	}
	if delta, ok := event["delta"].(string); ok && delta != "" {
		return delta
	}
	if contentArr, ok := event["content"].([]any); ok {
		var parts []string
		for _, item := range contentArr {
			if obj, ok := item.(map[string]any); ok {
				if objType, _ := obj["type"].(string); objType == "text" {
					if t, ok := obj["text"].(string); ok && t != "" {
						parts = append(parts, t)
					}
				}
			}
		}
		if len(parts) > 0 {
			return strings.Join(parts, "")
		}
	}
	if msg, ok := event["message"].(map[string]any); ok {
		return extractCliContent(msg)
	}
	return ""
}

// FetchModels executes a provider's models_command and parses the output.
// Supports both plain-text (one model per line) and JSON ({"models":[{"slug":...}]}).
func FetchModels(modelsCommand string) ([]string, error) {
	parts := splitCommandLine(modelsCommand)
	if len(parts) == 0 {
		return nil, fmt.Errorf("models_command is empty")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, parts[0], parts[1:]...)
	cmd.Env = append(enrichedEnv(), "RUST_LOG=error")
	out, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return nil, fmt.Errorf("execute models_command %q: %w: %s", modelsCommand, err, string(exitErr.Stderr))
		}
		return nil, fmt.Errorf("execute models_command %q: %w", modelsCommand, err)
	}

	return parseModelsOutput(string(out)), nil
}

func parseModelsOutput(raw string) []string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}

	if strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") {
		return parseModelsJSON(trimmed)
	}

	var models []string
	for _, line := range strings.Split(trimmed, "\n") {
		m := strings.TrimSpace(line)
		if m != "" {
			models = append(models, m)
		}
	}
	return models
}

func parseModelsJSON(raw string) []string {
	// Lightweight JSON parsing without importing encoding/json into this package:
	// Look for "slug":"<value>" or "id":"<value>" patterns.
	// For a robust implementation, the handler layer should parse with encoding/json.
	// This function is a fallback; prefer handler-level JSON parsing.
	var models []string
	for _, line := range strings.Split(raw, "\"slug\":\"") {
		if len(models) == 0 && !strings.Contains(line, "\"") {
			continue
		}
		if idx := strings.Index(line, "\""); idx > 0 {
			models = append(models, line[:idx])
		}
	}
	if len(models) > 0 {
		return models
	}
	// Fallback: try "id" field
	for _, line := range strings.Split(raw, "\"id\":\"") {
		if idx := strings.Index(line, "\""); idx > 0 {
			models = append(models, line[:idx])
		}
	}
	return models
}

func VerifyCliBinary(cliCommand string) CliVerifyResult {
	cmd, err := NormalizeCommand(cliCommand)
	if err != nil {
		return CliVerifyResult{
			Available: false,
			Error:     err.Error(),
		}
	}

	path, lookErr := exec.LookPath(cmd.Program)
	if lookErr != nil {
		return CliVerifyResult{
			Available:  false,
			Program:    cmd.Program,
			InstallHint: installHint(cmd.AdapterName),
		}
	}

	return CliVerifyResult{
		Available: true,
		Program:   cmd.Program,
		Path:      path,
	}
}

func installHint(adapter string) string {
	switch adapter {
	case "trae":
		return "Install TRAE CLI: https://docs.trae.ai/cli/install"
	case "codex":
		return "Install Codex: npm install -g @openai/codex"
	case "claude":
		return "Install Claude CLI: https://docs.anthropic.com/en/docs/claude-cli"
	case "cursor":
		return "Install Cursor Agent: https://docs.cursor.com/agent/cli"
	default:
		return "Install the CLI tool and ensure it is in PATH"
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
	existingPath := os.Getenv("PATH")
	if existingPath != "" {
		pathDirs = append(pathDirs, existingPath)
	}
	newPath := "PATH=" + strings.Join(pathDirs, ":")
	for i, e := range env {
		if strings.HasPrefix(e, "PATH=") {
			env[i] = newPath
			return env
		}
	}
	return append(env, newPath)
}
