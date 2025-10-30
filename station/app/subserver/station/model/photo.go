package model

import "time"

// PhotoInfo represents metadata about a photo
type PhotoInfo struct {
	ID       string    `json:"id"`
	Filename string    `json:"filename"`
	Album    string    `json:"album"`
	Size     int64     `json:"size"`
	ModTime  time.Time `json:"mod_time"`
	Path     string    `json:"path,omitempty"`
}

// AlbumInfo represents an album with its photos
type AlbumInfo struct {
	Name   string      `json:"name"`
	Photos []PhotoInfo `json:"photos"`
	Count  int         `json:"count"`
}

// PhotoListResponse represents the response for listing photos
type PhotoListResponse struct {
	Albums []AlbumInfo `json:"albums"`
	Total  int         `json:"total"`
}
