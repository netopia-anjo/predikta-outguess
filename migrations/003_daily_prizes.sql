-- Preserve legacy inventory/catalog entries and claim history for old revisions.
ALTER TABLE events ADD COLUMN active_prize_day smallint NOT NULL DEFAULT 1 CHECK (active_prize_day IN (1,2));
ALTER TABLE prize_catalog ADD COLUMN active boolean NOT NULL DEFAULT false;
ALTER TABLE prize_catalog ADD COLUMN value_php integer CHECK (value_php > 0);
INSERT INTO prize_catalog(id,name,amount_php,position,active,value_php) VALUES
  ('tote_bag_rope','Tote Bag — Rope',NULL,5,true,NULL),
  ('pen_notebook','Pen & Notebook',NULL,6,true,NULL),
  ('tote_bag_new','Tote Bag — New',NULL,7,true,NULL),
  ('magsafe_wallet','MagSafe Wallet',NULL,8,true,NULL),
  ('pouch','Pouch',NULL,9,true,NULL),
  ('predikta_package','Digicon × Predikta Package',NULL,10,true,75000),
  ('gcash_100','PHP 100 GCash',100,11,true,NULL),
  ('gcash_500','PHP 500 GCash',500,12,true,NULL),
  ('gcash_1000','PHP 1,000 GCash',1000,13,true,NULL),
  ('gcash_2000','PHP 2,000 GCash',2000,14,true,NULL);
CREATE TABLE daily_prize_inventory (
  event_id text NOT NULL REFERENCES events(id),
  day smallint NOT NULL CHECK (day IN (1,2)),
  prize_id text NOT NULL REFERENCES prize_catalog(id),
  total integer NOT NULL CHECK (total BETWEEN 0 AND 1000000),
  fulfilled integer NOT NULL DEFAULT 0 CHECK (fulfilled >= 0 AND fulfilled <= total),
  PRIMARY KEY (event_id,day,prize_id)
);
INSERT INTO daily_prize_inventory(event_id,day,prize_id,total)
SELECT e.id,d.day,p.id,CASE p.id
  WHEN 'tote_bag_rope' THEN 30 WHEN 'pen_notebook' THEN 24 WHEN 'tote_bag_new' THEN 15
  WHEN 'magsafe_wallet' THEN 25 WHEN 'pouch' THEN 25 WHEN 'predikta_package' THEN 5
  WHEN 'gcash_100' THEN 15 WHEN 'gcash_500' THEN 10 WHEN 'gcash_1000' THEN 3 WHEN 'gcash_2000' THEN 3
END FROM events e CROSS JOIN (VALUES (1),(2)) d(day) CROSS JOIN prize_catalog p WHERE p.active;
ALTER TABLE claims ADD COLUMN draw_outcome text CHECK (draw_outcome IN ('prize','no_prize'));
ALTER TABLE claims ADD COLUMN prize_day smallint CHECK (prize_day IN (1,2));
ALTER TABLE claims ADD CONSTRAINT claims_draw_outcome_consistent CHECK (
  draw_outcome IS NULL OR (claimed_at IS NOT NULL AND prize_day IS NOT NULL AND
    ((draw_outcome='prize' AND prize_id IS NOT NULL) OR (draw_outcome='no_prize' AND prize_id IS NULL)))
);
-- claimed_at remains terminal for old revisions too. New reports distinguish wins from no-prize spins.
UPDATE events SET inventory_revision=inventory_revision+1;
