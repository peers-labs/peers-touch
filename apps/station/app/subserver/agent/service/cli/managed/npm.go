package managed

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli"
)

const (
	commandProbeTimeout = 30 * time.Second
	npmInstallTimeout   = 8 * time.Minute
)

// installNPMTool stages an npm CLI and activates a verified shared version.
func installNPMTool(
	ctx context.Context,
	root string,
	env *installEnv,
	spec Spec,
	reporter *progress,
) error {
	reporter.report(phaseInstall, 0, fmt.Sprintf("preparing %s", spec.Package))
	toolsDir := filepath.Join(root, "tools")
	if err := os.MkdirAll(toolsDir, 0o700); err != nil {
		return fmt.Errorf("create managed tools dir: %w", err)
	}
	staging, err := os.MkdirTemp(toolsDir, fmt.Sprintf(".%s-install-*", spec.ProviderID))
	if err != nil {
		return fmt.Errorf("create staging dir: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = os.RemoveAll(staging)
		}
	}()

	if err := writeJSON(filepath.Join(staging, "package.json"), map[string]any{
		"name":    "peers-managed-" + spec.ProviderID,
		"private": true,
	}); err != nil {
		return err
	}

	var lastErr error
	for _, registry := range npmRegistryCandidates() {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := runNPMInstall(ctx, env, staging, spec, registry, reporter); err != nil {
			lastErr = err
			continue
		}
		lastErr = nil
		break
	}
	if lastErr != nil {
		return fmt.Errorf("install %s: %w", spec.Package, lastErr)
	}

	stagedCommand := toolCommandPath(staging, spec.Command)
	if _, err := os.Stat(stagedCommand); err != nil {
		return fmt.Errorf("%s installer did not produce executable %s", spec.Package, spec.Command)
	}

	reporter.report(phaseVerify, 10, "verifying adapter")
	if err := probeCommand(ctx, stagedCommand, env, nil); err != nil {
		return fmt.Errorf("verify staged %s: %w", spec.Command, err)
	}

	reporter.report(phaseActivate, 10, "activating adapter")
	if err := activateTool(ctx, env, spec, staging, writeNPMWrapper); err != nil {
		return fmt.Errorf("activate %s: %w", spec.ProviderID, err)
	}
	committed = true
	_ = os.RemoveAll(staging)

	return nil
}

func runNPMInstall(
	ctx context.Context,
	env *installEnv,
	staging string,
	spec Spec,
	registry string,
	reporter *progress,
) error {
	// Every registry attempt starts from a clean dependency tree so a failed
	// mirror cannot poison the next attempt.
	for _, entry := range []string{"node_modules", "package-lock.json"} {
		_ = os.RemoveAll(filepath.Join(staging, entry))
	}
	runCtx, cancel := context.WithTimeout(ctx, npmInstallTimeout)
	defer cancel()
	cmd := exec.CommandContext(runCtx, env.npmBinary(),
		"install", "--no-fund", "--no-audit",
		"--loglevel", "http", "--registry", registry, spec.Package,
	)
	cmd.Dir = staging
	cli.PrepareCommand(cmd)
	defer cli.CleanupCommand(cmd)
	childEnv, err := npmCommandEnv(env, registry)
	if err != nil {
		return err
	}
	cmd.Env = childEnv
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	fetchTicks := 0
	scanner := bufio.NewScanner(stderr)
	scanner.Buffer(make([]byte, 0, 64*1024), 512*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if strings.Contains(line, "http fetch") || strings.Contains(line, "reify") {
			fetchTicks++
			percent := 5 + fetchTicks*2
			if percent > 82 {
				percent = 82
			}
			reporter.report(phaseInstall, percent, "installing package dependencies")
		}
	}
	if err := scanner.Err(); err != nil {
		_ = cmd.Cancel()
		_ = cmd.Wait()
		return fmt.Errorf("read npm install progress: %w", err)
	}
	waitErr := cmd.Wait()
	if runCtx.Err() != nil {
		return runCtx.Err()
	}
	return waitErr
}

func npmCommandEnv(env *installEnv, registry string) ([]string, error) {
	base, err := env.commandEnv()
	if err != nil {
		return nil, err
	}
	entries := []string{
		"NPM_CONFIG_CACHE=" + env.npmCache,
		"NPM_CONFIG_REGISTRY=" + registry,
		"npm_config_registry=" + registry,
		"NPM_CONFIG_UPDATE_NOTIFIER=false",
		"npm_config_update_notifier=false",
		"NO_COLOR=1",
	}
	return append(base, entries...), nil
}

func npmRegistryCandidates() []string {
	var candidates []string
	seen := map[string]struct{}{}
	add := func(raw string) {
		raw = strings.TrimRight(strings.TrimSpace(raw), "/")
		if raw == "" {
			return
		}
		if _, ok := seen[raw]; ok {
			return
		}
		seen[raw] = struct{}{}
		candidates = append(candidates, raw)
	}
	add(os.Getenv("PEERS_MANAGED_NPM_REGISTRY"))
	add("https://registry.npmmirror.com")
	add("https://registry.npmjs.org")
	return candidates
}

func toolCommandPath(toolDir, command string) string {
	name := command
	if runtime.GOOS == "windows" {
		name += ".cmd"
	}
	return filepath.Join(toolDir, "node_modules", ".bin", name)
}

// probeCommand runs `<command> --version` with the managed environment to
// prove the binary actually starts.
func probeCommand(ctx context.Context, command string, env *installEnv, extraEnv []string) error {
	probeCtx, cancel := context.WithTimeout(ctx, commandProbeTimeout)
	defer cancel()
	cmd := exec.CommandContext(probeCtx, command, "--version")
	cli.PrepareCommand(cmd)
	defer cli.CleanupCommand(cmd)
	childEnv, err := env.commandEnv()
	if err != nil {
		return err
	}
	cmd.Env = append(childEnv, extraEnv...)
	cmd.Stdout, cmd.Stderr = nil, nil
	err = cmd.Run()
	if probeCtx.Err() != nil {
		return probeCtx.Err()
	}
	if err != nil {
		return fmt.Errorf("adapter version probe failed: %w", err)
	}
	return nil
}

func writeNPMWrapper(path string, env *installEnv, spec Spec) error {
	var content string
	switch runtime.GOOS {
	case "windows":
		// Station-managed runtimes currently target Linux/macOS
		// containers; keep the branch explicit rather than silently
		// writing a POSIX script.
		return fmt.Errorf("managed npm wrappers are not implemented for windows")
	default:
		commandPath := filepath.Join(
			env.root, "tools", spec.ProviderID, "current", "node_modules", ".bin", spec.Command,
		)
		content = "#!/usr/bin/env bash\n" +
			"set -euo pipefail\n" +
			"export PATH=" + shellQuote(filepath.Join(env.nodeDir, "bin")) + ":${PATH:-}\n" +
			"exec " + shellQuote(commandPath) + " \"$@\"\n"
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		return err
	}
	return nil
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}
