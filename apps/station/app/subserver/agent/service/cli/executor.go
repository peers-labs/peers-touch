package cli

import (
	"bufio"
	"context"
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
	process.Env = append(os.Environ(),
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

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	for scanner.Scan() {
		if execCtx.Err() != nil {
			break
		}
		line := scanner.Text()
		sink("text", map[string]any{
			"content": line + "\n",
		})
	}
	if scanErr := scanner.Err(); scanErr != nil && execCtx.Err() == nil {
		return fmt.Errorf("read cli stdout: %w", scanErr)
	}

	stderrBytes, _ := io.ReadAll(stderr)
	stderrStr := strings.TrimSpace(string(stderrBytes))

	if err := process.Wait(); err != nil {
		exitMsg := stderrStr
		if exitMsg == "" {
			exitMsg = err.Error()
		}
		return fmt.Errorf("CLI provider exited with error: %s", exitMsg)
	}

	sink("done", map[string]any{
		"model":          req.Model,
		"executionOwner": "station-cli",
	})

	return nil
}

func VerifyCliBinary(cliCommand string) map[string]any {
	cmd, err := NormalizeCommand(cliCommand)
	if err != nil {
		return map[string]any{
			"available": false,
			"error":     err.Error(),
		}
	}

	path, lookErr := exec.LookPath(cmd.Program)
	if lookErr != nil {
		return map[string]any{
			"available":    false,
			"program":      cmd.Program,
			"install_hint": installHint(cmd.AdapterName),
		}
	}

	return map[string]any{
		"available": true,
		"program":   cmd.Program,
		"path":      path,
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
