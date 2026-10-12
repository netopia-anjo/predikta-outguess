-- Preserve the old GCash fields/tables and fulfillment history for existing deployments.
ALTER TABLE events ADD COLUMN inventory_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE players ALTER COLUMN industry DROP NOT NULL;
ALTER TABLE players ALTER COLUMN challenge DROP NOT NULL;
ALTER TABLE players ALTER COLUMN planning DROP NOT NULL;

CREATE TABLE prize_catalog (
  id text PRIMARY KEY,
  name text NOT NULL,
  amount_php integer CHECK (amount_php > 0),
  position integer NOT NULL UNIQUE
);
INSERT INTO prize_catalog(id,name,amount_php,position) VALUES
  ('gcash_150','PHP 150 GCash',150,0),
  ('cellphone_holder','Cellphone Holder',NULL,1),
  ('tote_bag','Tote Bag',NULL,2),
  ('pencil_holder','Pencil Holder',NULL,3),
  ('ballpen','Ballpen',NULL,4);

CREATE TABLE prize_inventory (
  event_id text NOT NULL REFERENCES events(id),
  prize_id text NOT NULL REFERENCES prize_catalog(id),
  total integer NOT NULL DEFAULT 0 CHECK (total BETWEEN 0 AND 1000000),
  fulfilled integer NOT NULL DEFAULT 0 CHECK (fulfilled >= 0 AND fulfilled <= total),
  PRIMARY KEY (event_id, prize_id)
);
INSERT INTO prize_inventory(event_id,prize_id)
  SELECT e.id,p.id FROM events e CROSS JOIN prize_catalog p;

ALTER TABLE claims ADD COLUMN prize_id text REFERENCES prize_catalog(id);
ALTER TABLE claims ADD COLUMN wheel_snapshot jsonb;
-- Existing claimed rows keep prize_id NULL: they were fulfilled under the old flow.
