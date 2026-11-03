package persistence

import "time"

// TerminalSession is the Station-persisted metadata of a device-held
// terminal session (TW-D5). The PTY/process and its bounded output ring
// live only in the Desktop Rust worker; this row never stores output or
// environment secrets. Status is RUNNING only as last reported by a live
// worker; after a worker/app restart unproven rows are downgraded UNKNOWN.
type TerminalSession struct {
	ID             string     `gorm:"primaryKey;type:varchar(40)"`
	ConversationID string     `gorm:"not null;type:varchar(36);index:idx_terminal_session_conversation"`
	TurnID         string     `gorm:"not null;type:varchar(36);default:'';index"`
	DeviceID       string     `gorm:"not null;type:varchar(64);index:idx_terminal_session_device"`
	ActorPTID      string     `gorm:"column:actor_ptid;not null;type:text;index:idx_terminal_session_actor"`
	CWD            string     `gorm:"not null;type:text;default:''"`
	Command        string     `gorm:"not null;type:varchar(255);default:''"`
	ArgsJSON       string     `gorm:"column:args_json;not null;type:text;default:'[]'"`
	PID            uint32     `gorm:"column:pid;not null;default:0"`
	Status         string     `gorm:"not null;type:varchar(20);index"`
	ExitCode       int32      `gorm:"not null;default:0"`
	OutputBytes    uint64     `gorm:"not null;default:0"`
	CreatedAt      time.Time  `gorm:"not null;autoCreateTime"`
	UpdatedAt      time.Time  `gorm:"not null;autoUpdateTime"`
	EndedAt        *time.Time `gorm:"type:timestamp"`
}

func (TerminalSession) TableName() string { return "agent_terminal_sessions" }
