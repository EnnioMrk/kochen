-- Baking data is free text. Old recipes keep null and show nothing.
alter table recipes
  add column if not exists baking_temperature text,
  add column if not exists baking_time text;

alter table recipes
  drop constraint if exists recipes_baking_temperature_len,
  drop constraint if exists recipes_baking_time_len;

alter table recipes
  add constraint recipes_baking_temperature_len
    check (baking_temperature is null or length(btrim(baking_temperature)) between 1 and 80),
  add constraint recipes_baking_time_len
    check (baking_time is null or length(btrim(baking_time)) between 1 and 80);
