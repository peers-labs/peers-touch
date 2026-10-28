package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestSourceTreePreservesHiddenSourcesAndPrunesOnlyDeclaredDirectories(t *testing.T) {
	root := t.TempDir()
	for _, relative := range []string{
		".custom/source.go", "a/first.go", "b/second_test.go",
		"node_modules/ignored.go", "target/ignored.go",
	} {
		path := filepath.Join(root, relative)
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("package source"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	files, err := sourceTreeFiles(root)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		filepath.Join(root, ".custom/source.go"),
		filepath.Join(root, "a/first.go"),
		filepath.Join(root, "b/second_test.go"),
	}
	if !reflect.DeepEqual(files, want) {
		t.Fatalf("inventory = %v, want %v", files, want)
	}
}

func TestSourceTreeRejectsMissingRootAndDoesNotFollowDirectorySymlink(t *testing.T) {
	root := t.TempDir()
	if _, err := sourceTreeFiles(filepath.Join(root, "missing")); !os.IsNotExist(err) {
		t.Fatalf("missing root error = %v", err)
	}
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "outside.go"), []byte("package outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "linked")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("directory symlinks unavailable: %v", err)
	}
	files, err := sourceTreeFiles(root)
	if err != nil || !reflect.DeepEqual(files, []string{link}) {
		t.Fatalf("symlink inventory = %v, error = %v", files, err)
	}
}

func TestSourceInventorySharesInputsOnlyWithinOneAnalysis(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "source.go")
	if err := os.WriteFile(path, []byte("package first"), 0o600); err != nil {
		t.Fatal(err)
	}
	inventory := newSourceInventory(root)
	first := inventory.readFiles([]string{path, "source.go"})
	if first[0].err != nil || !reflect.DeepEqual(first[0].content, first[1].content) {
		t.Fatalf("shared source inputs = %+v", first)
	}
	if err := os.WriteFile(path, []byte("package second"), 0o600); err != nil {
		t.Fatal(err)
	}
	repeated := inventory.readFiles([]string{path})
	fresh := newSourceInventory(root).readFiles([]string{path})
	if string(repeated[0].content) != "package first" || string(fresh[0].content) != "package second" {
		t.Fatalf("same-analysis = %q, next-analysis = %q", repeated[0].content, fresh[0].content)
	}
	missing := inventory.readFiles([]string{"missing.go"})
	if !os.IsNotExist(missing[0].err) {
		t.Fatalf("read error = %v", missing[0].err)
	}
}
