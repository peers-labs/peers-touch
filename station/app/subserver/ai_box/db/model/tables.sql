-- 用户表
create table if not exists ai_box.users
(
    id                text                                   not null
        primary key,
    peers_user_id     text
        constraint users_peers_user_id_unique
            unique,
    display_name      text
        constraint users_display_name_unique
            unique,
    created_at        timestamp with time zone default now() not null,
    updated_at        timestamp with time zone default now() not null
);

-- 提供商表
create table if not exists ai_box.providers
(
    id              varchar(64)                            not null,
    name            text,
    peers_user_id   text                                   not null
        constraint providers_user_id_users_id_fk
            references ai_box.users
            on delete cascade,
    sort            integer,
    enabled         boolean,
    check_model     text,
    logo            text,
    description     text,
    key_vaults      text,
    source_type     varchar(20),
    settings        jsonb,
    accessed_at     timestamp with time zone default now() not null,
    created_at      timestamp with time zone default now() not null,
    updated_at      timestamp with time zone default now() not null,
    config          jsonb,
    constraint providers_id_user_id_pk
        primary key (id, peers_user_id)
);

-- 会话表
create table if not exists ai_box.sessions
(
    id                varchar(36) primary key,
    title             varchar(255) not null,
    description       text,
    avatar            varchar(500),
    background_color  varchar(7),
    provider_id       varchar(64) not null,
    user_id           text not null,
    model_name        varchar(100),
    pinned            boolean default false,
    group_name        varchar(100),
    created_at        timestamp with time zone default now(),
    updated_at        timestamp with time zone default now(),
    meta              jsonb,
    config_json       jsonb
);

-- 消息表
create table if not exists ai_box.messages
(
    id                varchar(36) primary key,
    session_id        varchar(36) not null references ai_box.sessions(id) on delete cascade,
    topic_id          varchar(36) references ai_box.topics(id) on delete set null,
    model_name        varchar(100),
    role              varchar(20) not null check (role in ('user', 'assistant', 'system')),
    content           text,
    error_json        jsonb,
    attachments_json  jsonb,
    images_json       jsonb,
    metadata_json     jsonb,
    plugin_json       jsonb,
    tool_calls_json   jsonb,
    reasoning_json    jsonb,
    created_at        timestamp with time zone default now(),
    updated_at        timestamp with time zone default now()
);

-- 主题表
create table if not exists ai_box.topics
(
    id                varchar(36) primary key,
    session_id        varchar(36) not null references ai_box.sessions(id) on delete cascade,
    title             varchar(255) not null,
    description       text,
    message_count     integer default 0,
    first_message_id  varchar(36) references ai_box.messages(id),
    last_message_id   varchar(36) references ai_box.messages(id),
    created_at        timestamp with time zone default now(),
    updated_at        timestamp with time zone default now()
);

-- 附件表
create table if not exists ai_box.attachments
(
    id                varchar(36) primary key,
    message_id        varchar(36) not null references ai_box.messages(id) on delete cascade,
    name              varchar(255) not null,
    size              bigint,
    type              varchar(100),
    url               varchar(1000),
    metadata_json     jsonb,
    created_at        timestamp with time zone default now()
);

-- 索引
CREATE INDEX idx_sessions_user_id ON ai_box.sessions(user_id);
CREATE INDEX idx_sessions_provider_id ON ai_box.sessions(provider_id);
CREATE INDEX idx_sessions_pinned ON ai_box.sessions(pinned) WHERE pinned = TRUE;
CREATE INDEX idx_sessions_created_at ON ai_box.sessions(created_at DESC);

CREATE INDEX idx_messages_session_id ON ai_box.messages(session_id);
CREATE INDEX idx_messages_topic_id ON ai_box.messages(topic_id);
CREATE INDEX idx_messages_created_at ON ai_box.messages(created_at DESC);
CREATE INDEX idx_messages_content_search ON ai_box.messages USING gin(to_tsvector('english', content));

CREATE INDEX idx_topics_session_id ON ai_box.topics(session_id);
CREATE INDEX idx_topics_created_at ON ai_box.topics(created_at DESC);

CREATE INDEX idx_attachments_message_id ON ai_box.attachments(message_id);
CREATE INDEX idx_attachments_type ON ai_box.attachments(type);


