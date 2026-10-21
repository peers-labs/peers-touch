package pluginpkg

import (
	"archive/zip"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func writeExec(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	content := []byte("#!/bin/sh\nexit 0\n")
	if runtime.GOOS == "windows" {
		content = []byte("rem echo plugin\n")
	}
	if err := os.WriteFile(path, content, 0o755); err != nil {
		t.Fatal(err)
	}
}

func writePackageDir(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "plugin.json"), []byte(validManifestJSON(PlatformKey())), 0o600); err != nil {
		t.Fatal(err)
	}
	writeExec(t, filepath.Join(dir, "bin", "plugin"))
}

func TestImportDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("executable bit checks are unix-only")
	}
	root := t.TempDir()
	src := filepath.Join(root, "src")
	writePackageDir(t, src)

	installer, err := NewInstaller(filepath.Join(root, "plugins"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := installer.ImportDirectory(src)
	if err != nil {
		t.Fatalf("ImportDirectory: %v", err)
	}
	if pkg.Manifest.ID != "lark" {
		t.Fatalf("unexpected package: %+v", pkg)
	}
	if _, err := os.Stat(pkg.ExecPath); err != nil {
		t.Fatalf("executable not placed: %v", err)
	}
}

func TestRejectsEntryEscapingPackage(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix path checks")
	}
	root := t.TempDir()
	src := filepath.Join(root, "src")
	writePackageDir(t, src)
	bad := []byte(`{
		"schemaVersion":1,"id":"evil","name":"Evil","version":"1",
		"providerKind":"evil",
		"entry":{"` + PlatformKey() + `":{"path":"../../../../etc/passwd"}},
		"protocol":{"min":1,"max":1}}`)
	if err := os.WriteFile(filepath.Join(src, "plugin.json"), bad, 0o600); err != nil {
		t.Fatal(err)
	}
	installer, _ := NewInstaller(filepath.Join(root, "plugins"))
	if _, err := installer.ImportDirectory(src); err == nil {
		t.Fatal("expected path escape rejection")
	}
}

func TestImportArchiveRejectsZipSlip(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("zip-slip unix check")
	}
	root := t.TempDir()
	archive := filepath.Join(root, "evil.zip")
	createZip(t, archive, map[string]string{
		"../evil.txt": "x",
		"plugin.json": validManifestJSON(PlatformKey()),
		"bin/plugin":  "#!/bin/sh\nexit 0\n",
	})
	installer, _ := NewInstaller(filepath.Join(root, "plugins"))
	_, err := installer.ImportArchive(archive)
	if err == nil {
		t.Fatal("expected zip-slip rejection")
	}
}

func TestImportArchiveNestedManifest(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("executable bit unix-only")
	}
	root := t.TempDir()
	archive := filepath.Join(root, "ok.zip")
	createZip(t, archive, map[string]string{
		"lark-0.1/plugin.json": validManifestJSON(PlatformKey()),
		"lark-0.1/bin/plugin":  "#!/bin/sh\nexit 0\n",
	})
	installer, _ := NewInstaller(filepath.Join(root, "plugins"))
	pkg, err := installer.ImportArchive(archive)
	if err != nil {
		t.Fatalf("ImportArchive: %v", err)
	}
	if pkg.ExecPath == "" {
		t.Fatal("expected resolved exec path")
	}
}

func createZip(t *testing.T, path string, files map[string]string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	w := zip.NewWriter(f)
	for name, body := range files {
		hdr := &zip.FileHeader{Name: name, Method: zip.Deflate}
		hdr.SetMode(0o755)
		writer, err := w.CreateHeader(hdr)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
}
