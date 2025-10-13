package db

// Connection represents a database connection
type Connection struct {
	ID   uint64 `json:"id"`
	Name string `json:"name"`
}