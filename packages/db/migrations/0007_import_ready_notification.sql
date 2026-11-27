-- A capture runs on the worker, so the member may close the app at once.
-- The finished draft is announced in the bell list and by push.
-- The old check was inline, so its name is not part of this file. Find it by
-- its content, then replace it with one that also names import_ready.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname from pg_constraint
    where conrelid = 'notifications'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%friend_accepted%'
  loop
    execute format('alter table notifications drop constraint %I', constraint_name);
  end loop;
end $$;

alter table notifications
  add constraint notifications_kind_check
  check (kind in ('comment','reply','friend_request','friend_accepted','variation','timer','import_ready'));
