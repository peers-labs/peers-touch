package model

// 示例：如何使用这些模型
/*

// 1. 创建用户
user := &models.User{
    ID:          uuid.New().String(),
    PeersUserID: ptr.String("user123"),
    DisplayName: ptr.String("张三"),
    CreatedAt:   time.Now(),
    UpdatedAt:   time.Now(),
}
db.Create(user)

// 2. 创建提供商
provider := &models.Provider{
    ID:          "openai-gpt4",
    Name:        ptr.String("OpenAI GPT-4"),
    PeersUserID: user.PeersUserID,
    Sort:        ptr.Int(1),
    Enabled:     ptr.Bool(true),
    CheckModel:  ptr.String("gpt-4"),
    SourceType:  ptr.String("api"),
    Settings:    json.RawMessage(`{"max_tokens": 4096}`),
    Config:      json.RawMessage(`{"api_key": "sk-xxx"}`),
    CreatedAt:   time.Now(),
    UpdatedAt:   time.Now(),
}
db.Create(provider)

// 3. 创建会话
session := &models.Session{
    ID:             uuid.New().String(),
    Title:          "AI助手对话",
    Description:    ptr.String("关于编程帮助的对话"),
    ProviderID:     provider.ID,
    UserID:         user.ID,
    ModelName:      ptr.String("gpt-4"),
    Pinned:         ptr.Bool(false),
    CreatedAt:      time.Now(),
    UpdatedAt:      time.Now(),
    Meta:           json.RawMessage(`{"language": "zh-CN"}`),
    ConfigJSON:     json.RawMessage(`{"temperature": 0.7}`),
}
db.Create(session)

// 4. 创建消息
message := &models.Message{
    ID:        uuid.New().String(),
    SessionID: session.ID,
    Role:      "user",
    Content:   ptr.String("请帮我写一个Go函数"),
    CreatedAt: time.Now(),
    UpdatedAt: time.Now(),
}
db.Create(message)

// 5. 查询关联数据
var sessionWithRelations models.Session
db.Preload("Provider").Preload("User").Preload("Messages").First(&sessionWithRelations, "id = ?", session.ID)

// 6. 复杂查询
var sessions []models.Session
db.Where("user_id = ? AND pinned = ?", user.ID, true).
   Order("created_at DESC").
   Find(&sessions)

*/
