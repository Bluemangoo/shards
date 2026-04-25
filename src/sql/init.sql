CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

create table meta
(
    version integer not null
);

insert into meta (version)
values (1);

create table events
(
    id   serial primary key,
    data jsonb not null
);
create index idx_event_user_id on events ((data ->> 'user_id'));
create index idx_event_message_id on events ((data ->> 'message_id'));
create index idx_event_message_type on events ((data ->> 'message_type'));
create index idx_event_sender_user_id on events ((data -> 'sender' ->> 'user_id'));
create index idx_event_target_id on events ((data ->> 'target_id'));
create index idx_event_time on events ((data ->> 'time'));

create table working_memory
(
    id          serial primary key,
    content     text   not null,
    weight      float  not null,
    last_access bigint not null
);

create table long_term_memory
(
    id         serial primary key,
    content    text        not null,
    embedding  vector(768) not null,
    created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS memory_hnsw_idx
    ON long_term_memory USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS memory_trgm_idx
    ON long_term_memory USING gin (content gin_trgm_ops);

create table image_description
(
    id          serial primary key,
    summary     text        not null,
    description text        not null,
    created_at  timestamptz not null default now()
);

create table image_tag
(
    id         serial primary key,
    tag        text        not null,
    created_at timestamptz not null default now()
);

create table file_id_description
(
    file_id        text    not null,
    description_id integer not null references image_description (id) on delete cascade,
    primary key (file_id, description_id)
);

create table image_description_tag
(
    description_id integer not null references image_description (id) on delete cascade,
    tag_id         integer not null references image_tag (id) on delete cascade,
    primary key (description_id, tag_id)
);

create table sticker
(
    id             serial primary key,
    description_id integer     not null references image_description (id) on delete cascade,
    file_id        text        not null,
    file_name      text        not null,
    created_at     timestamptz not null default now()
);