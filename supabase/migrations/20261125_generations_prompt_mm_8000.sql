alter table public.generations drop constraint generations_prompt_mm_check;
alter table public.generations add constraint generations_prompt_mm_check check (char_length(prompt_mm) >= 1 and char_length(prompt_mm) <= 8000);
