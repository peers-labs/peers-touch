package persistence

import "time"

// BrowserSession is the Station-persisted metadata of a device-held real
// browser session (TW-D6). The browser process, tabs, page content, cookies
// and credentials live on the Desktop worker; this row binds the session to
// a task conversation/device and records tab generations + control lease so
// ownership and takeover state survive Station restarts.
type BrowserSession struct {
	ID             string `gorm:"primaryKey;type:varchar(40)"`
	ConversationID string `gorm:"type:varchar(36);index;not null;default:''"`
	TurnID         string `gorm:"type:varchar(40);not null;default:''"`
	DeviceID       string `gorm:"type:varchar(64);index;not null"`
	ActorPTID      string `gorm:"column:actor_ptid;type:text;index;not null"`
	// Verified host engine identity the worker proved, e.g.
	// "google-chrome/156.0.8078.79". Configuration strings are not stored.
	Engine string `gorm:"type:varchar(128);not null;default:''"`
	// active | closed | unknown
	Status string `gorm:"not null;type:varchar(20);index"`
	// agent | human
	Lease string `gorm:"not null;type:varchar(10);default:'agent'"`
	// JSON-encoded []BrowserTab: tab id, observation generation, url, title.
	TabsJSON  string `gorm:"column:tabs_json;type:TEXT;not null;default:'[]'"`
	CreatedAt time.Time
	EndedAt   *time.Time
}

func (BrowserSession) TableName() string { return "agent_browser_sessions" }
