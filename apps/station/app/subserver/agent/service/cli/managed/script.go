package managed

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli/environment"
)

// Vendor packages include their own runtime and can exceed 180 MB. Keep a
// finite installation deadline without treating normal slow links as failures.
const scriptInstallTimeout = 30 * time.Minute

// installScriptTool installs a vendor-script-distributed adapter (Cursor CLI)
// by running the vendor's official installer against a private staging HOME.
// The verified tree is activated atomically and exposed through a shared wrapper.
func installScriptTool(
	ctx context.Context,
	root string,
	env *installEnv,
	spec Spec,
	reporter *progress,
) error {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		return fmt.Errorf("script install is supported only on linux and darwin")
	}
	reporter.report(phaseDownload, 10, "downloading installer script")
	script, err := downloadText(ctx, spec.ScriptURL)
	if err != nil {
		return fmt.Errorf("download installer script: %w", err)
	}
	if !strings.HasPrefix(strings.TrimSpace(script), "#!") {
		return fmt.Errorf("vendor endpoint did not return an installer script")
	}

	toolsDir := filepath.Join(root, "tools")
	if err := os.MkdirAll(toolsDir, 0o700); err != nil {
		return fmt.Errorf("create managed tools dir: %w", err)
	}
	staging, err := os.MkdirTemp(toolsDir, fmt.Sprintf(".%s-install-*", spec.ProviderID))
	if err != nil {
		return fmt.Errorf("create staging dir: %w", err)
	}
	stagingHome := filepath.Join(staging, "home")
	if err := os.MkdirAll(filepath.Join(stagingHome, ".local", "bin"), 0o700); err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = os.RemoveAll(staging)
		}
	}()

	reporter.report(phaseInstall, 5, "running vendor installer")
	runCtx, cancel := context.WithTimeout(ctx, scriptInstallTimeout)
	defer cancel()
	cmd := exec.CommandContext(runCtx, "bash", "-s")
	cli.PrepareCommand(cmd)
	defer cli.CleanupCommand(cmd)
	cmd.Stdin = strings.NewReader(script)
	cmd.Env, err = environment.Build(staging, nil, nil)
	if err != nil {
		return err
	}
	cmd.Dir = staging
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start vendor installer: %w", err)
	}
	ticks := 0
	scanner := bufio.NewScanner(stderr)
	scanner.Buffer(make([]byte, 0, 64*1024), 256*1024)
	scanner.Split(scanInstallerProgress)
	for scanner.Scan() {
		if strings.TrimSpace(scanner.Text()) == "" {
			continue
		}
		ticks++
		if percent := 10 + ticks*3; percent <= 82 {
			reporter.report(phaseInstall, percent, "installing CLI runtime")
		}
	}
	if err := scanner.Err(); err != nil {
		_ = cmd.Cancel()
		_ = cmd.Wait()
		return fmt.Errorf("read installer progress: %w", err)
	}
	if err := cmd.Wait(); err != nil {
		if runCtx.Err() != nil {
			return runCtx.Err()
		}
		return fmt.Errorf("vendor installer failed: %w", err)
	}

	producedCommand, err := locateScriptBinary(stagingHome, spec.ScriptCommands)
	if err != nil {
		return err
	}
	// Cursor's installer has shipped the shim as both "cursor-agent" and
	// "agent"; normalize onto the catalog command so the wrapper path is
	// stable across installer versions.
	if err := canonicalizeScriptBinary(stagingHome, producedCommand, spec.Command); err != nil {
		return err
	}

	reporter.report(phaseVerify, 10, "verifying adapter")
	if err := probeCommand(ctx, producedCommand, env, nil); err != nil {
		return fmt.Errorf("verify staged %s: %w", spec.Command, err)
	}
	if err := rewriteStagedSymlinks(staging); err != nil {
		return err
	}

	reporter.report(phaseActivate, 10, "activating adapter")
	if err := activateTool(ctx, env, spec, staging, writeScriptWrapper); err != nil {
		return fmt.Errorf("activate %s: %w", spec.ProviderID, err)
	}
	committed = true
	_ = os.RemoveAll(staging)

	return nil
}

// curl's progress bar terminates updates with carriage returns. ScanLines
// buffers them until exit and can exhaust the token limit during a download.
func scanInstallerProgress(data []byte, atEOF bool) (int, []byte, error) {
	if index := bytes.IndexAny(data, "\r\n"); index >= 0 {
		return index + 1, data[:index], nil
	}
	if atEOF && len(data) > 0 {
		return len(data), data, nil
	}
	return 0, nil, nil
}

// canonicalizeScriptBinary ensures the catalog command name exists in
// ~/.local/bin, symlinking it to the installer-produced shim when the
// installer used a different name.
func canonicalizeScriptBinary(home, produced, canonical string) error {
	producedName := filepath.Base(produced)
	if producedName == canonical {
		return nil
	}
	target := filepath.Join(home, ".local", "bin", canonical)
	_ = os.Remove(target)
	relative, err := filepath.Rel(filepath.Dir(target), produced)
	if err != nil {
		return err
	}
	return os.Symlink(relative, target)
}

func locateScriptBinary(home string, candidates []string) (string, error) {
	searchDirs := []string{
		filepath.Join(home, ".local", "bin"),
		filepath.Join(home, ".cursor", "bin"),
	}
	for _, name := range candidates {
		for _, dir := range searchDirs {
			candidate := filepath.Join(dir, name)
			if info, err := os.Stat(candidate); err == nil && !info.IsDir() && info.Mode()&0o111 != 0 {
				return candidate, nil
			}
		}
	}
	return "", fmt.Errorf("installer did not produce any of %v under %s", candidates, home)
}

// rewriteStagedSymlinks converts absolute symlinks that point inside the
// staging tree into relative links, so they survive the staging→active
// rename. Links outside the installation tree are rejected.
func rewriteStagedSymlinks(staging string) error {
	absStaging, err := filepath.Abs(staging)
	if err != nil {
		return err
	}
	return filepath.WalkDir(absStaging, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink == 0 {
			return nil
		}
		target, err := os.Readlink(path)
		if err != nil {
			return err
		}
		if !filepath.IsAbs(target) {
			target = filepath.Join(filepath.Dir(path), target)
		}
		target = filepath.Clean(target)
		rel, err := filepath.Rel(absStaging, target)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
			return fmt.Errorf("installer produced a symlink outside its staging tree")
		}
		relative, err := filepath.Rel(filepath.Dir(path), target)
		if err != nil {
			return err
		}
		temporary := path + ".relink-tmp"
		_ = os.Remove(temporary)
		if err := os.Symlink(relative, temporary); err != nil {
			return err
		}
		return os.Rename(temporary, path)
	})
}

func writeScriptWrapper(path string, env *installEnv, spec Spec) error {
	activeHome := filepath.Join(env.root, "tools", spec.ProviderID, "current", "home")
	binaryPath := filepath.Join(activeHome, ".local", "bin", spec.Command)
	content := "#!/usr/bin/env bash\n" +
		"set -euo pipefail\n" +
		"export PATH=" + shellQuote(filepath.Join(activeHome, ".local", "bin")) + ":${PATH:-}\n" +
		"exec " + shellQuote(binaryPath) + " \"$@\"\n"
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), 0o755)
}

// downloadText is a package-level indirection so tests can stub vendor
// installer scripts without network access.
var downloadText = func(ctx context.Context, rawURL string) (string, error) {
	raw, err := fetchText(ctx, rawURL)
	return string(raw), err
}
