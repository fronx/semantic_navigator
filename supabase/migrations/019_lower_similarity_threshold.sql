-- Lower similarity threshold from 0.7 to 0.5 for more clustering
-- This captures more synonym relationships that were being missed

-- Clear existing similarities (will be recomputed)
TRUNCATE keyword_similarities;

-- Update the trigger function with lower threshold
CREATE OR REPLACE FUNCTION on_keyword_insert() RETURNS TRIGGER AS $$
BEGIN
  -- Only process article-level keywords with embeddings
  IF NEW.node_type = 'article' AND NEW.embedding IS NOT NULL THEN
    INSERT INTO keyword_similarities (keyword_a_id, keyword_b_id, similarity)
    SELECT
      LEAST(NEW.id, k.id),
      GREATEST(NEW.id, k.id),
      1 - (NEW.embedding <=> k.embedding)
    FROM keywords k
    WHERE k.id != NEW.id
      AND k.node_type = 'article'
      AND k.embedding IS NOT NULL
      AND (NEW.embedding <=> k.embedding) < 0.5  -- cosine distance < 0.5 = similarity > 0.5
    ON CONFLICT (keyword_a_id, keyword_b_id) DO UPDATE
      SET similarity = EXCLUDED.similarity;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
