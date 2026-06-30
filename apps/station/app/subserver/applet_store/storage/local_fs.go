package storage

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type LocalStorage struct {
	BasePath string
}

func NewLocalStorage(basePath string) *LocalStorage {
	if err := os.MkdirAll(basePath, 0755); err != nil {
		// Just log error or panic in init
	}
	return &LocalStorage{BasePath: basePath}
}

func (s *LocalStorage) SaveFile(file io.Reader, filename string) (string, error) {
	relativePath, err := cleanRelativePath(filename)
	if err != nil {
		return "", err
	}
	destPath := filepath.Join(s.BasePath, relativePath)
	if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
		return "", err
	}
	out, err := os.Create(destPath)
	if err != nil {
		return "", err
	}
	defer out.Close()

	if _, err = io.Copy(out, file); err != nil {
		return "", err
	}

	return relativePath, nil
}

func (s *LocalStorage) ResolvePath(filename string) (string, error) {
	relativePath, err := cleanRelativePath(filename)
	if err != nil {
		return "", err
	}
	return filepath.Join(s.BasePath, relativePath), nil
}

func cleanRelativePath(filename string) (string, error) {
	cleaned := filepath.Clean(filename)
	if cleaned == "." || filepath.IsAbs(cleaned) || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) || cleaned == ".." {
		return "", fmt.Errorf("invalid storage path: %s", filename)
	}
	return cleaned, nil
}
