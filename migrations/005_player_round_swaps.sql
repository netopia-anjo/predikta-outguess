-- NULL preserves the displayed A/B assignments of existing games.
ALTER TABLE players ADD COLUMN round_swaps boolean[];
ALTER TABLE players ADD CONSTRAINT players_round_swaps_valid CHECK (
  round_swaps IS NULL OR (
    round_indices IS NOT NULL
    AND array_ndims(round_swaps)=1 AND array_lower(round_swaps,1)=1 AND cardinality(round_swaps)=3
    AND array_position(round_swaps,NULL) IS NULL
  )
);
