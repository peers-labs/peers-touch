package test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// TestFramework 提供共享的测试基础设施
type TestFramework struct {
	DB  *gorm.DB
	Ctx context.Context
}

// NewTestFramework 创建新的测试框架实例
func NewTestFramework(t *testing.T) *TestFramework {
	// 创建内存SQLite数据库
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err, "Failed to create test database")

	return &TestFramework{
		DB:  db,
		Ctx: context.Background(),
	}
}

// AutoMigrate 自动迁移表结构
func (tf *TestFramework) AutoMigrate(t *testing.T, models ...interface{}) {
	err := tf.DB.AutoMigrate(models...)
	require.NoError(t, err, "Failed to migrate database tables")
}

// Cleanup 清理所有表数据
func (tf *TestFramework) Cleanup(t *testing.T, tables ...string) {
	// 如果没有指定表名，清理所有表
	if len(tables) == 0 {
		tables = []string{
			"agents", "conversations", "documents", "knowledge_bases",
		}
	}

	// 按依赖关系顺序清理
	for _, table := range tables {
		// 只清理已存在的表
		err := tf.DB.Exec("DELETE FROM " + table).Error
		// 忽略表不存在的错误
		if err != nil && !isTableNotFoundError(err) {
			assert.NoError(t, err, "Failed to cleanup table %s", table)
		}
	}
}

// isTableNotFoundError 检查是否为表不存在错误
func isTableNotFoundError(err error) bool {
	// SQLite错误消息中包含"no such table"
	return err != nil && (err.Error() == "record not found" ||
		err.Error() == "sql: no rows in result set" ||
		contains(err.Error(), "no such table"))
}

// contains 检查字符串是否包含子串
func contains(s, substr string) bool {
	return len(s) >= len(substr) &&
		(s == substr || len(s) > len(substr) && (s[:len(substr)] == substr ||
			s[len(s)-len(substr):] == substr ||
			indexOf(s, substr) >= 0))
}

// indexOf 查找子串在字符串中的位置
func indexOf(s, substr string) int {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}

// GenerateID 生成测试用的ID
func GenerateID() string {
	return uuid.New().String()
}
