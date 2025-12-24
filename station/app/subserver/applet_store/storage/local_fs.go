package storage

import (
	"io"
	"os"
	"path/filepath"
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
	destPath := filepath.Join(s.BasePath, filename)
	out, err := os.Create(destPath)
	if err != nil {
		return "", err
	}
	defer out.Close()

	_, err = io.Copy(out, file)
	if err != nil {
		return "", err
	}

	// Return relative path or absolute path depending on how we serve files
	return filename, nil
}
