-- Enable pgvector
create extension if not exists vector;

-- Videos table: one row per YouTube video
create table if not exists advisor_videos (
  id          text primary key,           -- YouTube video ID
  title       text not null,
  published_at timestamptz,
  duration    text,
  ingested_at  timestamptz default now()
);

-- Transcript chunks: one row per ~500-token chunk
create table if not exists advisor_chunks (
  id          bigserial primary key,
  video_id    text not null references advisor_videos(id) on delete cascade,
  chunk_index int  not null,
  text        text not null,
  embedding   vector(512),               -- voyage-3-lite dimension
  created_at  timestamptz default now()
);

-- Index for fast similarity search
create index if not exists advisor_chunks_embedding_idx
  on advisor_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

-- RLS: allow anon reads (chatbot runs in browser)
alter table advisor_videos  enable row level security;
alter table advisor_chunks  enable row level security;

create policy "public read videos"  on advisor_videos  for select using (true);
create policy "public read chunks"  on advisor_chunks  for select using (true);
create policy "service insert videos" on advisor_videos  for insert with check (true);
create policy "service insert chunks" on advisor_chunks  for insert with check (true);

-- Match function for similarity search
create or replace function match_advisor_chunks(
  query_embedding vector(512),
  match_count     int default 8
)
returns table (
  id          bigint,
  video_id    text,
  chunk_index int,
  text        text,
  similarity  float
)
language sql stable
as $$
  select
    ac.id,
    ac.video_id,
    ac.chunk_index,
    ac.text,
    1 - (ac.embedding <=> query_embedding) as similarity
  from advisor_chunks ac
  where ac.embedding is not null
  order by ac.embedding <=> query_embedding
  limit match_count;
$$;
