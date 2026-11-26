alter table public.rolls add column if not exists transition text not null default 'cut';
alter table public.rolls drop constraint if exists rolls_transition_check;
alter table public.rolls add constraint rolls_transition_check check (transition in ('cut','dissolve','fadeblack'));
