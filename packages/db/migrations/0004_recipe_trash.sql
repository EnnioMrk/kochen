-- Trash retention. A deleted recipe stays for 7 days, then a purge removes it.
-- Cascades let one DELETE remove the recipe with its own rows.

alter table recipes drop constraint recipes_parent_id_fkey;
alter table recipes add constraint recipes_parent_id_fkey
  foreign key (parent_id) references recipes(id) on delete set null;

alter table cook_events drop constraint cook_events_recipe_id_fkey;
alter table cook_events add constraint cook_events_recipe_id_fkey
  foreign key (recipe_id) references recipes(id) on delete cascade;

alter table ratings drop constraint ratings_recipe_id_fkey;
alter table ratings add constraint ratings_recipe_id_fkey
  foreign key (recipe_id) references recipes(id) on delete cascade;

alter table timers drop constraint timers_recipe_id_fkey;
alter table timers add constraint timers_recipe_id_fkey
  foreign key (recipe_id) references recipes(id) on delete cascade;

-- A purge deletes cook events with their recipe. An update stays blocked.
drop trigger cook_events_append_only on cook_events;
create trigger cook_events_append_only before update on cook_events
  for each row execute function reject_change();

create index recipes_deleted_idx on recipes (deleted_at) where deleted_at is not null;
