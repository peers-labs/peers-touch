package cli

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const defaultBaseDir = "/var/lib/peers-touch/agent-workspaces"

type WorkspaceManager struct {
	BaseDir   string
	SourceRepo string
}

func NewWorkspaceManager(sourceRepo string) *WorkspaceManager {
	base := os.Getenv("PEERS_AGENT_WORKSPACE_BASE")
	if base == "" {
		base = defaultBaseDir
	}
	return &WorkspaceManager{
		BaseDir:    base,
		SourceRepo: sourceRepo,
	}
}

func (m *WorkspaceManager) Create(actorID, sessionID string) (string, error) {
	dir := filepath.Join(m.BaseDir, actorID, sessionID)
	if err := os.MkdirAll(filepath.Dir(dir), 0o755); err != nil {
		return "", fmt.Errorf("create workspace parent: %w", err)
	}

	if m.SourceRepo != "" {
		cmd := exec.Command("git", "worktree", "add", "--detach", dir, "HEAD")
		cmd.Dir = m.SourceRepo
		if out, err := cmd.CombinedOutput(); err != nil {
			return "", fmt.Errorf("git worktree add: %s: %w", string(out), err)
		}
	} else {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", fmt.Errorf("create workspace dir: %w", err)
		}
	}

	return dir, nil
}

func (m *WorkspaceManager) Cleanup(actorID, sessionID string) error {
	dir := filepath.Join(m.BaseDir, actorID, sessionID)

	if m.SourceRepo != "" {
		cmd := exec.Command("git", "worktree", "remove", "--force", dir)
		cmd.Dir = m.SourceRepo
		_ = cmd.Run()
	}

	return os.RemoveAll(dir)
}

func (m *WorkspaceManager) SessionID() string {
	return fmt.Sprintf("s-%d", time.Now().UnixMilli())
}
