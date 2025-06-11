package native

import "time"

type RegisterRecord struct {
	ID         uint64
	PeerId     string
	PeerName   string
	Version    string
	EndStation string
	UpdatedAt  time.Time
	CreatedAt  time.Time
	Signature  string
}

func (r *RegisterRecord) TableName() string {
	return "register_record"
}
