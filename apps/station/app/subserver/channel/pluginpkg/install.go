package pluginpkg

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const manifestFileName = "plugin.json"

// InstalledPackage is the on-disk result of a successful install.
type InstalledPackage struct {
	Manifest   Manifest
	RootDir    string // absolute directory holding the unpacked package
	ExecPath   string // absolute resolved entry executable
	Provenance Provenance
}

// Installer copies/extracts packages into a root directory and enforces
// path safety. It never executes a plugin.
type Installer struct {
	root string
}

func NewInstaller(root string) (*Installer, error) {
	root = strings.TrimSpace(root)
	if root == "" {
		return nil, errors.New("plugin root is empty")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(abs, 0o700); err != nil {
		return nil, fmt.Errorf("create plugin root: %w", err)
	}
	return &Installer{root: abs}, nil
}

// Root returns the absolute package storage root.
func (i *Installer) Root() string { return i.root }

// ImportDirectory installs from a local directory containing plugin.json.
func (i *Installer) ImportDirectory(src string) (*InstalledPackage, error) {
	src, err := filepath.Abs(src)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(src)
	if err != nil {
		return nil, fmt.Errorf("source directory: %w", err)
	}
	if !info.IsDir() {
		return nil, errors.New("source is not a directory")
	}
	manifestRaw, err := os.ReadFile(filepath.Join(src, manifestFileName))
	if err != nil {
		return nil, fmt.Errorf("read manifest: %w", err)
	}
	manifest, entry, err := ParseManifest(manifestRaw)
	if err != nil {
		return nil, err
	}
	if err := validateEntryPath(src, entry.Path); err != nil {
		return nil, err
	}

	dest := i.packageDir(manifest.ID, manifest.Version)
	if err := copyTree(src, dest); err != nil {
		return nil, err
	}
	return i.finalize(manifest, entry, Provenance{Source: "directory", ImportedAt: nowRFC3339()})
}

// ImportArchive installs from a zip file containing plugin.json (optionally
// under one top-level directory).
func (i *Installer) ImportArchive(zipPath string) (*InstalledPackage, error) {
	reader, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, fmt.Errorf("open archive: %w", err)
	}
	defer reader.Close()

	manifestRaw, err := readZipManifest(reader.File)
	if err != nil {
		return nil, err
	}
	manifest, entry, err := ParseManifest(manifestRaw)
	if err != nil {
		return nil, err
	}

	dest := i.packageDir(manifest.ID, manifest.Version)
	if err := os.MkdirAll(dest, 0o700); err != nil {
		return nil, err
	}
	if err := extractZip(reader.File, dest); err != nil {
		_ = os.RemoveAll(dest)
		return nil, err
	}
	// Manifest may live under a single top-level folder in the archive.
	manifestDir, err := locateManifestDir(dest)
	if err != nil {
		_ = os.RemoveAll(dest)
		return nil, err
	}
	if err := validateEntryPath(manifestDir, entry.Path); err != nil {
		_ = os.RemoveAll(dest)
		return nil, err
	}
	return i.finalizeAt(manifest, entry, manifestDir, Provenance{Source: "archive", ImportedAt: nowRFC3339()})
}

// Remove deletes one installed package directory.
func (i *Installer) Remove(id, version string) error {
	target := i.packageDir(id, version)
	if err := requireWithin(i.root, target); err != nil {
		return err
	}
	if err := os.RemoveAll(target); err != nil {
		return fmt.Errorf("remove package: %w", err)
	}
	return nil
}

func (i *Installer) finalize(manifest Manifest, entry Entrypoint, prov Provenance) (*InstalledPackage, error) {
	return i.finalizeAt(manifest, entry, i.packageDir(manifest.ID, manifest.Version), prov)
}

func (i *Installer) finalizeAt(manifest Manifest, entry Entrypoint, contentDir string, prov Provenance) (*InstalledPackage, error) {
	execPath, err := resolveExecutable(contentDir, entry.Path)
	if err != nil {
		return nil, err
	}
	root := i.packageDir(manifest.ID, manifest.Version)
	return &InstalledPackage{
		Manifest:   manifest,
		RootDir:    root,
		ExecPath:   execPath,
		Provenance: prov,
	}, nil
}

func (i *Installer) packageDir(id, version string) string {
	return filepath.Join(i.root, sanitizePathSegment(id), sanitizePathSegment(version))
}

func validateEntryPath(base, rel string) error {
	if strings.TrimSpace(rel) == "" {
		return errors.New("empty entry path")
	}
	if filepath.IsAbs(rel) {
		return fmt.Errorf("entry path must be relative: %s", rel)
	}
	clean := filepath.Clean(rel)
	if clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
		return fmt.Errorf("entry path escapes package: %s", rel)
	}
	joined, err := filepath.Abs(filepath.Join(base, clean))
	if err != nil {
		return err
	}
	absBase, err := filepath.Abs(base)
	if err != nil {
		return err
	}
	if !isWithin(absBase, joined) {
		return fmt.Errorf("entry path escapes package: %s", rel)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(joined)
		if err != nil {
			return fmt.Errorf("entry executable: %w", err)
		}
		if info.IsDir() || info.Mode().Perm()&0o111 == 0 {
			return fmt.Errorf("entry is not an executable file: %s", rel)
		}
	}
	return nil
}

func resolveExecutable(base, rel string) (string, error) {
	clean := filepath.Clean(rel)
	joined := filepath.Join(base, clean)
	abs, err := filepath.Abs(joined)
	if err != nil {
		return "", err
	}
	return abs, validateEntryPath(base, rel)
}

func extractZip(files []*zip.File, dest string) error {
	for _, f := range files {
		if f.FileInfo().IsDir() {
			continue
		}
		target := filepath.Join(dest, f.Name)
		if err := requireWithin(dest, target); err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			return err
		}
		if err := writeZipFile(f, target); err != nil {
			return err
		}
	}
	return nil
}

func writeZipFile(f *zip.File, target string) error {
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, f.Mode().Perm()|0o600)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, rc)
	return err
}

func readZipManifest(files []*zip.File) ([]byte, error) {
	var candidates []string
	for _, f := range files {
		name := filepath.ToSlash(f.Name)
		base := filepath.Base(name)
		if base == manifestFileName {
			candidates = append(candidates, f.Name)
		}
	}
	if len(candidates) == 0 {
		return nil, errors.New("archive has no plugin.json")
	}
	// Prefer root-level manifest.
	var chosen string
	for _, c := range candidates {
		if filepath.Dir(c) == "." {
			chosen = c
			break
		}
	}
	if chosen == "" {
		chosen = candidates[0]
	}
	for _, f := range files {
		if f.Name == chosen {
			rc, err := f.Open()
			if err != nil {
				return nil, err
			}
			defer rc.Close()
			return io.ReadAll(rc)
		}
	}
	return nil, errors.New("manifest unreadable")
}

func locateManifestDir(root string) (string, error) {
	rootManifest := filepath.Join(root, manifestFileName)
	if _, err := os.Stat(rootManifest); err == nil {
		return root, nil
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return "", err
	}
	var dir string
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if _, err := os.Stat(filepath.Join(root, e.Name(), manifestFileName)); err == nil {
			if dir != "" {
				return "", errors.New("multiple top-level plugin directories")
			}
			dir = filepath.Join(root, e.Name())
		}
	}
	if dir == "" {
		return "", errors.New("no plugin.json after extraction")
	}
	return dir, nil
}

func copyTree(src, dest string) error {
	if err := os.MkdirAll(dest, 0o700); err != nil {
		return err
	}
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dest, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		if err := requireWithin(dest, target); err != nil {
			return err
		}
		return copyFile(path, target, info.Mode().Perm()|0o600)
	})
}

func copyFile(src, dest string, perm os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dest), 0o700); err != nil {
		return err
	}
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, perm)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func requireWithin(base, target string) error {
	absBase, err := filepath.Abs(base)
	if err != nil {
		return err
	}
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	if !isWithin(absBase, absTarget) {
		return fmt.Errorf("path escapes plugin root: %s", target)
	}
	return nil
}

func isWithin(base, target string) bool {
	rel, err := filepath.Rel(base, target)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)))
}

func sanitizePathSegment(s string) string {
	s = filepath.Base(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, "..", "_")
	if s == "" || s == "." || s == string(os.PathSeparator) {
		return "unknown"
	}
	return s
}

func nowRFC3339() string { return time.Now().UTC().Format(time.RFC3339) }
