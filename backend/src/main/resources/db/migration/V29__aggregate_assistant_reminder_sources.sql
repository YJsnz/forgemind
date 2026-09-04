-- Persist multi-source proactive event aggregation without mixing it into factory facts.
ALTER TABLE assistant_reminder_event
  ADD COLUMN source_summary VARCHAR(1200) NOT NULL DEFAULT '[]',
  ADD COLUMN occurrence_count INT NOT NULL DEFAULT 1,
  ADD COLUMN first_observed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);
