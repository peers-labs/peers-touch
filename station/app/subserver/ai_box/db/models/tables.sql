create table public.users
(
    id                text                                   not null
        primary key,
    peers_user_id         text
        constraint users_peers_user_id_unique
            unique,
    display_name          text
        constraint users_display_name_unique
            unique,
    created_at        timestamp with time zone default now() not null,
    updated_at        timestamp with time zone default now() not null,
);

alter table ai_box.users
    owner to postgres;

create table ai_box.providers
(
    id              varchar(64)                            not null,
    name            text,
    peers_user_id         text                                   not null
        constraint ai_providers_user_id_users_id_fk
            references ai_box.users
            on delete cascade,
    sort            integer,
    enabled         boolean,
    boolean,
    check_model     text,
    logo            text comment 'logo url or base64 encoded image',
    description     text,
    key_vaults      text,
    source_type          varchar(20),
    settings        jsonb,
    accessed_at     timestamp with time zone default now() not null,
    created_at      timestamp with time zone default now() not null,
    updated_at      timestamp with time zone default now() not null,
    config          jsonb,
    constraint providers_id_user_id_pk
        primary key (id, peers_user_id)
);

alter table ai_box.providers
    owner to postgres;


