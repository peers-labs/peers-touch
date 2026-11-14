package managed

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
)

// activateTool keeps immutable versions and switches one symlink atomically.
// Wrapper preparation precedes activation; failed final verification restores
// the previous pointer before removing the failed version.
func activateTool(ctx context.Context, env *installEnv, spec Spec, staging string,
	writeWrapper func(string, *installEnv, Spec) error,
) error {
	toolDir := filepath.Join(env.root, "tools", spec.ProviderID)
	versions := filepath.Join(toolDir, "versions")
	if err := os.MkdirAll(versions, 0o700); err != nil {
		return err
	}
	if err := os.MkdirAll(env.binDir, 0o700); err != nil {
		return err
	}
	id := newJobID()
	wrapper := filepath.Join(env.binDir, spec.Command)
	stagedWrapper := filepath.Join(env.binDir, "."+spec.Command+"-"+id)
	defer os.Remove(stagedWrapper)
	if err := writeWrapper(stagedWrapper, env, spec); err != nil {
		return err
	}
	previousWrapper, wrapperErr := os.ReadFile(wrapper)
	if wrapperErr != nil && !os.IsNotExist(wrapperErr) {
		return wrapperErr
	}
	current := filepath.Join(toolDir, "current")
	previous, err := os.Readlink(current)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("managed tool activation pointer is invalid")
	}
	version := filepath.Join(versions, id)
	if err := os.Rename(staging, version); err != nil {
		return err
	}
	success := false
	defer func() {
		if !success {
			_ = os.RemoveAll(version)
		}
	}()
	switchPointer := func(target string) error {
		link := filepath.Join(toolDir, ".current-"+id)
		_ = os.Remove(link)
		defer os.Remove(link)
		if err := os.Symlink(target, link); err != nil {
			return err
		}
		return os.Rename(link, current)
	}
	if err := switchPointer(filepath.Join("versions", id)); err != nil {
		return err
	}
	rollback := func(cause error) error {
		var restoreErr error
		if previous != "" {
			restoreErr = switchPointer(previous)
		} else {
			restoreErr = os.Remove(current)
		}
		if restoreErr != nil {
			// Preserve the only version current may still reference.
			success = true
			return fmt.Errorf("activation failed and rollback failed: %w", restoreErr)
		}
		if wrapperErr == nil {
			restoreErr = os.WriteFile(wrapper, previousWrapper, 0o755)
		} else {
			restoreErr = os.Remove(wrapper)
			if os.IsNotExist(restoreErr) {
				restoreErr = nil
			}
		}
		if restoreErr != nil {
			return fmt.Errorf("restore managed wrapper: %w", restoreErr)
		}
		return cause
	}
	if err := os.Rename(stagedWrapper, wrapper); err != nil {
		return rollback(err)
	}
	if err := probeCommand(ctx, wrapper, env, nil); err != nil {
		return rollback(err)
	}
	success = true
	// Earlier versions remain available to already running processes.
	return nil
}
