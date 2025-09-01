module github.com/dirty-bro-tech/peers-touch-go/core/store/rds/sqlite

go 1.23.10

toolchain go1.24.0

replace github.com/dirty-bro-tech/peers-touch-go => ./../../../../..

require (
	github.com/dirty-bro-tech/peers-touch-go v0.0.0-20250319154115-dcf7e4a01b62
	gorm.io/driver/sqlite v1.5.7
)

require (
	github.com/jinzhu/inflection v1.0.0 // indirect
	github.com/jinzhu/now v1.1.5 // indirect
	github.com/mattn/go-sqlite3 v1.14.24 // indirect
	gorm.io/gorm v1.25.12 // indirect
)
