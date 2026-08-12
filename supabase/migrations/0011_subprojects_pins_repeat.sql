-- The four fields the planner grew, so they survive a second device.
--
-- Sub-projects, pins and repetition were added to the local store without
-- reaching this schema, which is the quiet half of that bug: everything works
-- perfectly on one machine and silently loses meaning on the next sync. A
-- branch would arrive on the iPhone with no parent, a block dragged to
-- Thursday would come back unpinned, and a weekly task would stop coming
-- back. Nothing errors — the data just isn't there.
--
-- All four are nullable with sane defaults, so every existing row keeps its
-- current behaviour: no parent, no pin, no repetition.

-- A project may grow off another project. Self-referencing, nullable, and
-- ON DELETE SET NULL rather than CASCADE: deleting a parent must not delete
-- the work filed under it. The app draws an orphaned shoot on the trunk, so
-- a null parent is a display decision, never lost work.
alter table projects
  add column if not exists parent_id uuid references projects on delete set null;

create index if not exists projects_parent_idx on projects (parent_id)
  where parent_id is not null;

alter table tasks
  -- "This one, Thursday" — the day a person placed by hand, and the minute
  -- they dropped it on. The time is meaningless without the day, which is
  -- why the planner ignores it alone; stored as plain text (HH:MM) because
  -- it is a wall-clock intention, not an instant: 9am stays 9am in a new
  -- timezone, the same rule events follow through toLocal/fromLocal.
  add column if not exists pin_day  date,
  add column if not exists pin_time text,
  -- Work that comes back. Advanced from `due` when the task is ticked off.
  add column if not exists repeat   text
    check (repeat is null or repeat in ('day', 'week', 'month'));

comment on column projects.parent_id is
  'Sub-project: the branch this one grows off. Null is a trunk branch.';
comment on column tasks.pin_day is
  'A day the person chose by hand; the router plans the rest of the week around it.';
comment on column tasks.pin_time is
  'HH:MM wall clock to start at on pin_day. Ignored without pin_day.';
comment on column tasks.repeat is
  'day | week | month. On completion the task respawns with due advanced.';
