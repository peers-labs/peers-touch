package model

type MastodonInstance struct {
	URI              string            `json:"uri"`
	Title            string            `json:"title"`
	ShortDescription string            `json:"short_description"`
	Description      string            `json:"description"`
	Email            string            `json:"email"`
	Version          string            `json:"version"`
	Urls             map[string]string `json:"urls,omitempty"`
	Stats            *InstanceStats    `json:"stats"`
	Thumbnail        string            `json:"thumbnail,omitempty"`
	Languages        []string          `json:"languages"`
	Registrations    bool              `json:"registrations"`
	ApprovalRequired bool              `json:"approval_required"`
	InvitesEnabled   bool              `json:"invites_enabled"`
	ContactAccount   *MastodonAccount  `json:"contact_account,omitempty"`
}

type InstanceStats struct {
	UserCount   int64 `json:"user_count"`
	StatusCount int64 `json:"status_count"`
	DomainCount int64 `json:"domain_count"`
}
