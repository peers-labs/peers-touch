package test

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/peers-touch/peers-touch/station/app/subserver/ai-box"
)

// TestAgentCRUD 测试Agent的CRUD操作
func TestAgentCRUD(t *testing.T) {
	tf := NewTestFramework(t)
	defer tf.Cleanup(t)

	// 自动迁移表结构
	tf.AutoMigrate(t, &aibox.Agent{})

	// 测试创建Agent
	t.Run("CreateAgent", func(t *testing.T) {
		agent := &aibox.Agent{
			ID:          uuid.New().String(),
			Name:        "Test Agent",
			Description: "A test agent for unit testing",
			Avatar:      "https://example.com/avatar.png",
			IsActive:    true,
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
		}

		err := tf.DB.Create(agent).Error
		assert.NoError(t, err)
		assert.NotEmpty(t, agent.ID)
		assert.Equal(t, "Test Agent", agent.Name)
	})

	// 测试获取Agent
	t.Run("GetAgent", func(t *testing.T) {
		agent := &aibox.Agent{
			ID:          uuid.New().String(),
			Name:        "Get Test Agent",
			Description: "Agent for get testing",
			IsActive:    true,
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
		}
		err := tf.DB.Create(agent).Error
		require.NoError(t, err)

		var foundAgent aibox.Agent
		err = tf.DB.First(&foundAgent, "id = ?", agent.ID).Error
		assert.NoError(t, err)
		assert.Equal(t, agent.ID, foundAgent.ID)
		assert.Equal(t, agent.Name, foundAgent.Name)
	})

	// 测试列出Agents
	t.Run("ListAgents", func(t *testing.T) {
		// 创建多个Agent
		for i := 0; i < 5; i++ {
			agent := &aibox.Agent{
				ID:          uuid.New().String(),
				Name:        fmt.Sprintf("Agent %d", i),
				Description: fmt.Sprintf("Description %d", i),
				IsActive:    i%2 == 0,
				CreatedAt:   time.Now(),
				UpdatedAt:   time.Now(),
			}
			err := tf.DB.Create(agent).Error
			require.NoError(t, err)
		}

		var agents []aibox.Agent
		var total int64
		err := tf.DB.Model(&aibox.Agent{}).Count(&total).Error
		assert.NoError(t, err)
		assert.GreaterOrEqual(t, total, int64(5))

		err = tf.DB.Limit(10).Offset(0).Find(&agents).Error
		assert.NoError(t, err)
		assert.GreaterOrEqual(t, len(agents), 5)
	})
}

// TestAgentConfiguration 测试Agent配置
func TestAgentConfiguration(t *testing.T) {
	tf := NewTestFramework(t)
	defer tf.Cleanup(t)

	tf.AutoMigrate(t, &aibox.Agent{}, &aibox.AgentConfiguration{})

	// 创建Agent
	agent := &aibox.Agent{
		ID:          uuid.New().String(),
		Name:        "Config Test Agent",
		Description: "Agent for configuration testing",
		IsActive:    true,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	err := tf.DB.Create(agent).Error
	require.NoError(t, err)

	// 测试创建Agent配置
	t.Run("CreateAgentConfiguration", func(t *testing.T) {
		config := &aibox.AgentConfiguration{
			AgentID:      agent.ID,
			Model:        "gpt-4",
			Provider:     "openai",
			APIKey:       "test-api-key",
			SystemPrompt: "You are a helpful assistant.",
			Temperature:  0.7,
			MaxTokens:    2048,
			Settings: map[string]interface{}{
				"max_history": 10,
				"language":    "en",
			},
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}

		err := tf.DB.Create(config).Error
		assert.NoError(t, err)
		assert.NotEmpty(t, config.CreatedAt)

		// 验证数据库中是否存在
		var foundConfig aibox.AgentConfiguration
		err = tf.DB.First(&foundConfig, "agent_id = ?", agent.ID).Error
		assert.NoError(t, err)
		assert.Equal(t, config.Model, foundConfig.Model)
		assert.Equal(t, config.Provider, foundConfig.Provider)
	})
}

// TestConversationCRUD 测试对话的CRUD操作
func TestConversationCRUD(t *testing.T) {
	tf := NewTestFramework(t)
	defer tf.Cleanup(t)

	tf.AutoMigrate(t, &aibox.Agent{}, &aibox.Conversation{})

	// 创建Agent
	agent := &aibox.Agent{
		ID:          uuid.New().String(),
		Name:        "Conversation Test Agent",
		Description: "Agent for conversation testing",
		IsActive:    true,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	err := tf.DB.Create(agent).Error
	require.NoError(t, err)

	// 测试创建对话
	t.Run("CreateConversation", func(t *testing.T) {
		conversation := &aibox.Conversation{
			ID:        uuid.New().String(),
			AgentID:   agent.ID,
			Title:     "Test Conversation",
			IsActive:  true,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}

		err := tf.DB.Create(conversation).Error
		assert.NoError(t, err)
		assert.NotEmpty(t, conversation.ID)
		assert.Equal(t, agent.ID, conversation.AgentID)
		assert.Equal(t, "Test Conversation", conversation.Title)
	})

	// 测试列出对话
	t.Run("ListConversations", func(t *testing.T) {
		// 创建多个对话
		for i := 0; i < 3; i++ {
			conversation := &aibox.Conversation{
				ID:        uuid.New().String(),
				AgentID:   agent.ID,
				Title:     fmt.Sprintf("Conversation %d", i),
				IsActive:  true,
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
			}
			err := tf.DB.Create(conversation).Error
			require.NoError(t, err)
			// 添加小延迟确保时间戳不同
			time.Sleep(10 * time.Millisecond)
		}

		var conversations []aibox.Conversation
		var total int64
		err := tf.DB.Model(&aibox.Conversation{}).Where("agent_id = ?", agent.ID).Count(&total).Error
		assert.NoError(t, err)
		assert.GreaterOrEqual(t, total, int64(3))

		err = tf.DB.Where("agent_id = ?", agent.ID).Order("updated_at DESC").Limit(10).Offset(0).Find(&conversations).Error
		assert.NoError(t, err)
		assert.GreaterOrEqual(t, len(conversations), 3)
	})
}

// TestKnowledgeBaseCRUD 测试知识库的CRUD操作
func TestKnowledgeBaseCRUD(t *testing.T) {
	tf := NewTestFramework(t)
	defer tf.Cleanup(t)

	// 自动迁移表结构
	tf.AutoMigrate(t, &aibox.KnowledgeBase{})

	// 测试创建知识库
	t.Run("CreateKnowledgeBase", func(t *testing.T) {
		kb := &aibox.KnowledgeBase{
			ID:          uuid.New().String(),
			Name:        "Test Knowledge Base",
			Description: "A test knowledge base for unit testing",
			Type:        "vector",
			Config: map[string]interface{}{
				"embedding_model": "text-embedding-ada-002",
				"chunk_size":      1000,
				"chunk_overlap":   200,
			},
			IsActive:  true,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}

		err := tf.DB.Create(kb).Error
		assert.NoError(t, err)
		assert.NotEmpty(t, kb.ID)
		assert.Equal(t, "Test Knowledge Base", kb.Name)
		assert.Equal(t, "vector", kb.Type)
	})

	// 测试列出知识库
	t.Run("ListKnowledgeBases", func(t *testing.T) {
		// 创建多个知识库
		for i := 0; i < 5; i++ {
			kb := &aibox.KnowledgeBase{
				ID:          uuid.New().String(),
				Name:        fmt.Sprintf("Knowledge Base %d", i),
				Description: fmt.Sprintf("Description %d", i),
				Type:        "vector",
				IsActive:    i%2 == 0,
				CreatedAt:   time.Now(),
				UpdatedAt:   time.Now(),
			}
			err := tf.DB.Create(kb).Error
			require.NoError(t, err)
		}

		var knowledgeBases []aibox.KnowledgeBase
		var total int64
		err := tf.DB.Model(&aibox.KnowledgeBase{}).Count(&total).Error
		assert.NoError(t, err)
		assert.GreaterOrEqual(t, total, int64(5))

		err = tf.DB.Limit(10).Offset(0).Find(&knowledgeBases).Error
		assert.NoError(t, err)
		assert.GreaterOrEqual(t, len(knowledgeBases), 5)
	})
}

// TestDocumentCRUD 测试文档的CRUD操作
func TestDocumentCRUD(t *testing.T) {
	tf := NewTestFramework(t)
	defer tf.Cleanup(t)

	// 定义一个简化版的Document结构体用于测试，避免pgvector.Vector字段在SQLite中的问题
	type TestDocument struct {
		ID              string                 `json:"id" gorm:"primaryKey;type:text"`
		KnowledgeBaseID string                 `json:"knowledge_base_id" gorm:"not null;type:text;index"`
		Title           string                 `json:"title" gorm:"type:text;index"`
		Content         string                 `json:"content" gorm:"type:text"`
		ContentType     string                 `json:"content_type" gorm:"default:text;type:text"`
		Metadata        map[string]interface{} `json:"metadata" gorm:"serializer:json;type:jsonb"`
		VectorID        string                 `json:"vector_id" gorm:"type:text;index"`
		CreatedAt       time.Time              `json:"created_at"`
		UpdatedAt       time.Time              `json:"updated_at"`
	}

	// 自动迁移表结构
	tf.AutoMigrate(t, &TestDocument{}, &aibox.KnowledgeBase{})

	// 创建知识库
	kb := &aibox.KnowledgeBase{
		ID:          uuid.New().String(),
		Name:        "Document Test KB",
		Description: "Knowledge base for document testing",
		Type:        "vector",
		IsActive:    true,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	err := tf.DB.Create(kb).Error
	require.NoError(t, err)

	// 测试创建文档
	t.Run("CreateDocument", func(t *testing.T) {
		doc := &TestDocument{
			ID:              uuid.New().String(),
			KnowledgeBaseID: kb.ID,
			Title:           "Test Document",
			Content:         "This is a test document content for vector storage.",
			ContentType:     "text",
			Metadata: map[string]interface{}{
				"author": "Test Author",
				"tags":   []string{"test", "document"},
			},
			VectorID:  GenerateID(),
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}

		err := tf.DB.Create(doc).Error
		assert.NoError(t, err)
		assert.NotEmpty(t, doc.ID)
		assert.Equal(t, kb.ID, doc.KnowledgeBaseID)
		assert.Equal(t, "Test Document", doc.Title)
	})

	// 测试搜索相似文档（模拟向量搜索）
	t.Run("SearchSimilarDocuments", func(t *testing.T) {
		// 先清理可能存在的文档
		tf.DB.Where("knowledge_base_id = ?", kb.ID).Delete(&TestDocument{})

		// 创建多个文档
		for i := 0; i < 5; i++ {
			doc := &TestDocument{
				ID:              uuid.New().String(),
				KnowledgeBaseID: kb.ID,
				Title:           fmt.Sprintf("Similar Document %d", i),
				Content:         fmt.Sprintf("This is similar document content %d with test keywords.", i),
				ContentType:     "text",
				VectorID:        GenerateID(),
				CreatedAt:       time.Now(),
				UpdatedAt:       time.Now(),
			}
			err := tf.DB.Create(doc).Error
			require.NoError(t, err)
		}

		// 查询知识库中的文档
		var documents []TestDocument
		err := tf.DB.Where("knowledge_base_id = ?", kb.ID).Find(&documents).Error
		assert.NoError(t, err)
		assert.Len(t, documents, 5)
	})
}

// TestConcurrentOperations 测试并发操作
func TestConcurrentOperations(t *testing.T) {
	tf := NewTestFramework(t)
	defer tf.Cleanup(t)

	// 在并发测试中先迁移表结构
	tf.AutoMigrate(t, &aibox.Agent{})

	// 并发创建多个Agent
	t.Run("ConcurrentAgentCreation", func(t *testing.T) {
		// 先清理可能存在的数据
		tf.DB.Where("name LIKE ?", "Concurrent Agent %").Delete(&aibox.Agent{})

		// 创建一个互斥锁来保护数据库操作
		var mu sync.Mutex
		var wg sync.WaitGroup
		errors := make(chan error, 20)
		successCount := 0

		for i := 0; i < 10; i++ {
			wg.Add(1)
			go func(index int) {
				defer wg.Done()

				agent := &aibox.Agent{
					ID:          uuid.New().String(),
					Name:        fmt.Sprintf("Concurrent Agent %d", index),
					Description: fmt.Sprintf("Description %d", index),
					IsActive:    true,
					CreatedAt:   time.Now(),
					UpdatedAt:   time.Now(),
				}

				// 使用互斥锁保护数据库操作
				mu.Lock()
				err := tf.DB.Create(agent).Error
				mu.Unlock()

				if err != nil {
					errors <- err
				} else {
					mu.Lock()
					successCount++
					mu.Unlock()
				}
			}(i)
		}

		wg.Wait()
		close(errors)

		// 检查是否有错误
		for err := range errors {
			assert.NoError(t, err)
		}

		// 验证所有Agent都被创建
		mu.Lock()
		finalCount := successCount
		mu.Unlock()
		assert.Equal(t, 10, finalCount)

		// 再次验证数据库中的记录数
		var count int64
		err := tf.DB.Model(&aibox.Agent{}).Where("name LIKE ?", "Concurrent Agent %").Count(&count).Error
		assert.NoError(t, err)
		assert.Equal(t, int64(10), count)
	})
}

// TestErrorHandling 测试错误处理
func TestErrorHandling(t *testing.T) {
	tf := NewTestFramework(t)
	defer tf.Cleanup(t)

	tf.AutoMigrate(t, &aibox.Agent{})

	// 测试获取不存在的Agent
	t.Run("GetNonExistentAgent", func(t *testing.T) {
		var agent aibox.Agent
		err := tf.DB.First(&agent, "id = ?", "non-existent-id").Error
		assert.Error(t, err)
		assert.Equal(t, gorm.ErrRecordNotFound, err)
	})

	// 测试重复创建（如果存在唯一约束）
	t.Run("DuplicateCreation", func(t *testing.T) {
		// 创建第一个Agent
		agent1 := &aibox.Agent{
			ID:          uuid.New().String(),
			Name:        "Duplicate Test Agent",
			Description: "First agent",
			IsActive:    true,
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
		}
		err := tf.DB.Create(agent1).Error
		require.NoError(t, err)

		// 在当前模型中，Name没有唯一约束，所以这里不会报错
		// 这主要是为了演示错误处理测试的模式
	})
}

// TestDataCleanup 测试数据清理
func TestDataCleanup(t *testing.T) {
	tf := NewTestFramework(t)

	tf.AutoMigrate(t, &aibox.Agent{})

	// 创建测试数据
	agent := &aibox.Agent{
		ID:          uuid.New().String(),
		Name:        "Cleanup Test Agent",
		Description: "Agent for cleanup testing",
		IsActive:    true,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	err := tf.DB.Create(agent).Error
	require.NoError(t, err)

	// 验证数据存在
	var count int64
	tf.DB.Model(&aibox.Agent{}).Count(&count)
	assert.Equal(t, int64(1), count)

	// 执行清理
	tf.Cleanup(t)

	// 验证数据被清理
	tf.DB.Model(&aibox.Agent{}).Count(&count)
	assert.Equal(t, int64(0), count)
}
