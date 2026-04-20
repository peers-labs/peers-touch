// Package domain — Data Transfer Objects exchanged between layers.
//
// Change History:
// - 2026-04-10: Initial implementation — Login, Admin, Session, Actor DTOs.
// - 2026-04-10: Refactored from flat model.go to DDD domain layer.
// - 2026-04-10: Added ActorSummary DTO to prevent leaking sensitive fields
//   (PasswordHash, PrivateKey, PublicKey) through the recent-actors API.
package domain

import "time"

// ---------------------------------------------------------------------------
// Auth DTOs
// ---------------------------------------------------------------------------

// LoginResult is the response payload for a successful login.
type LoginResult struct {
	Token     string    `json:"token"`
	SessionID string    `json:"session_id"`
	ExpiresAt time.Time `json:"expires_at"`
	Admin     AdminInfo `json:"admin"`
}

// AdminInfo is a safe (password-free) representation of an admin.
type AdminInfo struct {
	ID          uint64    `json:"id"`
	Username    string    `json:"username"`
	DisplayName string    `json:"display_name"`
	Role        AdminRole `json:"role"`
	IsSuperUser bool      `json:"is_super_user"`
}

// CreateAdminRequest is the request body for creating a new admin.
type CreateAdminRequest struct {
	Username    string `json:"username"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
	DID         string `json:"did,omitempty"`
}

// DashboardSessionInfo is a safe representation of an admin session.
type DashboardSessionInfo struct {
	SessionID    string    `json:"session_id"`
	AdminID      uint64    `json:"admin_id"`
	Username     string    `json:"username"`
	IPAddress    string    `json:"ip_address"`
	UserAgent    string    `json:"user_agent"`
	CreatedAt    time.Time `json:"created_at"`
	LastActiveAt time.Time `json:"last_active_at"`
	ExpiresAt    time.Time `json:"expires_at"`
}

// ---------------------------------------------------------------------------
// Actor DTOs (for dashboard's view of Peers actors)
// ---------------------------------------------------------------------------

// ActorSummary is a safe, projection-only representation of a Peers actor.
// It intentionally excludes sensitive fields such as PasswordHash, PrivateKey,
// PublicKey, and ActivityPub endpoint URIs that must never leave the server.
type ActorSummary struct {
	ID                uint64    `json:"id"`
	DID               string    `json:"did"`
	PreferredUsername  string    `json:"preferred_username"`
	Name              string    `json:"name"`
	Email             string    `json:"email"`
	Summary           string    `json:"summary"`
	AvatarURL         string    `json:"avatar_url"`
	CreatedAt         time.Time `json:"created_at"`
}

// ActorListQuery defines pagination and filter parameters.
type ActorListQuery struct {
	Page     int    `json:"page"`
	PageSize int    `json:"page_size"`
	Search   string `json:"search"`
	Status   string `json:"status"`
}

// ActorListResult wraps a paginated actor list.
type ActorListResult struct {
	Total int64         `json:"total"`
	Page  int           `json:"page"`
	Items []ActorDetail `json:"items"`
}

// ActorDetail contains enriched information about a single actor.
type ActorDetail struct {
	ID               uint64     `json:"id"`
	DID              string     `json:"did"`
	PreferredUsername string     `json:"preferred_username"`
	Name             string     `json:"name"`
	Email            string     `json:"email"`
	Summary          string     `json:"summary"`
	AvatarURL        string     `json:"avatar_url"`
	Status           string     `json:"status"`
	CreatedAt        time.Time  `json:"created_at"`
	LastLoginAt      *time.Time `json:"last_login_at,omitempty"`
	PostCount        int64      `json:"post_count"`
	FollowerCount    int64      `json:"follower_count"`
	FollowingCount   int64      `json:"following_count"`
	SessionCount     int64      `json:"session_count"`
}

// ActorSessionInfo describes a single actor session.
type ActorSessionInfo struct {
	SessionID     string    `json:"session_id"`
	DeviceType    string    `json:"device_type"`
	IPAddress     string    `json:"ip_address"`
	UserAgent     string    `json:"user_agent"`
	CreatedAt     time.Time `json:"created_at"`
	ExpiresAt     time.Time `json:"expires_at"`
	LastActiveAt  time.Time `json:"last_active_at"`
	Revoked       bool      `json:"revoked"`
	RevokedReason string    `json:"revoked_reason,omitempty"`
}

// ---------------------------------------------------------------------------
// Overview DTOs
// ---------------------------------------------------------------------------

// OverviewStats is the aggregate payload returned by GET /overview/stats.
// Only fields backed by real data sources are included.
type OverviewStats struct {
	Actors     ActorStats     `json:"actors"`
	Nodes      NodeStats      `json:"nodes"`
	SubServers SubServerStats `json:"sub_servers"`
	Social     SocialStats    `json:"social"`
	System     SystemInfo     `json:"system"`
}

// ActorStats holds registration statistics for actors.
type ActorStats struct {
	Total       int64 `json:"total"`
	Active      int64 `json:"active"`
	NewToday    int64 `json:"new_today"`
	NewThisWeek int64 `json:"new_this_week"`
}

// NodeStats holds registry node counts.
type NodeStats struct {
	Registered int `json:"registered"`
}

// SubServerStats summarizes SubServer health.
type SubServerStats struct {
	Total   int             `json:"total"`
	Running int             `json:"running"`
	Stopped int             `json:"stopped"`
	List    []SubServerInfo `json:"list"`
}

// SubServerInfo describes a single SubServer.
type SubServerInfo struct {
	Name   string `json:"name"`
	Type   string `json:"type"`
	Status string `json:"status"`
}

// SocialStats holds social feature counters.
type SocialStats struct {
	TotalPosts    int64 `json:"total_posts"`
	TotalComments int64 `json:"total_comments"`
	TotalLikes    int64 `json:"total_likes"`
	TotalFollows  int64 `json:"total_follows"`
	PostsToday    int64 `json:"posts_today"`
}

// SystemInfo holds runtime system information.
// Only includes fields sourced from real runtime data.
type SystemInfo struct {
	StartedAt  time.Time `json:"started_at"`
	GoVersion  string    `json:"go_version"`
	ListenAddr string    `json:"listen_addr"`
}
