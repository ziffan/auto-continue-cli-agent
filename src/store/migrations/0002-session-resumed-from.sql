-- 0002-session-resumed-from.sql — tautkan sesi hasil resume-by-id ke sesi asalnya (I-14).
-- Sesi yang di-spawn oleh actuation resume-by-id (I-12 poin 2) adalah baris `sessions` BARU;
-- `resumed_from` menunjuk ke `sessions.id` sesi ASAL supaya `status`/riwayat bisa menautkan
-- rantai resume (sebelumnya hanya lewat event `resume_spawned` yang longgar).
-- NULL untuk sesi biasa (`acca run`). Kolom nullable default NULL → ALTER ADD COLUMN aman
-- dengan foreign_keys=ON (SQLite: FK pada kolom baru butuh default NULL).

ALTER TABLE sessions ADD COLUMN resumed_from TEXT NULL REFERENCES sessions(id);

UPDATE meta SET value = '2' WHERE key = 'schema_version';
