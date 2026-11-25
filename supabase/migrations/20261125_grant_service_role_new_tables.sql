-- tables created on 25 Nov had no service_role grants in this project (permission denied)
grant select, insert, update, delete on table public.rolls, public.roll_items, public.project_places to service_role;
