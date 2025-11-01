# PostgreSQL Vector Storage 设计

## 概述

基于LobeChat的设计，我们采用PostgreSQL + pgvector作为向量存储方案，支持语义搜索和RAG功能。

## pgvector 安装和配置

### 1. 安装pgvector扩展
```sql
-- 在PostgreSQL中启用pgvector扩展
CREATE EXTENSION IF NOT EXISTS vector;
```

### 2. 向量字段设计

```sql
-- 文档向量存储表
CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    knowledge_base_id TEXT NOT NULL,
    title TEXT,
    content TEXT,
    content_type TEXT DEFAULT 'text',
    metadata JSONB,
    vector_id TEXT,
    embedding vector(1536), -- OpenAI embedding维度
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 创建向量索引
CREATE INDEX idx_documents_embedding ON documents USING ivfflat (embedding vector_cosine_ops);
```

### 3. GORM集成

我们需要添加pgvector的GORM支持：

```go
// 在go.mod中添加
go get github.com/pgvector/pgvector-go
```

### 4. 向量类型定义

```go
import (
    "github.com/pgvector/pgvector-go"
)

// DocumentVector represents document with vector embedding
type DocumentVector struct {
    ID          string                 `json:"id" gorm:"primaryKey;type:text"`
    DocumentID  string                 `json:"document_id" gorm:"not null;type:text;index"`
    Embedding   pgvector.Vector        `json:"embedding" gorm:"type:vector(1536)"`
    ContentHash string                 `json:"content_hash" gorm:"type:text;index"` // 用于检测内容变化
    Metadata    map[string]interface{} `json:"metadata" gorm:"serializer:json;type:jsonb"`
    CreatedAt   time.Time              `json:"created_at"`
    UpdatedAt   time.Time              `json:"updated_at"`
}
```

## 向量搜索功能

### 1. 相似度搜索
```go
// SearchSimilarDocuments searches for similar documents using vector similarity
func (s *Service) SearchSimilarDocuments(ctx context.Context, queryVector []float32, limit int) ([]*DocumentVector, error) {
    db, err := s.store.RDS(ctx)
    if err != nil {
        return nil, err
    }

    var results []*DocumentVector
    query := `
        SELECT *, (embedding <=> ?) as distance 
        FROM document_vectors 
        ORDER BY embedding <=> ? 
        LIMIT ?
    `
    
    if err := db.Raw(query, queryVector, queryVector, limit).Scan(&results).Error; err != nil {
        return nil, err
    }
    
    return results, nil
}
```

### 2. 混合搜索（向量+全文）
```go
// HybridSearch performs combined vector and full-text search
func (s *Service) HybridSearch(ctx context.Context, query string, queryVector []float32, limit int) ([]*Document, error) {
    db, err := s.store.RDS(ctx)
    if err != nil {
        return nil, err
    }

    var results []*Document
    querySQL := `
        SELECT d.*, 
               (embedding <=> ?) as vector_score,
               ts_rank(to_tsvector('english', d.content), plainto_tsquery(?)) as text_score,
               ((embedding <=> ?) * 0.7 + ts_rank(to_tsvector('english', d.content), plainto_tsquery(?)) * 0.3) as combined_score
        FROM documents d
        WHERE embedding <=> ? < 0.8 OR to_tsvector('english', d.content) @@ plainto_tsquery(?)
        ORDER BY combined_score ASC
        LIMIT ?
    `
    
    if err := db.Raw(querySQL, queryVector, query, queryVector, query, queryVector, query, limit).Scan(&results).Error; err != nil {
        return nil, err
    }
    
    return results, nil
}
```

## 与LobeChat对比

### 相似之处
1. **PostgreSQL + pgvector**: 都采用相同的技术栈
2. **JSONB字段**: 使用PostgreSQL的JSONB存储配置和元数据
3. **分层设计**: Agent、Conversation、Message分离
4. **向量索引**: 使用ivfflat索引优化向量搜索

### 优化点
1. **更简洁的表结构**: 减少不必要的关联
2. **更好的索引策略**: 针对Peers-Touch场景优化
3. **模块化设计**: 易于扩展和维护

## 性能优化

### 1. 索引优化
```sql
-- 复合索引
CREATE INDEX idx_docs_kb_created ON documents(knowledge_base_id, created_at DESC);
CREATE INDEX idx_docs_vector_id ON documents(vector_id);

-- 部分索引
CREATE INDEX idx_active_agents ON agents(is_active) WHERE is_active = true;
```

### 2. 查询优化
- 使用预编译语句
- 合理使用连接池
- 分页查询避免全表扫描

## 部署建议

### 1. PostgreSQL配置
```sql
-- 调整work_mem以支持向量操作
SET work_mem = '256MB';

-- 调整shared_buffers
SET shared_buffers = '2GB';
```

### 2. 硬件要求
- 内存: 至少8GB (推荐16GB+)
- 存储: SSD推荐
- CPU: 多核CPU支持并行向量计算

## 使用示例

```bash
# 创建启用了pgvector的数据库
createdb aibox_db
psql aibox_db -c "CREATE EXTENSION vector;"

# 运行迁移
go run main.go
```