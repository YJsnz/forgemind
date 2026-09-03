ALTER TABLE forgelab_post ADD COLUMN imported_likes INT NOT NULL DEFAULT 0 AFTER status;
ALTER TABLE forgelab_reply ADD COLUMN imported_likes INT NOT NULL DEFAULT 0 AFTER content;

UPDATE forgelab_post SET imported_likes = CASE id
    WHEN 'wzh-line' THEN 96
    WHEN 'cnc-kit' THEN 64
    WHEN 'cross-floor' THEN 72
    WHEN 'signal-first' THEN 51
    WHEN 'resource-rule' THEN 38
    WHEN 'inspection-cell' THEN 43
    ELSE 0 END
WHERE id IN ('wzh-line', 'cnc-kit', 'cross-floor', 'signal-first', 'resource-rule', 'inspection-cell');

UPDATE forgelab_reply SET imported_likes = CASE id
    WHEN 'wzh-r1' THEN 12 WHEN 'wzh-r2' THEN 9 WHEN 'wzh-r3' THEN 7 WHEN 'wzh-r4' THEN 15
    WHEN 'cnc-r1' THEN 8 WHEN 'cnc-r2' THEN 6 WHEN 'cnc-r3' THEN 10
    WHEN 'cross-r1' THEN 11 WHEN 'cross-r2' THEN 14 WHEN 'cross-r3' THEN 5
    WHEN 'signal-r1' THEN 13 WHEN 'signal-r2' THEN 8 WHEN 'signal-r3' THEN 12
    WHEN 'rule-r1' THEN 9 WHEN 'rule-r2' THEN 7 WHEN 'rule-r3' THEN 6
    WHEN 'inspection-r1' THEN 10 WHEN 'inspection-r2' THEN 8 WHEN 'inspection-r3' THEN 11
    ELSE 0 END
WHERE id NOT LIKE 'reply-%';
