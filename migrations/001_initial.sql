CREATE TABLE events (
  id text PRIMARY KEY,
  demo boolean NOT NULL,
  total_cap integer NOT NULL CHECK (total_cap BETWEEN 0 AND 300),
  awarded_count integer NOT NULL DEFAULT 0 CHECK (awarded_count >= 0 AND awarded_count <= total_cap),
  active_content text NOT NULL,
  consent_version text NOT NULL,
  consent_text text NOT NULL
);
CREATE TABLE content_versions (
  id text PRIMARY KEY,
  audiences jsonb NOT NULL,
  respondents jsonb NOT NULL,
  created_at bigint NOT NULL
);
ALTER TABLE events ADD FOREIGN KEY (active_content) REFERENCES content_versions(id);
CREATE TABLE gc_blocks (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events(id),
  starts_at bigint NOT NULL,
  ends_at bigint NOT NULL CHECK (ends_at > starts_at),
  allocation integer NOT NULL CHECK (allocation >= 0)
);
CREATE INDEX gc_blocks_event_start ON gc_blocks(event_id, starts_at);
CREATE TABLE players (
  id uuid PRIMARY KEY,
  event_id text NOT NULL REFERENCES events(id),
  content_version text NOT NULL REFERENCES content_versions(id),
  signup_key text NOT NULL,
  signup_digest text NOT NULL,
  source text NOT NULL CHECK (source IN ('phone', 'tv')),
  name text NOT NULL,
  mobile text NOT NULL CHECK (mobile ~ '^09[0-9]{9}$'),
  email text NOT NULL,
  company text NOT NULL,
  role text NOT NULL,
  industry text NOT NULL,
  challenge text NOT NULL,
  planning text NOT NULL,
  consent_version text NOT NULL,
  consent_text text NOT NULL,
  consent_at bigint NOT NULL,
  marketing_optin boolean NOT NULL,
  audience_id text,
  wants_sim boolean NOT NULL DEFAULT false,
  score integer CHECK (score BETWEEN 0 AND 690),
  total_ms integer,
  correct integer,
  persona text,
  created_at bigint NOT NULL,
  finished_at bigint,
  session_expires bigint NOT NULL,
  UNIQUE (event_id, mobile),
  UNIQUE (event_id, signup_key)
);
CREATE INDEX players_event_finish ON players(event_id, finished_at);
CREATE TABLE rounds (
  player_id uuid NOT NULL REFERENCES players(id),
  idx integer NOT NULL CHECK (idx BETWEEN 0 AND 2),
  started_at bigint NOT NULL,
  locked_at bigint,
  pick text CHECK (pick IN ('a', 'b')),
  conf integer CHECK (conf BETWEEN 0 AND 2),
  correct boolean,
  points integer,
  bonus integer,
  ms_used integer,
  reveal jsonb,
  PRIMARY KEY (player_id, idx)
);
CREATE TABLE claims (
  player_id uuid PRIMARY KEY REFERENCES players(id),
  event_id text NOT NULL REFERENCES events(id),
  code text NOT NULL UNIQUE,
  awarded_at bigint NOT NULL,
  claimed_at bigint,
  staff_session uuid
);
CREATE TABLE staff_sessions (
  id uuid PRIMARY KEY,
  expires_at bigint NOT NULL,
  created_at bigint NOT NULL
);
ALTER TABLE claims ADD FOREIGN KEY (staff_session) REFERENCES staff_sessions(id);
CREATE TABLE login_throttles (
  identity text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  locked_until bigint NOT NULL DEFAULT 0,
  updated_at bigint NOT NULL
);
