-- NULL retains the original round order for existing players/content versions.
ALTER TABLE players ADD COLUMN round_indices smallint[];
ALTER TABLE players ADD CONSTRAINT players_round_selection_valid CHECK (
  round_indices IS NULL OR (
    array_ndims(round_indices)=1 AND array_lower(round_indices,1)=1 AND cardinality(round_indices)=3
    AND array_position(round_indices,NULL) IS NULL
    AND round_indices[1] BETWEEN 0 AND 4 AND round_indices[2] BETWEEN 0 AND 4 AND round_indices[3] BETWEEN 0 AND 4
    AND round_indices[1]<>round_indices[2] AND round_indices[1]<>round_indices[3] AND round_indices[2]<>round_indices[3]
  )
);
