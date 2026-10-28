package main

import (
	"os"
	"path/filepath"
	"sort"
	"sync"
)

const sourceReadConcurrency = 16

func readSourceInputs[T any](paths []string, read func(string) T) []T {
	results := make([]T, len(paths))
	jobs := make(chan int, sourceReadConcurrency)
	var workers sync.WaitGroup
	for range min(len(paths), sourceReadConcurrency) {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for index := range jobs {
				results[index] = read(paths[index])
			}
		}()
	}
	for index := range paths {
		jobs <- index
	}
	close(jobs)
	workers.Wait()
	return results
}

type sourceFile struct {
	path    string
	content []byte
	err     error
}

type sourceTree struct {
	files []string
	err   error
}

// sourceInventory is private to one analysis. All readers share current bytes
// and directory results; no observation can cross an invocation boundary.
type sourceInventory struct {
	root     string
	trees    map[string]sourceTree
	contents map[string]sourceFile
}

func newSourceInventory(root string) *sourceInventory {
	return &sourceInventory{
		root: root, trees: make(map[string]sourceTree),
		contents: make(map[string]sourceFile),
	}
}

func (inventory *sourceInventory) tree(root string) ([]string, error) {
	if result, exists := inventory.trees[root]; exists {
		return result.files, result.err
	}
	files, err := sourceTreeFiles(root)
	inventory.trees[root] = sourceTree{files: files, err: err}
	return files, err
}

func (inventory *sourceInventory) readFiles(paths []string) []sourceFile {
	var pending []string
	seen := make(map[string]struct{})
	absolute := func(path string) string {
		if !filepath.IsAbs(path) {
			path = filepath.Join(inventory.root, path)
		}
		return filepath.Clean(path)
	}
	for _, path := range paths {
		key := absolute(path)
		if _, exists := inventory.contents[key]; exists {
			continue
		}
		if _, exists := seen[key]; !exists {
			pending = append(pending, key)
			seen[key] = struct{}{}
		}
	}
	loaded := readSourceInputs(pending, func(path string) sourceFile {
		content, err := os.ReadFile(path)
		return sourceFile{content: content, err: err}
	})
	for index, result := range loaded {
		inventory.contents[pending[index]] = result
	}
	results := make([]sourceFile, len(paths))
	for index, path := range paths {
		results[index] = inventory.contents[absolute(path)]
		results[index].path = path
	}
	return results
}

// sourceTreeFiles owns directory traversal for every inventory consumer.
// One bounded worker pool drains each frontier; no worker survives the call.
func sourceTreeFiles(root string) ([]string, error) {
	info, err := os.Lstat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return []string{root}, nil
	}
	type directoryResult struct {
		entries []os.DirEntry
		err     error
	}
	pending := []string{root}
	var files []string
	for len(pending) != 0 {
		batch := pending
		pending = nil
		results := readSourceInputs(batch, func(directory string) directoryResult {
			entries, err := os.ReadDir(directory)
			return directoryResult{entries: entries, err: err}
		})
		for index, result := range results {
			if result.err != nil {
				sort.Strings(files)
				return files, result.err
			}
			for _, entry := range result.entries {
				path := filepath.Join(batch[index], entry.Name())
				if entry.IsDir() {
					if !shouldSkipDirectory(entry.Name()) {
						pending = append(pending, path)
					}
				} else {
					files = append(files, path)
				}
			}
		}
	}
	sort.Strings(files)
	return files, nil
}
