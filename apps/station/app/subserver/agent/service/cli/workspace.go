package cli

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli/environment"
)

const defaultBaseDir = "/var/lib/peers-touch/agent-workspaces"

type WorkspaceManager struct {
	BaseDir    string
	SourceRepo string
}

func NewWorkspaceManager(sourceRepo string) *WorkspaceManager {
	return &WorkspaceManager{
		BaseDir:    WorkspaceBaseDir(),
		SourceRepo: sourceRepo,
	}
}

// WorkspaceBaseDir returns the configured root for per-actor agent
// workspaces. The same root owns managed CLI runtimes.
func WorkspaceBaseDir() string {
	if base := strings.TrimSpace(os.Getenv("PEERS_AGENT_WORKSPACE_BASE")); base != "" {
		return base
	}
	return defaultBaseDir
}

func (m *WorkspaceManager) Create(actorPTID, sessionID string) (string, error) {
	dir, err := m.workspaceDir(actorPTID, sessionID)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(dir), 0o700); err != nil {
		return "", fmt.Errorf("create workspace parent: %w", err)
	}

	if m.SourceRepo != "" {
		cmd := exec.Command("git", "worktree", "add", "--detach", dir, "HEAD")
		cmd.Dir = m.SourceRepo
		if out, err := cmd.CombinedOutput(); err != nil {
			return "", fmt.Errorf("git worktree add: %s: %w", string(out), err)
		}
	} else {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return "", fmt.Errorf("create workspace dir: %w", err)
		}
	}

	return dir, nil
}

func (m *WorkspaceManager) Cleanup(actorPTID, sessionID string) error {
	dir, err := m.workspaceDir(actorPTID, sessionID)
	if err != nil {
		return err
	}

	if m.SourceRepo != "" {
		cmd := exec.Command("git", "worktree", "remove", "--force", dir)
		cmd.Dir = m.SourceRepo
		_ = cmd.Run()
	}

	return os.RemoveAll(dir)
}

func (m *WorkspaceManager) SessionID() string {
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		panic("cannot generate CLI session identity")
	}
	return "s-" + hex.EncodeToString(id[:])
}

func (m *WorkspaceManager) workspaceDir(actorPTID, sessionID string) (string, error) {
	root, err := environment.ActorRoot(m.BaseDir, actorPTID)
	if err != nil {
		return "", err
	}
	if sessionID == "" || sessionID == "." || sessionID == ".." || strings.ContainsAny(sessionID, `/\`) {
		return "", fmt.Errorf("CLI session identity is invalid")
	}
	return filepath.Join(root, "workspaces", sessionID), nil
}

func (m *WorkspaceManager) StateRoot(actorPTID, providerID string) (string, error) {
	root, err := environment.ActorRoot(m.BaseDir, actorPTID)
	if err != nil {
		return "", err
	}
	return environment.ToolRoot(root, providerID), nil
}
