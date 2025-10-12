package user

import (
	"github.com/dirty-bro-tech/peers-touch-go/touch/model/db"
	"gorm.io/gorm"
)

// User represents a user in the system
type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Email    string `json:"email"`
}

// GetUserByName retrieves a user by their name
func GetUserByName(database *gorm.DB, name string) (*db.User, error) {
	var user db.User
	err := database.Where("name = ?", name).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// GetUserByEmail retrieves a user by their email
func GetUserByEmail(database *gorm.DB, email string) (*db.User, error) {
	var user db.User
	err := database.Where("email = ?", email).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// CreateUser creates a new user
func CreateUser(database *gorm.DB, user *db.User) error {
	return database.Create(user).Error
}

// UpdateUser updates an existing user
func UpdateUser(database *gorm.DB, user *db.User) error {
	return database.Save(user).Error
}

// DeleteUser deletes a user by ID
func DeleteUser(database *gorm.DB, userID uint64) error {
	return database.Delete(&db.User{}, userID).Error
}