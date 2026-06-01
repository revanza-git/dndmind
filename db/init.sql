CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NULL,
  system_tone text NOT NULL DEFAULT 'Helpful, cinematic, rules-aware, and concise.',
  current_session_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  client_owner_id text NOT NULL DEFAULT 'dndmind-demo-client',
  visibility text NOT NULL DEFAULT 'private',
  session_number int NOT NULL,
  title text NOT NULL,
  raw_notes text NULL,
  summary text NULL,
  status text NOT NULL DEFAULT 'planned',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_current_session_fk
  FOREIGN KEY (current_session_id) REFERENCES sessions(id) ON DELETE SET NULL;

CREATE TABLE party_characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name text NOT NULL,
  class_name text NOT NULL,
  race text NOT NULL,
  level int NOT NULL DEFAULT 1,
  hp_current int NOT NULL DEFAULT 1,
  hp_max int NOT NULL DEFAULT 1,
  armor_class int NOT NULL DEFAULT 10,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  title text NOT NULL,
  original_filename text NULL,
  content text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  campaign_id uuid NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  chunk_index int NOT NULL,
  heading text NULL,
  content text NOT NULL,
  token_count int NULL,
  embedding vector(1536) NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New conversation',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  mode text NULL,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NULL,
  success boolean NOT NULL DEFAULT true,
  error text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE npcs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  client_owner_id text NOT NULL DEFAULT 'dndmind-demo-client',
  name text NOT NULL,
  role text NULL,
  description text NULL,
  disposition text NULL,
  last_seen_session_id uuid NULL REFERENCES sessions(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT npcs_campaign_client_owner_name_key UNIQUE (campaign_id, client_owner_id, name)
);

CREATE TABLE quests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  client_owner_id text NOT NULL DEFAULT 'dndmind-demo-client',
  title text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  description text NULL,
  last_seen_session_id uuid NULL REFERENCES sessions(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quests_campaign_client_owner_title_key UNIQUE (campaign_id, client_owner_id, title)
);

CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  client_owner_id text NOT NULL DEFAULT 'dndmind-demo-client',
  name text NOT NULL,
  description text NULL,
  location_type text NULL,
  last_seen_session_id uuid NULL REFERENCES sessions(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locations_campaign_client_owner_name_key UNIQUE (campaign_id, client_owner_id, name)
);

CREATE TABLE encounters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  client_owner_id text NOT NULL DEFAULT 'dndmind-demo-client',
  session_id uuid NULL REFERENCES sessions(id) ON DELETE SET NULL,
  title text NOT NULL,
  summary text NULL,
  outcome text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memory_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  client_owner_id text NOT NULL DEFAULT 'dndmind-demo-client',
  session_id uuid NULL REFERENCES sessions(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  title text NOT NULL,
  description text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_campaign_id ON sessions(campaign_id);
CREATE INDEX idx_sessions_campaign_client_owner ON sessions(campaign_id, client_owner_id);
CREATE INDEX idx_party_characters_campaign_id ON party_characters(campaign_id);
CREATE INDEX idx_knowledge_documents_campaign_id ON knowledge_documents(campaign_id);
CREATE INDEX idx_knowledge_chunks_campaign_id ON knowledge_chunks(campaign_id);
CREATE INDEX idx_knowledge_chunks_document_id ON knowledge_chunks(document_id);
CREATE INDEX idx_knowledge_chunks_embedding_cosine
  ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 32)
  WHERE embedding IS NOT NULL;
CREATE INDEX idx_ai_conversations_campaign_id ON ai_conversations(campaign_id);
CREATE INDEX idx_ai_messages_conversation_id ON ai_messages(conversation_id);
CREATE INDEX idx_ai_tool_calls_conversation_id ON ai_tool_calls(conversation_id);
CREATE INDEX idx_npcs_campaign_id ON npcs(campaign_id);
CREATE INDEX idx_quests_campaign_id ON quests(campaign_id);
CREATE INDEX idx_locations_campaign_id ON locations(campaign_id);
CREATE INDEX idx_encounters_campaign_id ON encounters(campaign_id);
CREATE INDEX idx_memory_events_campaign_id ON memory_events(campaign_id);
CREATE INDEX idx_npcs_campaign_client_owner ON npcs(campaign_id, client_owner_id);
CREATE INDEX idx_quests_campaign_client_owner ON quests(campaign_id, client_owner_id);
CREATE INDEX idx_locations_campaign_client_owner ON locations(campaign_id, client_owner_id);
CREATE INDEX idx_encounters_campaign_client_owner ON encounters(campaign_id, client_owner_id);
CREATE INDEX idx_memory_events_campaign_client_owner ON memory_events(campaign_id, client_owner_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER campaigns_updated_at
BEFORE UPDATE ON campaigns
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER sessions_updated_at
BEFORE UPDATE ON sessions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER npcs_updated_at
BEFORE UPDATE ON npcs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER quests_updated_at
BEFORE UPDATE ON quests
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER locations_updated_at
BEFORE UPDATE ON locations
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

INSERT INTO campaigns (id, name, description, system_tone)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Shadows of Eldermire',
  'A demo campaign about a misty frontier town, a betrayed party, and old magic waking under Blackwater Mine.',
  'Cinematic, practical, and friendly to a busy Dungeon Master.'
);

INSERT INTO sessions (id, campaign_id, session_number, title, raw_notes, summary, status)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  1,
  'The Blackwater Betrayal',
  'Captain Vey betrayed the party at Blackwater Mine. He sold the old royal map to the Ashen Knives and escaped through the smuggler tunnel beneath the collapsed ore lift. Mira Thorn swore to track Vey down. Orren Vale recovered the Dawn Shard from the flooded chapel, but the relic pulsed when it came near the mine''s sealed bronze door.',
  'Captain Vey betrayed the party at Blackwater Mine, sold the royal map to the Ashen Knives, and escaped through an old smuggler tunnel. The party recovered the Dawn Shard and now needs to learn what the relic unlocks.',
  'active'
);

UPDATE campaigns
SET current_session_id = '22222222-2222-2222-2222-222222222222'
WHERE id = '11111111-1111-1111-1111-111111111111';

INSERT INTO party_characters (campaign_id, name, class_name, race, level, hp_current, hp_max, armor_class, notes)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Mira Thorn', 'Ranger', 'Human', 4, 31, 34, 15, 'Tracks ash-marked creatures. Swore to find Captain Vey.'),
  ('11111111-1111-1111-1111-111111111111', 'Orren Vale', 'Cleric', 'Dwarf', 4, 35, 35, 18, 'Keeper of the Dawn Bell. The Dawn Shard reacts near old ruins.'),
  ('11111111-1111-1111-1111-111111111111', 'Nyx', 'Rogue', 'Tiefling', 4, 24, 28, 14, 'Knows Eldermire smuggling routes and owes a debt to the Silver Lantern Inn.');

INSERT INTO npcs (id, campaign_id, name, role, description, disposition, last_seen_session_id, metadata)
VALUES
  (
    '33333333-3333-3333-3333-333333333333',
    '11111111-1111-1111-1111-111111111111',
    'Captain Vey',
    'traitor and former guide',
    'Betrayed the party at Blackwater Mine, sold the old royal map to the Ashen Knives, and escaped through a smuggler tunnel.',
    'hostile',
    '22222222-2222-2222-2222-222222222222',
    '{"source":"demo_seed"}'
  ),
  (
    '33333333-3333-3333-3333-333333333334',
    '11111111-1111-1111-1111-111111111111',
    'Mayor Elowen',
    'Eldermire patron',
    'Asked the party to protect Eldermire before the next new moon.',
    'friendly',
    '22222222-2222-2222-2222-222222222222',
    '{"source":"demo_seed"}'
  );

INSERT INTO quests (campaign_id, title, status, description, last_seen_session_id, metadata)
VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'Hunt Captain Vey',
    'open',
    'Find Captain Vey and learn who paid him to sell the royal map.',
    '22222222-2222-2222-2222-222222222222',
    '{"source":"demo_seed"}'
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'Unlock the Dawn Shard',
    'open',
    'Discover why the Dawn Shard reacts to the sealed bronze door under Blackwater Mine.',
    '22222222-2222-2222-2222-222222222222',
    '{"source":"demo_seed"}'
  );

INSERT INTO locations (campaign_id, name, description, location_type, last_seen_session_id, metadata)
VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'Blackwater Mine',
    'A flooded mine with a sealed bronze door, collapsed ore lift, and old smuggler tunnels.',
    'dungeon',
    '22222222-2222-2222-2222-222222222222',
    '{"source":"demo_seed"}'
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'Silver Lantern Inn',
    'A busy Eldermire tavern where a masked agent left a black feather as a warning.',
    'tavern',
    '22222222-2222-2222-2222-222222222222',
    '{"source":"demo_seed"}'
  );

INSERT INTO memory_events (campaign_id, session_id, event_type, title, description, metadata)
VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    'important_event',
    'Captain Vey betrayed the party',
    'Captain Vey sold the old royal map to the Ashen Knives and escaped through Blackwater Mine.',
    '{"source":"demo_seed"}'
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    'unresolved_hook',
    'Who paid Captain Vey?',
    'The party knows Vey sold the map, but not who funded the betrayal.',
    '{"source":"demo_seed"}'
  );
