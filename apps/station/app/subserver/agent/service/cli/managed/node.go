package managed

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// pinnedNodeVersion is the Node.js LTS used to run npm-distributed CLI
// adapters. One Station installation shares it.
const pinnedNodeVersion = "v24.22.2"

const installHTTPTimeout = 5 * time.Minute

// nodeReceipt records the activated runtime so repeat installs skip the
// download entirely.
type nodeReceipt struct {
	Version string `json:"version"`
	OS      string `json:"os"`
	Arch    string `json:"arch"`
}

// ensureNodeRuntime downloads and activates the managed Node runtime when
// missing. An existing receipt for the pinned version is trusted without a
// network lookup.
func ensureNodeRuntime(
	ctx context.Context,
	root string,
	env *installEnv,
	reporter *progress,
) error {
	reporter.report(phaseRuntime, 10, "checking managed Node runtime")
	if receiptValid(env.nodeDir) {
		reporter.report(phaseRuntime, 100, "managed Node runtime ready")
		return nil
	}

	nodeOS, nodeArch, err := nodePlatform()
	if err != nil {
		return err
	}
	archiveName := fmt.Sprintf("node-%s-%s-%s.tar.gz", pinnedNodeVersion, nodeOS, nodeArch)
	checksums, err := fetchText(ctx, "https://nodejs.org/dist/"+pinnedNodeVersion+"/SHASUMS256.txt")
	if err != nil {
		return fmt.Errorf("fetch Node checksums: %w", err)
	}
	expectedSHA, err := parseChecksum(string(checksums), archiveName)
	if err != nil {
		return err
	}

	reporter.report(phaseDownload, 10, "downloading Node runtime")
	archive, err := fetchFile(ctx, nodeDistURL(pinnedNodeVersion, archiveName))
	if err != nil {
		return fmt.Errorf("download Node runtime: %w", err)
	}
	actualSHA := sha256.Sum256(archive)
	if hex.EncodeToString(actualSHA[:]) != expectedSHA {
		return fmt.Errorf("Node runtime checksum mismatch for %s", archiveName)
	}

	parentDir := filepath.Join(root, "tools-bootstrap")
	if err := os.MkdirAll(parentDir, 0o700); err != nil {
		return fmt.Errorf("create node bootstrap dir: %w", err)
	}
	staging, err := os.MkdirTemp(parentDir, ".node-install-*")
	if err != nil {
		return fmt.Errorf("create node staging dir: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = os.RemoveAll(staging)
		}
	}()
	if err := extractTarGz(archive, staging); err != nil {
		return fmt.Errorf("extract Node runtime: %w", err)
	}
	extracted := filepath.Join(staging, strings.TrimSuffix(archiveName, ".tar.gz"))
	if _, err := os.Stat(filepath.Join(extracted, "bin", "node")); err != nil {
		return fmt.Errorf("extracted Node runtime is incomplete: %w", err)
	}

	receipt := nodeReceipt{Version: pinnedNodeVersion, OS: nodeOS, Arch: nodeArch}
	if err := writeJSON(filepath.Join(extracted, ".receipt.json"), receipt); err != nil {
		return err
	}
	// npm is a relative symlink in Node archives. Verify both binaries before
	// publishing the receipt and activating the runtime.
	stagedEnv := newInstallEnv(root)
	stagedEnv.nodeDir = extracted
	if err := probeCommand(ctx, filepath.Join(extracted, "bin", "node"), stagedEnv, nil); err != nil {
		return err
	}
	if err := probeCommand(ctx, filepath.Join(extracted, "bin", "npm"), stagedEnv, nil); err != nil {
		return err
	}
	if err := replaceDir(env.nodeDir, extracted); err != nil {
		return fmt.Errorf("activate Node runtime: %w", err)
	}
	if err := os.MkdirAll(env.binDir, 0o700); err != nil {
		return fmt.Errorf("create managed bin dir: %w", err)
	}
	committed = true
	_ = os.RemoveAll(staging)
	reporter.report(phaseRuntime, 100, "managed Node runtime ready")
	return nil
}

func receiptValid(nodeDir string) bool {
	raw, err := os.ReadFile(filepath.Join(nodeDir, ".receipt.json"))
	if err != nil {
		return false
	}
	var receipt nodeReceipt
	if json.Unmarshal(raw, &receipt) != nil {
		return false
	}
	nodeOS, nodeArch, err := nodePlatform()
	if err != nil {
		return false
	}
	return receipt.Version == pinnedNodeVersion &&
		receipt.OS == nodeOS &&
		receipt.Arch == nodeArch &&
		executableExists(filepath.Join(nodeDir, "bin", "node")) &&
		executableExists(filepath.Join(nodeDir, "bin", "npm"))
}

func executableExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && info.Mode()&0o111 != 0
}

func nodePlatform() (string, string, error) {
	var nodeOS string
	switch runtime.GOOS {
	case "linux":
		nodeOS = "linux"
	case "darwin":
		nodeOS = "darwin"
	default:
		return "", "", fmt.Errorf("managed Node runtime is not available on %s", runtime.GOOS)
	}
	var nodeArch string
	switch runtime.GOARCH {
	case "amd64":
		nodeArch = "x64"
	case "arm64":
		nodeArch = "arm64"
	default:
		return "", "", fmt.Errorf("managed Node runtime is not available for %s", runtime.GOARCH)
	}
	return nodeOS, nodeArch, nil
}

// nodeDistURL mirrors first (faster inside CN networks), official source
// second.
func nodeDistURL(version, name string) string {
	for _, base := range []string{
		"https://registry.npmmirror.com/-/binary/node/" + version + "/",
		"https://nodejs.org/dist/" + version + "/",
	} {
		if probeURL(base + name) {
			return base + name
		}
	}
	return "https://nodejs.org/dist/" + version + "/" + name
}

func probeURL(raw string) bool {
	client := &http.Client{Timeout: 8 * time.Second}
	request, err := http.NewRequest(http.MethodHead, raw, nil)
	if err != nil {
		return false
	}
	response, err := client.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	return response.StatusCode == http.StatusOK
}

func parseChecksum(checksums, archiveName string) (string, error) {
	for _, line := range strings.Split(string(checksums), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && strings.TrimSpace(fields[1]) == archiveName {
			return strings.TrimSpace(fields[0]), nil
		}
	}
	return "", fmt.Errorf("checksum for %s not found", archiveName)
}

func fetchText(ctx context.Context, rawURL string) ([]byte, error) {
	return fetchFile(ctx, rawURL)
}

func fetchFile(ctx context.Context, rawURL string) ([]byte, error) {
	if _, err := url.Parse(rawURL); err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: installHTTPTimeout}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET %s: HTTP %d", rawURL, response.StatusCode)
	}
	return io.ReadAll(io.LimitReader(response.Body, 256*1024*1024))
}

func extractTarGz(archive []byte, destination string) error {
	reader, err := gzip.NewReader(bytes.NewReader(archive))
	if err != nil {
		return err
	}
	defer reader.Close()
	tarReader := tar.NewReader(reader)
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		target, err := safeExtractPath(destination, header.Name)
		if err != nil {
			return err
		}
		// No archive entry may traverse a symlink created by an earlier one.
		for parent := filepath.Dir(target); parent != filepath.Clean(destination); parent = filepath.Dir(parent) {
			if info, err := os.Lstat(parent); err == nil && info.Mode()&os.ModeSymlink != 0 {
				return fmt.Errorf("archive entry traverses a symlink")
			}
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, os.FileMode(header.Mode)&0o777); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
				return err
			}
			file, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, os.FileMode(header.Mode)&0o777)
			if err != nil {
				return err
			}
			if _, err := io.Copy(file, io.LimitReader(tarReader, 256*1024*1024)); err != nil {
				_ = file.Close()
				return err
			}
			file.Close()
		case tar.TypeSymlink:
			if filepath.IsAbs(header.Linkname) {
				return fmt.Errorf("archive contains an absolute symlink")
			}
			if _, err := safeExtractPath(destination, filepath.Join(filepath.Dir(header.Name), header.Linkname)); err != nil {
				return err
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
				return err
			}
			if err := os.Symlink(header.Linkname, target); err != nil {
				return err
			}
		default:
			return fmt.Errorf("archive contains an unsupported entry type")
		}
	}
	return nil
}

func safeExtractPath(base, name string) (string, error) {
	if filepath.IsAbs(name) {
		return "", fmt.Errorf("archive contains an absolute path")
	}
	target := filepath.Join(base, name)
	cleanBase := filepath.Clean(base)
	if filepath.Clean(target) == cleanBase {
		return "", fmt.Errorf("archive entry cannot replace the destination root")
	}
	if !strings.HasPrefix(filepath.Clean(target), cleanBase+string(os.PathSeparator)) &&
		filepath.Clean(target) != cleanBase {
		return "", fmt.Errorf("archive path escapes destination: %s", name)
	}
	return target, nil
}

// replaceDir atomically activates a freshly prepared directory: the
// previous tree moves aside and is removed only after the rename succeeds.
func replaceDir(activeDir, stagedDir string) error {
	if err := os.MkdirAll(filepath.Dir(activeDir), 0o700); err != nil {
		return err
	}
	previous := activeDir + ".previous"
	_ = os.RemoveAll(previous)
	if _, err := os.Stat(activeDir); err == nil {
		if err := os.Rename(activeDir, previous); err != nil {
			return err
		}
	}
	if err := os.Rename(stagedDir, activeDir); err != nil {
		if _, statErr := os.Stat(previous); statErr == nil {
			_ = os.Rename(previous, activeDir)
		}
		return err
	}
	_ = os.RemoveAll(previous)
	return nil
}

func writeJSON(path string, payload any) error {
	raw, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(raw, '\n'), 0o600)
}
