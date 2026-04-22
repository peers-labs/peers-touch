// Package domain — Data Transfer Objects exchanged between layers.
//
// Change History:
//   - 2026-04-10: Initial implementation — Login, Admin, Session, Actor DTOs.
//   - 2026-04-10: Refactored from flat model.go to DDD domain layer.
//   - 2026-04-10: Added ActorSummary DTO to prevent leaking sensitive fields
//     (PasswordHash, PrivateKey, PublicKey) through the recent-actors API.
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
	PreferredUsername string    `json:"preferred_username"`
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
	ID                uint64     `json:"id"`
	DID               string     `json:"did"`
	PreferredUsername string     `json:"preferred_username"`
	Name              string     `json:"name"`
	Email             string     `json:"email"`
	Summary           string     `json:"summary"`
	AvatarURL         string     `json:"avatar_url"`
	Status            string     `json:"status"`
	CreatedAt         time.Time  `json:"created_at"`
	LastLoginAt       *time.Time `json:"last_login_at,omitempty"`
	PostCount         int64      `json:"post_count"`
	FollowerCount     int64      `json:"follower_count"`
	FollowingCount    int64      `json:"following_count"`
	SessionCount      int64      `json:"session_count"`
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

// PeersSessionInfo is the global view of an active actor session, with the
// owning actor resolved (preferred_username) for the dashboard Sessions page.
// "PeersSession" terminology is used to disambiguate from DashboardSession
// (admin) and ActorSessionInfo (per-actor drilldown view).
type PeersSessionInfo struct {
	SessionID         string    `json:"session_id"`
	UserID            uint64    `json:"user_id"`
	PreferredUsername string    `json:"preferred_username"`
	Email             string    `json:"email"`
	DeviceType        string    `json:"device_type"`
	IPAddress         string    `json:"ip_address"`
	UserAgent         string    `json:"user_agent"`
	CreatedAt         time.Time `json:"created_at"`
	ExpiresAt         time.Time `json:"expires_at"`
	LastActiveAt      time.Time `json:"last_active_at"`
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
	StartedAt    time.Time `json:"started_at"`
	GoVersion    string    `json:"go_version"`
	ListenAddr   string    `json:"listen_addr"`
	Hostname     string    `json:"hostname,omitempty"`
	GoMaxProcs   int       `json:"go_max_procs,omitempty"`
	NumCPU       int       `json:"num_cpu,omitempty"`
	NumGoroutine int       `json:"num_goroutine,omitempty"`
	MemAllocMB   uint64    `json:"mem_alloc_mb,omitempty"`
	MemSysMB     uint64    `json:"mem_sys_mb,omitempty"`
	GCCount      uint32    `json:"gc_count,omitempty"`
}

// ---------------------------------------------------------------------------
// Storage DTOs (Storage page)
// ---------------------------------------------------------------------------

// StorageInfo bundles everything the Storage page needs.
type StorageInfo struct {
	Driver string              `json:"driver"`
	Pool   *StoragePoolStats   `json:"pool,omitempty"`
	Tables []StorageTableCount `json:"tables"`
}

// StoragePoolStats mirrors database/sql.DBStats with JSON-friendly names.
type StoragePoolStats struct {
	MaxOpenConnections int   `json:"max_open_connections"`
	OpenConnections    int   `json:"open_connections"`
	InUse              int   `json:"in_use"`
	Idle               int   `json:"idle"`
	WaitCount          int64 `json:"wait_count"`
	WaitDurationMillis int64 `json:"wait_duration_ms"`
	MaxIdleClosed      int64 `json:"max_idle_closed"`
	MaxIdleTimeClosed  int64 `json:"max_idle_time_closed"`
	MaxLifetimeClosed  int64 `json:"max_lifetime_closed"`
}

// ---------------------------------------------------------------------------
// Nodes DTOs (Nodes page)
// ---------------------------------------------------------------------------

// NodesOverview is the full payload for GET /dashboard/api/nodes.
type NodesOverview struct {
	Persisted     []PersistedPeer        `json:"persisted"`
	Registrations []RegistryRegistration `json:"registrations"`
}

// PersistedPeer is one row from the local touch_peer table joined with
// its known addresses.
type PersistedPeer struct {
	ID        uint64            `json:"id"`
	PeerID    string            `json:"peer_id"`
	Name      string            `json:"name"`
	Version   string            `json:"version"`
	Addresses []PeerAddressInfo `json:"addresses"`
	CreatedAt time.Time         `json:"created_at"`
	UpdatedAt time.Time         `json:"updated_at"`
}

// PeerAddressInfo is a typed peer address (stun/turn-relay/http/...).
type PeerAddressInfo struct {
	Type string `json:"type"`
	Addr string `json:"addr"`
}

// RegistryRegistration mirrors registry.Registration but as a JSON-safe
// projection (timestamps as RFC3339 strings, metadata best-effort).
type RegistryRegistration struct {
	ID         string            `json:"id"`
	Name       string            `json:"name"`
	Type       string            `json:"type"`
	Namespaces []string          `json:"namespaces"`
	Addresses  []string          `json:"addresses"`
	TTLSeconds int64             `json:"ttl_seconds,omitempty"`
	Metadata   map[string]string `json:"metadata,omitempty"`
}

// StorageTableCount carries the row count for a single physical table.
// Rows == -1 means a query error occurred (Error contains the message);
// callers should render this as a warning rather than as zero.
type StorageTableCount struct {
	Group string `json:"group"`
	Table string `json:"table"`
	Rows  int64  `json:"rows"`
	Error string `json:"error,omitempty"`
}

// ---------------------------------------------------------------------------
// Typed Handler Request DTOs
// ---------------------------------------------------------------------------

// EmptyRequest is used for endpoints with no request body (GET endpoints,
// POST endpoints driven solely by path/query params).
type EmptyRequest struct{}

// LoginRequest is the request body for POST /auth/login.
type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// ChangePasswordRequest is the request body for POST /auth/change-password.
type ChangePasswordRequest struct {
	OldPassword string `json:"old_password"`
	NewPassword string `json:"new_password"`
}

// ResetPasswordRequest is the request body for POST /actors/:id/reset-password.
type ResetPasswordRequest struct {
	NewPassword string `json:"new_password"`
}

// ---------------------------------------------------------------------------
// Typed Handler Response DTOs
// ---------------------------------------------------------------------------

// MessageResponse is returned by mutating endpoints that produce no
// domain-specific result (e.g. logout, revoke session, password change).
type MessageResponse struct {
	Message string `json:"message"`
}

// RecentActorsResponse wraps the recent actors list for the overview page.
type RecentActorsResponse struct {
	Items []ActorSummary `json:"items"`
}

// RecentAuditLogsResponse wraps recent audit logs for the overview page.
type RecentAuditLogsResponse struct {
	Items []DashboardAuditLog `json:"items"`
}

// ActorSessionsResponse wraps sessions for a specific actor.
type ActorSessionsResponse struct {
	Items []ActorSessionInfo `json:"items"`
}

// AdminListResponse wraps the full admin list.
type AdminListResponse struct {
	Items []DashboardAdmin `json:"items"`
}

// AuditLogsResponse is the paginated audit logs response.
type AuditLogsResponse struct {
	Items []DashboardAuditLog `json:"items"`
	Total int64               `json:"total"`
	Page  int                 `json:"page"`
}

// RouteInfo describes a single registered HTTP route.
type RouteInfo struct {
	Name   string `json:"name"`
	Path   string `json:"path"`
	Method string `json:"method"`
}

// RoutesResponse wraps the system routes list.
type RoutesResponse struct {
	Count  int         `json:"count"`
	Routes []RouteInfo `json:"routes"`
}

// SubserversResponse wraps the subserver list.
type SubserversResponse struct {
	Count int             `json:"count"`
	Items []SubServerInfo `json:"items"`
}

// PeersSessionsResponse wraps active Peers actor sessions.
type PeersSessionsResponse struct {
	Count int                `json:"count"`
	Items []PeersSessionInfo `json:"items"`
}

// DashboardSessionsResponse wraps active dashboard admin sessions.
type DashboardSessionsResponse struct {
	Count int                    `json:"count"`
	Items []DashboardSessionInfo `json:"items"`
}

// FriendChatStatsResponse is returned by GET /chat/friend/stats.
// Moved from application layer to domain layer for proper DDD layering.
type FriendChatStatsResponse struct {
	Sessions       int64     `json:"sessions"`
	Messages       int64     `json:"messages"`
	FriendRequests int64     `json:"friend_requests"`
	Outbox         int64     `json:"outbox"`
	Attachments    int64     `json:"attachments"`
	UpdatedAt      time.Time `json:"updated_at"`
}
