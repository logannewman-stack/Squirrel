-- Purpose: a project can say why it exists.
--
-- One column, written from the helix's reading panel. Text, defaulted empty,
-- so every existing row is simply a strand whose meaning has not been written
-- down yet.
alter table projects add column if not exists meaning text not null default '';
