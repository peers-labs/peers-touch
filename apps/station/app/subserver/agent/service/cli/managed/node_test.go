package managed

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"
)

func archiveForTest(t *testing.T, headers ...tar.Header) []byte {
	t.Helper()
	var output bytes.Buffer
	gz := gzip.NewWriter(&output)
	writer := tar.NewWriter(gz)
	for _, header := range headers {
		if err := writer.WriteHeader(&header); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func TestNodeArchivePreservesNPMSymlinkAndRejectsEscapes(t *testing.T) {
	root := t.TempDir()
	archive := archiveForTest(t,
		tar.Header{Name: "node/lib/npm-cli.js", Typeflag: tar.TypeReg, Mode: 0o755},
		tar.Header{Name: "node/bin/npm", Typeflag: tar.TypeSymlink, Linkname: "../lib/npm-cli.js"},
	)
	if err := extractTarGz(archive, root); err != nil {
		t.Fatal(err)
	}
	if target, err := os.Readlink(filepath.Join(root, "node/bin/npm")); err != nil || target != "../lib/npm-cli.js" {
		t.Fatalf("npm symlink = %q, %v", target, err)
	}
	for _, header := range []tar.Header{
		{Name: "../escape", Typeflag: tar.TypeReg},
		{Name: "/absolute", Typeflag: tar.TypeReg},
		{Name: "node/bin/npm", Typeflag: tar.TypeSymlink, Linkname: "../../../escape"},
		{Name: "node/bin/npm", Typeflag: tar.TypeSymlink, Linkname: "/tmp/escape"},
		{Name: ".", Typeflag: tar.TypeDir},
	} {
		if err := extractTarGz(archiveForTest(t, header), t.TempDir()); err == nil {
			t.Fatalf("unsafe archive entry passed: %+v", header)
		}
	}
	throughLink := archiveForTest(t,
		tar.Header{Name: "node/lib", Typeflag: tar.TypeDir, Mode: 0o700},
		tar.Header{Name: "node/bin", Typeflag: tar.TypeSymlink, Linkname: "lib"},
		tar.Header{Name: "node/bin/entry", Typeflag: tar.TypeReg},
	)
	if err := extractTarGz(throughLink, t.TempDir()); err == nil {
		t.Fatal("archive wrote through a symlink")
	}
}
