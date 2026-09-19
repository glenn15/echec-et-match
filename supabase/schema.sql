-- ============================================================
-- Échec & Match — schéma Supabase complet (version idempotente)
-- Relançable autant de fois que voulu : sur une base vide comme
-- sur une base existante. Tout est dans une transaction : si une
-- erreur survient, rien n'est appliqué (pas d'état à moitié fait).
-- ============================================================

begin;

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1. PROFILES
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text not null,
  name           text not null check (char_length(name) between 1 and 60),
  age            int not null default 25,
  birthdate      date,
  gender         text not null default 'autre' check (gender in ('homme', 'femme', 'autre')),
  orientation    text not null default 'autre' check (orientation in ('hetero', 'gay', 'bi', 'autre')),
  looking_for    text[] not null default array['homme', 'femme', 'autre'] check (looking_for <@ array['homme', 'femme', 'autre']),
  lat            double precision,
  lng            double precision,
  city           text,
  bio            text not null default '' check (char_length(bio) <= 500),
  aperitif       text not null default '' check (char_length(aperitif) <= 80),
  initials       text not null default '',
  hue            text not null default '#8f3350',
  photo_url      text,
  elo            int not null default 1200,
  board_theme    text not null default 'sauge',
  is_premium     boolean not null default false,
  premium_until  timestamptz,
  referral_code  text unique,
  referred_by    uuid references public.profiles(id),
  referral_rewards_granted int not null default 0,
  visitor_id     text,
  link_opens_rewards_granted int not null default 0,
  link_reward_at timestamptz,
  is_admin       boolean not null default false,
  terms_accepted_at timestamptz,
  created_at     timestamptz not null default now()
);

-- Mise à niveau d'une table existante créée avec une ancienne version
alter table public.profiles
  add column if not exists birthdate date,
  add column if not exists gender text not null default 'autre',
  add column if not exists orientation text not null default 'autre',
  add column if not exists looking_for text[] not null default array['homme', 'femme', 'autre'],
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists city text,
  add column if not exists photo_url text,
  add column if not exists elo int not null default 1200,
  add column if not exists board_theme text not null default 'sauge',
  add column if not exists is_premium boolean not null default false,
  add column if not exists premium_until timestamptz,
  add column if not exists referral_code text unique,
  add column if not exists referred_by uuid references public.profiles(id),
  add column if not exists referral_rewards_granted int not null default 0,
  add column if not exists visitor_id text,
  add column if not exists link_opens_rewards_granted int not null default 0,
  add column if not exists link_reward_at timestamptz,
  add column if not exists is_admin boolean not null default false,
  add column if not exists terms_accepted_at timestamptz;

-- Thèmes "nuit" / "bordeaux" réservés au premium (vérifié en base)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'board_theme_premium_gate') then
    alter table public.profiles add constraint board_theme_premium_gate
      check (is_premium = true or board_theme in ('sauge', 'ivoire')) not valid;
  end if;
end $$;

-- ------------------------------------------------------------
-- 1bis. REFERRALS (créée tôt car utilisée par handle_new_user)
-- ------------------------------------------------------------
create table if not exists public.referrals (
  id                  uuid primary key default gen_random_uuid(),
  referrer_id         uuid not null references public.profiles(id) on delete cascade,
  referred_id         uuid references public.profiles(id) on delete set null,
  referred_created_at timestamptz,
  confirmed_at        timestamptz,
  created_at          timestamptz not null default now(),
  unique (referred_id)
);

alter table public.referrals
  add column if not exists referred_created_at timestamptz,
  add column if not exists confirmed_at timestamptz;

alter table public.referrals enable row level security;

drop policy if exists "Un utilisateur voit ses propres parrainages" on public.referrals;
create policy "Un utilisateur voit ses propres parrainages"
  on public.referrals for select to authenticated
  using (auth.uid() = referrer_id);

-- ------------------------------------------------------------
-- 1ter. Création automatique du profil à l'inscription
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  hues text[] := array['#8f3350','#4a5d43','#6d2438','#a67c3d','#5a4a72','#2f6b5e'];
  chosen_hue text := hues[1 + floor(random() * array_length(hues,1))::int];
  uname text := coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1));
  parsed_birthdate date := nullif(new.raw_user_meta_data->>'birthdate', '')::date;
  accepted_terms boolean := coalesce((new.raw_user_meta_data->>'accepted_terms')::boolean, false);
  parsed_gender text := lower(coalesce(new.raw_user_meta_data->>'gender', 'autre'));
  parsed_orientation text := lower(coalesce(new.raw_user_meta_data->>'orientation', 'autre'));
  parsed_looking_for text[];
  new_referral_code text;
  referrer_row record;
begin
  if parsed_gender not in ('homme', 'femme', 'autre') then parsed_gender := 'autre'; end if;
  if parsed_orientation not in ('hetero', 'gay', 'bi', 'autre') then parsed_orientation := 'autre'; end if;

  begin
    select array_agg(lower(value)) into parsed_looking_for
    from jsonb_array_elements_text(coalesce(new.raw_user_meta_data->'looking_for', '[]'::jsonb)) as value
    where lower(value) in ('homme', 'femme', 'autre');
  exception when others then
    parsed_looking_for := null;
  end;
  if parsed_looking_for is null or array_length(parsed_looking_for, 1) is null then
    parsed_looking_for := array['homme', 'femme', 'autre'];
  end if;

  if parsed_birthdate is null then
    raise exception 'Date de naissance manquante ou invalide.';
  end if;
  if age(parsed_birthdate) < interval '18 years' then
    raise exception 'Échec & Match est réservé aux personnes de 18 ans ou plus.';
  end if;
  if not accepted_terms then
    raise exception 'Les CGU et la politique de confidentialité doivent être acceptées.';
  end if;
  if lower(split_part(new.email, '@', 2)) not in ('gmail.com', 'outlook.com', 'icloud.com') then
    raise exception 'Seules les adresses Gmail, Outlook ou iCloud sont acceptées.';
  end if;

  loop
    new_referral_code := upper(substr(md5(random()::text || new.id::text), 1, 8));
    exit when not exists (select 1 from public.profiles where referral_code = new_referral_code);
  end loop;

  insert into public.profiles (id, email, name, age, birthdate, gender, orientation, looking_for, bio, aperitif, initials, hue, terms_accepted_at, referral_code)
  values (
    new.id,
    new.email,
    uname,
    extract(year from age(parsed_birthdate))::int,
    parsed_birthdate,
    parsed_gender,
    parsed_orientation,
    parsed_looking_for,
    coalesce(new.raw_user_meta_data->>'bio', ''),
    coalesce(new.raw_user_meta_data->>'aperitif', ''),
    upper(left(regexp_replace(uname, '\s.*$', ''), 2)),
    chosen_hue,
    now(),
    new_referral_code
  )
  on conflict (id) do nothing;

  if new.raw_user_meta_data ? 'referral_code' and trim(coalesce(new.raw_user_meta_data->>'referral_code', '')) <> '' then
    select * into referrer_row
    from public.profiles
    where referral_code = upper(trim(new.raw_user_meta_data->>'referral_code'));

    if found and referrer_row.id <> new.id then
      update public.profiles set referred_by = referrer_row.id where id = new.id;
      insert into public.referrals (referrer_id, referred_id, referred_created_at)
      values (referrer_row.id, new.id, new.created_at)
      on conflict (referred_id) do nothing;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 1quater. Suppression de compte (RGPD)
-- ------------------------------------------------------------
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.profiles where id = auth.uid();
end;
$$;

revoke execute on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

-- ------------------------------------------------------------
-- 1quinquies. Droits sur PROFILES
-- ------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "Un utilisateur ne lit que son propre profil complet" on public.profiles;
create policy "Un utilisateur ne lit que son propre profil complet"
  on public.profiles for select to authenticated
  using (auth.uid() = id);

-- CORRECTIF SÉCURITÉ : le profil est créé uniquement par le trigger
-- handle_new_user. Le client ne doit JAMAIS pouvoir insérer un profil,
-- sinon il pourrait s'en créer un avec is_admin = true / is_premium = true
-- (ex. après delete_own_account, le compte auth.users restant).
drop policy if exists "Un utilisateur peut créer son propre profil" on public.profiles;
revoke insert on public.profiles from public, anon, authenticated;

drop policy if exists "Un utilisateur peut modifier son propre profil" on public.profiles;
create policy "Un utilisateur peut modifier son propre profil"
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Seules ces colonnes sont modifiables directement par le client.
-- "age" n'en fait plus partie : il est calculé depuis birthdate (vérifiée
-- à l'inscription), pour qu'on ne puisse pas afficher un faux âge.
revoke update on public.profiles from public, anon, authenticated;
grant update (name, bio, aperitif, board_theme, photo_url, lat, lng, city, gender, orientation, looking_for, visitor_id)
  on public.profiles to authenticated;

-- ------------------------------------------------------------
-- 1sexies. BLOCKED_USERS
-- ------------------------------------------------------------
create table if not exists public.blocked_users (
  id          uuid primary key default gen_random_uuid(),
  blocker_id  uuid not null references public.profiles(id) on delete cascade,
  blocked_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (blocker_id, blocked_id)
);

alter table public.blocked_users enable row level security;

drop policy if exists "Un utilisateur voit ses propres blocages" on public.blocked_users;
create policy "Un utilisateur voit ses propres blocages"
  on public.blocked_users for select to authenticated
  using (auth.uid() = blocker_id);

drop policy if exists "Un utilisateur peut bloquer quelqu'un" on public.blocked_users;
create policy "Un utilisateur peut bloquer quelqu'un"
  on public.blocked_users for insert to authenticated
  with check (auth.uid() = blocker_id);

drop policy if exists "Un utilisateur peut débloquer quelqu'un" on public.blocked_users;
create policy "Un utilisateur peut débloquer quelqu'un"
  on public.blocked_users for delete to authenticated
  using (auth.uid() = blocker_id);

-- ------------------------------------------------------------
-- 1septies. PUBLIC_PROFILES — vue exposée aux autres utilisateurs
-- ------------------------------------------------------------
-- Drop + create plutôt que "create or replace" : ce dernier échoue si
-- la liste des colonnes a changé depuis la version précédente.
drop view if exists public.public_profiles;
create view public.public_profiles
with (security_invoker = false)
as
select
  p.id,
  p.name,
  coalesce(extract(year from age(p.birthdate))::int, p.age) as age,
  p.gender,
  p.orientation,
  p.looking_for,
  p.bio,
  p.aperitif,
  p.initials,
  p.hue,
  p.photo_url,
  p.elo,
  p.board_theme,
  p.is_premium,
  p.created_at,
  (
    select round(
      (6371 * acos(
        least(1::double precision, greatest(-1::double precision,
          cos(radians(me.lat)) * cos(radians(p.lat)) * cos(radians(p.lng - me.lng))
          + sin(radians(me.lat)) * sin(radians(p.lat))
        ))
      ))::numeric, 0
    )
    from public.profiles me
    where me.id = auth.uid()
      and me.lat is not null and me.lng is not null
      and p.lat is not null and p.lng is not null
  ) as distance_km
from public.profiles p
where auth.uid() is not null
  and not exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
       or (b.blocker_id = p.id and b.blocked_id = auth.uid())
  );

-- CORRECTIF SÉCURITÉ : Supabase accorde par défaut SELECT à anon sur
-- toute nouvelle vue. Sans ce revoke, n'importe qui (non connecté) avec
-- la clé anon pouvait lister tous les profils.
revoke all on public.public_profiles from public, anon;
grant select on public.public_profiles to authenticated;

-- ------------------------------------------------------------
-- 2. SWIPES
-- ------------------------------------------------------------
create table if not exists public.swipes (
  id          uuid primary key default gen_random_uuid(),
  swiper_id   uuid not null references public.profiles(id) on delete cascade,
  swiped_id   uuid not null references public.profiles(id) on delete cascade,
  direction   text not null check (direction in ('left','right','superlike')),
  created_at  timestamptz not null default now(),
  unique (swiper_id, swiped_id)
);

alter table public.swipes enable row level security;

drop policy if exists "Un utilisateur voit ses propres swipes" on public.swipes;
create policy "Un utilisateur voit ses propres swipes"
  on public.swipes for select to authenticated
  using (auth.uid() = swiper_id);

drop policy if exists "Un compte premium voit qui l'a trinqué" on public.swipes;
create policy "Un compte premium voit qui l'a trinqué"
  on public.swipes for select to authenticated
  using (
    auth.uid() = swiped_id
    and direction in ('right', 'superlike')
    and exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_premium and (me.premium_until is null or me.premium_until > now()))
  );

drop policy if exists "Un utilisateur peut créer ses propres swipes" on public.swipes;
create policy "Un utilisateur peut créer ses propres swipes"
  on public.swipes for insert to authenticated
  with check (
    auth.uid() = swiper_id
    and swiped_id <> auth.uid()
    and not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = swiped_id)
         or (b.blocker_id = swiped_id and b.blocked_id = auth.uid())
    )
    and (
      direction <> 'superlike'
      or exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_premium and (me.premium_until is null or me.premium_until > now()))
    )
  );

drop policy if exists "Un utilisateur peut changer la direction de son propre swipe" on public.swipes;
create policy "Un utilisateur peut changer la direction de son propre swipe"
  on public.swipes for update to authenticated
  using (auth.uid() = swiper_id)
  with check (
    auth.uid() = swiper_id
    and swiped_id <> auth.uid()
    and not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = swiped_id)
         or (b.blocker_id = swiped_id and b.blocked_id = auth.uid())
    )
    and (
      direction <> 'superlike'
      or exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_premium and (me.premium_until is null or me.premium_until > now()))
    )
  );

-- CORRECTIF : le bouton "Rewind" (premium) fait un delete sur swipes,
-- mais aucune policy ne l'autorisait → il échouait silencieusement.
-- Réservé au premium (sinon supprimer/recréer contournerait la limite
-- de 25 swipes/jour des comptes gratuits).
drop policy if exists "Un compte premium peut annuler son swipe" on public.swipes;
create policy "Un compte premium peut annuler son swipe"
  on public.swipes for delete to authenticated
  using (
    auth.uid() = swiper_id
    and exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_premium and (me.premium_until is null or me.premium_until > now()))
  );

create or replace function public.enforce_swipe_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recent_count int;
begin
  select count(*) into recent_count
  from public.swipes
  where swiper_id = new.swiper_id
    and created_at > now() - interval '60 seconds';
  if recent_count >= 60 then
    raise exception 'Trop de swipes trop vite, patientez un instant.';
  end if;
  return new;
end;
$$;

drop trigger if exists on_swipe_rate_limit on public.swipes;
create trigger on_swipe_rate_limit
  before insert or update on public.swipes
  for each row execute function public.enforce_swipe_rate_limit();

create or replace function public.enforce_daily_swipe_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  is_prem boolean;
  prem_until timestamptz;
  today_count int;
begin
  select is_premium, premium_until into is_prem, prem_until from public.profiles where id = new.swiper_id;
  if coalesce(is_prem, false) and (prem_until is null or prem_until > now()) then
    return new;
  end if;
  select count(*) into today_count
  from public.swipes
  where swiper_id = new.swiper_id
    and created_at > now() - interval '24 hours';
  if today_count >= 25 then
    raise exception 'Limite de 25 swipes/jour atteinte. Passez Premium pour swiper sans limite.';
  end if;
  return new;
end;
$$;

drop trigger if exists on_daily_swipe_limit on public.swipes;
create trigger on_daily_swipe_limit
  before insert on public.swipes
  for each row execute function public.enforce_daily_swipe_limit();

-- ------------------------------------------------------------
-- 3. MATCHES
-- ------------------------------------------------------------
create table if not exists public.matches (
  id          uuid primary key default gen_random_uuid(),
  user_a      uuid not null references public.profiles(id) on delete cascade,
  user_b      uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (user_a, user_b)
);

alter table public.matches enable row level security;

drop policy if exists "Un utilisateur voit ses propres matchs" on public.matches;
create policy "Un utilisateur voit ses propres matchs"
  on public.matches for select to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);

drop policy if exists "Un participant peut quitter (supprimer) le match" on public.matches;
create policy "Un participant peut quitter (supprimer) le match"
  on public.matches for delete to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);

create or replace function public.handle_new_swipe()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reciprocal_exists boolean;
  ordered_a uuid;
  ordered_b uuid;
begin
  if new.direction in ('right', 'superlike') then
    select exists (
      select 1 from public.swipes
      where swiper_id = new.swiped_id
        and swiped_id = new.swiper_id
        and direction in ('right', 'superlike')
    ) into reciprocal_exists;

    if reciprocal_exists then
      if new.swiper_id < new.swiped_id then
        ordered_a := new.swiper_id;
        ordered_b := new.swiped_id;
      else
        ordered_a := new.swiped_id;
        ordered_b := new.swiper_id;
      end if;

      insert into public.matches (user_a, user_b)
      values (ordered_a, ordered_b)
      on conflict (user_a, user_b) do nothing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_swipe_created on public.swipes;
create trigger on_swipe_created
  after insert or update on public.swipes
  for each row execute function public.handle_new_swipe();

-- ------------------------------------------------------------
-- 4. MESSAGES
-- ------------------------------------------------------------
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.matches(id) on delete cascade,
  sender_id   uuid not null references public.profiles(id) on delete cascade,
  text        text not null check (char_length(text) between 1 and 2000),
  created_at  timestamptz not null default now()
);

alter table public.messages enable row level security;

drop policy if exists "Les participants du match voient les messages" on public.messages;
create policy "Les participants du match voient les messages"
  on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

drop policy if exists "Les participants du match peuvent écrire" on public.messages;
create policy "Les participants du match peuvent écrire"
  on public.messages for insert to authenticated
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.matches m
      where m.id = match_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
        and not exists (
          select 1 from public.blocked_users b
          where (b.blocker_id = m.user_a and b.blocked_id = m.user_b)
             or (b.blocker_id = m.user_b and b.blocked_id = m.user_a)
        )
    )
  );

create or replace function public.enforce_message_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recent_count int;
begin
  select count(*) into recent_count
  from public.messages
  where sender_id = new.sender_id
    and created_at > now() - interval '60 seconds';
  if recent_count >= 20 then
    raise exception 'Trop de messages envoyés trop vite, patientez un instant.';
  end if;
  return new;
end;
$$;

drop trigger if exists on_message_rate_limit on public.messages;
create trigger on_message_rate_limit
  before insert on public.messages
  for each row execute function public.enforce_message_rate_limit();

-- ------------------------------------------------------------
-- 5. GAMES
-- ------------------------------------------------------------
create table if not exists public.games (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references public.matches(id) on delete cascade,
  board         jsonb not null,
  turn          text not null default 'w',
  turn_user_id  uuid references public.profiles(id),
  captured_w    jsonb not null default '[]',
  captured_b    jsonb not null default '[]',
  log           jsonb not null default '[]',
  winner_id     uuid references public.profiles(id),
  updated_at    timestamptz not null default now(),
  unique (match_id)
);

alter table public.games enable row level security;

create or replace function public.games_set_initial_turn()
returns trigger
language plpgsql
as $$
begin
  if new.turn_user_id is null then
    select user_a into new.turn_user_id from public.matches where id = new.match_id;
  end if;
  if new.turn_user_id is null then
    raise exception 'Impossible de déterminer qui commence : match introuvable.';
  end if;
  return new;
end;
$$;

drop trigger if exists on_game_insert on public.games;
create trigger on_game_insert
  before insert on public.games
  for each row execute function public.games_set_initial_turn();

drop policy if exists "Les participants du match voient la partie" on public.games;
create policy "Les participants du match voient la partie"
  on public.games for select to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

drop policy if exists "Les participants du match peuvent créer la partie" on public.games;
create policy "Les participants du match peuvent créer la partie"
  on public.games for insert to authenticated
  with check (
    exists (
      select 1 from public.matches m
      where m.id = match_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
    and board = '[["br","bn","bb","bq","bk","bb","bn","br"],["bp","bp","bp","bp","bp","bp","bp","bp"],["","","","","","","",""],["","","","","","","",""],["","","","","","","",""],["","","","","","","",""],["wp","wp","wp","wp","wp","wp","wp","wp"],["wr","wn","wb","wq","wk","wb","wn","wr"]]'::jsonb
    and turn = 'w'
    and captured_w = '[]'::jsonb
    and captured_b = '[]'::jsonb
    and log = '[]'::jsonb
    and winner_id is null
  );

-- CORRECTIF : le reset vérifie maintenant aussi le tour, les pièces
-- capturées, le joueur qui commence (user_a) et que le match_id reste
-- un match du joueur (avant, un reset pouvait se donner le trait).
drop policy if exists "Seul un reset vers la position de départ est permis en direct" on public.games;
create policy "Seul un reset vers la position de départ est permis en direct"
  on public.games for update to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.matches m
      where m.id = match_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
        and m.user_a = turn_user_id
    )
    and board = '[["br","bn","bb","bq","bk","bb","bn","br"],["bp","bp","bp","bp","bp","bp","bp","bp"],["","","","","","","",""],["","","","","","","",""],["","","","","","","",""],["","","","","","","",""],["wp","wp","wp","wp","wp","wp","wp","wp"],["wr","wn","wb","wq","wk","wb","wn","wr"]]'::jsonb
    and turn = 'w'
    and captured_w = '[]'::jsonb
    and captured_b = '[]'::jsonb
    and log = '[]'::jsonb
    and winner_id is null
  );

-- ------------------------------------------------------------
-- 7. REPORTS
-- ------------------------------------------------------------
create table if not exists public.reports (
  id            uuid primary key default gen_random_uuid(),
  reporter_id   uuid not null references public.profiles(id) on delete cascade,
  reported_id   uuid not null references public.profiles(id) on delete cascade,
  message_id    uuid references public.messages(id) on delete set null,
  reason        text not null check (reason in ('comportement_deplace', 'faux_profil', 'contenu_inapproprie', 'autre')),
  details       text check (char_length(details) <= 1000),
  created_at    timestamptz not null default now()
);

alter table public.reports enable row level security;

drop policy if exists "Un utilisateur voit ses propres signalements" on public.reports;
create policy "Un utilisateur voit ses propres signalements"
  on public.reports for select to authenticated
  using (auth.uid() = reporter_id);

drop policy if exists "Un utilisateur peut signaler" on public.reports;
create policy "Un utilisateur peut signaler"
  on public.reports for insert to authenticated
  with check (
    auth.uid() = reporter_id
    and reported_id <> auth.uid()
    and exists (select 1 from public.profiles p where p.id = reported_id)
    and (
      message_id is null
      or exists (
        select 1 from public.messages msg
        join public.matches m on m.id = msg.match_id
        where msg.id = message_id
          and (m.user_a = auth.uid() or m.user_b = auth.uid())
      )
    )
  );

create or replace function public.enforce_report_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recent_count int;
begin
  select count(*) into recent_count
  from public.reports
  where reporter_id = new.reporter_id
    and created_at > now() - interval '60 minutes';
  if recent_count >= 10 then
    raise exception 'Trop de signalements envoyés, réessayez plus tard.';
  end if;
  return new;
end;
$$;

drop trigger if exists on_report_rate_limit on public.reports;
create trigger on_report_rate_limit
  before insert on public.reports
  for each row execute function public.enforce_report_rate_limit();

-- ------------------------------------------------------------
-- 8. PROFILE_PHOTOS
-- ------------------------------------------------------------
create table if not exists public.profile_photos (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  url         text not null,
  position    int not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.profile_photos enable row level security;

-- CORRECTIF : "to authenticated" — avant, un visiteur non connecté
-- (auth.uid() nul, donc aucun blocage trouvé) voyait toutes les photos.
drop policy if exists "Les photos sont visibles sauf blocage" on public.profile_photos;
create policy "Les photos sont visibles sauf blocage"
  on public.profile_photos for select to authenticated
  using (
    not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = profile_id)
         or (b.blocker_id = profile_id and b.blocked_id = auth.uid())
    )
  );

drop policy if exists "Un utilisateur gère ses propres photos" on public.profile_photos;
create policy "Un utilisateur gère ses propres photos"
  on public.profile_photos for all to authenticated
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create or replace function public.enforce_photo_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  photo_count int;
begin
  select count(*) into photo_count from public.profile_photos where profile_id = new.profile_id;
  if photo_count >= 6 then
    raise exception 'Maximum 6 photos par profil.';
  end if;
  return new;
end;
$$;

drop trigger if exists on_photo_limit on public.profile_photos;
create trigger on_photo_limit
  before insert on public.profile_photos
  for each row execute function public.enforce_photo_limit();

-- ------------------------------------------------------------
-- 9. STORAGE — bucket public pour les photos de profil
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Les photos de profil sont visibles par tous" on storage.objects;
create policy "Les photos de profil sont visibles par tous"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "Un utilisateur peut uploader sa propre photo" on storage.objects;
create policy "Un utilisateur peut uploader sa propre photo"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Un utilisateur peut remplacer sa propre photo" on storage.objects;
create policy "Un utilisateur peut remplacer sa propre photo"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Un utilisateur peut supprimer sa propre photo" on storage.objects;
create policy "Un utilisateur peut supprimer sa propre photo"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ------------------------------------------------------------
-- 11. GAME_HISTORY + Elo
-- ------------------------------------------------------------
create table if not exists public.game_history (
  id                  uuid primary key default gen_random_uuid(),
  match_id            uuid references public.matches(id) on delete set null,
  winner_id           uuid references public.profiles(id) on delete set null,
  loser_id            uuid references public.profiles(id) on delete set null,
  winner_elo_before   int not null,
  loser_elo_before    int not null,
  elo_delta           int not null,
  created_at          timestamptz not null default now()
);

alter table public.game_history enable row level security;

drop policy if exists "Un joueur voit ses propres parties terminées" on public.game_history;
create policy "Un joueur voit ses propres parties terminées"
  on public.game_history for select to authenticated
  using (auth.uid() = winner_id or auth.uid() = loser_id);

create or replace function public.record_chess_win(p_match_id uuid, p_winner_id uuid, p_loser_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w_elo int;
  l_elo int;
  expected_w numeric;
  delta int;
begin
  if auth.uid() not in (p_winner_id, p_loser_id) then
    raise exception 'Vous ne participez pas à cette partie.';
  end if;
  if p_winner_id = p_loser_id then
    raise exception 'Le gagnant et le perdant doivent être différents.';
  end if;

  select elo into w_elo from public.profiles where id = p_winner_id;
  select elo into l_elo from public.profiles where id = p_loser_id;

  expected_w := 1.0 / (1 + power(10, (l_elo - w_elo) / 400.0));
  delta := round(32 * (1 - expected_w));
  if delta < 1 then delta := 1; end if;

  update public.profiles set elo = w_elo + delta where id = p_winner_id;
  update public.profiles set elo = greatest(l_elo - delta, 100) where id = p_loser_id;

  insert into public.game_history (match_id, winner_id, loser_id, winner_elo_before, loser_elo_before, elo_delta)
  values (p_match_id, p_winner_id, p_loser_id, w_elo, l_elo, delta);
end;
$$;

-- Jamais appelable par un client : uniquement en interne depuis make_chess_move
revoke execute on function public.record_chess_win(uuid, uuid, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 12. MAKE_CHESS_MOVE — validation des coups côté serveur
-- ------------------------------------------------------------
create or replace function public.make_chess_move(
  p_game_id uuid,
  p_from_r int,
  p_from_c int,
  p_to_r int,
  p_to_c int
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  g record;
  board jsonb;
  piece text;
  target text;
  color text;
  ptype text;
  enemy text;
  valid boolean := false;
  captured_piece text;
  new_board jsonb;
  new_captured_w jsonb;
  new_captured_b jsonb;
  new_log jsonb;
  winner uuid := null;
  next_turn text;
  next_turn_user uuid;
  dr int;
  dc int;
  dir int;
  start_row int;
  step_r int;
  step_c int;
  cr int;
  cc int;
  cell text;
  blocked boolean := false;
  move_text text;
begin
  select * into g from public.games where id = p_game_id for update;
  if not found then raise exception 'Partie introuvable.'; end if;
  if g.winner_id is not null then raise exception 'La partie est terminée.'; end if;
  if g.turn_user_id is distinct from auth.uid() then raise exception 'Ce n''est pas votre tour.'; end if;
  if p_from_r not between 0 and 7 or p_from_c not between 0 and 7
     or p_to_r not between 0 and 7 or p_to_c not between 0 and 7 then
    raise exception 'Case hors plateau.';
  end if;

  board := g.board;
  piece := board #>> array[p_from_r::text, p_from_c::text];
  if piece is null or piece = '' then raise exception 'Case de départ vide.'; end if;

  color := left(piece, 1);
  ptype := right(piece, 1);
  enemy := case when color = 'w' then 'b' else 'w' end;

  if color <> g.turn then raise exception 'Ce n''est pas votre pièce.'; end if;

  target := board #>> array[p_to_r::text, p_to_c::text];
  if target is not null and target <> '' and left(target, 1) = color then
    raise exception 'Case occupée par votre propre pièce.';
  end if;

  dr := p_to_r - p_from_r;
  dc := p_to_c - p_from_c;

  if ptype = 'p' then
    dir := case when color = 'w' then -1 else 1 end;
    start_row := case when color = 'w' then 6 else 1 end;
    if dc = 0 and dr = dir and (target is null or target = '') then
      valid := true;
    elsif dc = 0 and dr = 2 * dir and p_from_r = start_row
          and (target is null or target = '')
          and coalesce(board #>> array[(p_from_r + dir)::text, p_from_c::text], '') = '' then
      valid := true;
    elsif abs(dc) = 1 and dr = dir and target is not null and target <> '' and left(target, 1) = enemy then
      valid := true;
    end if;

  elsif ptype = 'n' then
    if (abs(dr) = 2 and abs(dc) = 1) or (abs(dr) = 1 and abs(dc) = 2) then
      valid := true;
    end if;

  elsif ptype = 'k' then
    if abs(dr) <= 1 and abs(dc) <= 1 and (dr <> 0 or dc <> 0) then
      valid := true;
    end if;

  elsif ptype in ('b', 'r', 'q') then
    if (ptype = 'b' and abs(dr) = abs(dc) and dr <> 0)
       or (ptype = 'r' and (dr = 0 or dc = 0) and (dr <> 0 or dc <> 0))
       or (ptype = 'q' and ((abs(dr) = abs(dc) and dr <> 0) or ((dr = 0 or dc = 0) and (dr <> 0 or dc <> 0)))) then
      step_r := sign(dr);
      step_c := sign(dc);
      cr := p_from_r + step_r;
      cc := p_from_c + step_c;
      blocked := false;
      while cr <> p_to_r or cc <> p_to_c loop
        cell := board #>> array[cr::text, cc::text];
        if cell is not null and cell <> '' then
          blocked := true;
          exit;
        end if;
        cr := cr + step_r;
        cc := cc + step_c;
      end loop;
      if not blocked then valid := true; end if;
    end if;
  end if;

  if not valid then
    raise exception 'Coup illégal.';
  end if;

  captured_piece := target;
  new_board := jsonb_set(board, array[p_from_r::text, p_from_c::text], '""'::jsonb);
  new_board := jsonb_set(new_board, array[p_to_r::text, p_to_c::text], to_jsonb(piece));

  new_captured_w := g.captured_w;
  new_captured_b := g.captured_b;
  if captured_piece is not null and captured_piece <> '' then
    if color = 'w' then
      new_captured_w := new_captured_w || to_jsonb(captured_piece);
    else
      new_captured_b := new_captured_b || to_jsonb(captured_piece);
    end if;
    if right(captured_piece, 1) = 'k' then
      winner := auth.uid();
    end if;
  end if;

  move_text := piece || ' ' || chr(97 + p_from_c) || (8 - p_from_r)::text || '→' || chr(97 + p_to_c) || (8 - p_to_r)::text
               || (case when captured_piece is not null and captured_piece <> '' then ' x' else '' end);
  new_log := g.log || to_jsonb(move_text);

  next_turn := case when g.turn = 'w' then 'b' else 'w' end;
  if winner is not null then
    next_turn_user := null;
  else
    select case when m.user_a = auth.uid() then m.user_b else m.user_a end
      into next_turn_user
      from public.matches m
      where m.id = g.match_id;
  end if;

  update public.games set
    board = new_board,
    turn = next_turn,
    turn_user_id = next_turn_user,
    captured_w = new_captured_w,
    captured_b = new_captured_b,
    log = new_log,
    winner_id = winner,
    updated_at = now()
  where id = p_game_id;

  if winner is not null then
    perform public.record_chess_win(g.match_id, winner, (select case when m.user_a = winner then m.user_b else m.user_a end from public.matches m where m.id = g.match_id));
  end if;

  return jsonb_build_object('ok', true, 'winner_id', winner);
end;
$$;

revoke execute on function public.make_chess_move(uuid, int, int, int, int) from public, anon;
grant execute on function public.make_chess_move(uuid, int, int, int, int) to authenticated;

-- ------------------------------------------------------------
-- 13. INDEX (triggers anti-spam)
-- ------------------------------------------------------------
create index if not exists idx_swipes_swiper_created on public.swipes (swiper_id, created_at desc);
create index if not exists idx_messages_sender_created on public.messages (sender_id, created_at desc);
create index if not exists idx_reports_reporter_created on public.reports (reporter_id, created_at desc);

-- ------------------------------------------------------------
-- 14. MATCH_READS — messages non lus
-- ------------------------------------------------------------
create table if not exists public.match_reads (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  match_id     uuid not null references public.matches(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, match_id)
);

alter table public.match_reads enable row level security;

drop policy if exists "Un utilisateur gère ses propres marqueurs de lecture" on public.match_reads;
create policy "Un utilisateur gère ses propres marqueurs de lecture"
  on public.match_reads for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 15. PARRAINAGE
-- ------------------------------------------------------------
create or replace function public.handle_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ref_row record;
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    select * into ref_row from public.referrals where referred_id = new.id and confirmed_at is null;
    if found then
      -- Confirmation en moins de 15 s = probablement un script : marquée
      -- 'epoch' pour ne jamais compter dans evaluate_referral_rewards().
      if new.created_at is not null and new.email_confirmed_at - new.created_at < interval '15 seconds' then
        update public.referrals set confirmed_at = 'epoch'::timestamptz where id = ref_row.id;
      else
        update public.referrals set confirmed_at = now() where id = ref_row.id;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_email_confirmed on auth.users;
create trigger on_email_confirmed
  after update on auth.users
  for each row execute function public.handle_email_confirmed();

create or replace function public.evaluate_referral_rewards()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  confirmed_count int;
  already_granted int;
begin
  select referral_rewards_granted into already_granted from public.profiles where id = auth.uid();
  if coalesce(already_granted, 0) >= 1 then
    return;
  end if;

  select count(*) into confirmed_count
  from public.referrals
  where referrer_id = auth.uid()
    and referred_id is not null
    and confirmed_at is not null
    and confirmed_at > 'epoch'::timestamptz
    and confirmed_at <= now() - interval '48 hours';

  if confirmed_count >= 2 then
    update public.profiles
    set is_premium = true,
        premium_until = greatest(coalesce(premium_until, now()), now()) + interval '1 month',
        referral_rewards_granted = 1
    where id = auth.uid();
  end if;
end;
$$;

revoke execute on function public.evaluate_referral_rewards() from public, anon;
grant execute on function public.evaluate_referral_rewards() to authenticated;

-- CORRECTIF BUG : avant, si l'utilisateur avait un thème premium
-- ("nuit"/"bordeaux"), passer is_premium à false violait la contrainte
-- board_theme_premium_gate → l'update échouait → le Premium n'expirait
-- jamais. On remet donc le thème à "sauge" dans le même update.
create or replace function public.settle_my_premium_status()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.profiles
  set is_premium = false,
      board_theme = case when board_theme in ('sauge', 'ivoire') then board_theme else 'sauge' end
  where id = auth.uid()
    and is_premium
    and premium_until is not null
    and premium_until <= now();
end;
$$;

revoke execute on function public.settle_my_premium_status() from public, anon;
grant execute on function public.settle_my_premium_status() to authenticated;

-- ------------------------------------------------------------
-- 16. OUVERTURES DE LIEN
-- ------------------------------------------------------------
create table if not exists public.link_opens (
  id           uuid primary key default gen_random_uuid(),
  referrer_id  uuid not null references public.profiles(id) on delete cascade,
  visitor_id   text not null,
  created_at   timestamptz not null default now(),
  unique (referrer_id, visitor_id)
);

alter table public.link_opens enable row level security;

drop policy if exists "Un utilisateur voit ses propres ouvertures de lien" on public.link_opens;
create policy "Un utilisateur voit ses propres ouvertures de lien"
  on public.link_opens for select to authenticated
  using (auth.uid() = referrer_id);

create or replace function public.record_link_open(p_referral_code text, p_visitor_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  referrer_row record;
begin
  if p_visitor_id is null or length(trim(p_visitor_id)) = 0 or length(p_visitor_id) > 100 then
    return;
  end if;

  select * into referrer_row from public.profiles where referral_code = upper(trim(p_referral_code));
  if not found then
    return;
  end if;

  if referrer_row.visitor_id is not null and referrer_row.visitor_id = p_visitor_id then
    return;
  end if;

  -- Pendant un Premium actif, les ouvertures ne comptent pas : la
  -- récompense n'est pas cumulable, le compteur est en pause.
  if referrer_row.is_premium and (referrer_row.premium_until is null or referrer_row.premium_until > now()) then
    return;
  end if;

  insert into public.link_opens (referrer_id, visitor_id)
  values (referrer_row.id, p_visitor_id)
  on conflict (referrer_id, visitor_id) do nothing;
end;
$$;

revoke execute on function public.record_link_open(text, text) from public;
grant execute on function public.record_link_open(text, text) to authenticated, anon;

-- Récompense partages : 5 ouvertures distinctes → 2 semaines de Premium.
-- Répétable, mais UNE À LA FOIS : rien n'est accordé tant qu'un Premium
-- est actif, et seules les ouvertures postérieures à la dernière
-- récompense comptent (le compteur repart de zéro après chaque récompense).
create or replace function public.evaluate_link_open_rewards()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me record;
  new_opens int;
begin
  select * into me from public.profiles where id = auth.uid() for update;
  if not found then return; end if;

  if me.is_premium and (me.premium_until is null or me.premium_until > now()) then
    return;
  end if;

  select count(*) into new_opens
  from public.link_opens
  where referrer_id = auth.uid()
    and created_at > coalesce(me.link_reward_at, '-infinity'::timestamptz);

  if new_opens >= 5 then
    update public.profiles
    set is_premium = true,
        premium_until = now() + interval '14 days',
        link_reward_at = now(),
        link_opens_rewards_granted = link_opens_rewards_granted + 1
    where id = auth.uid();
  end if;
end;
$$;

-- Migration : les comptes déjà récompensés avec l'ancien système repartent
-- de zéro (sinon leurs anciennes ouvertures recompteraient).
update public.profiles
set link_reward_at = now()
where link_opens_rewards_granted > 0 and link_reward_at is null;

revoke execute on function public.evaluate_link_open_rewards() from public, anon;
grant execute on function public.evaluate_link_open_rewards() to authenticated;

-- ------------------------------------------------------------
-- 17. ADMINISTRATION
-- ------------------------------------------------------------
-- is_admin ne s'accorde qu'à la main, en base :
--   update public.profiles set is_admin = true where email = 'ton@email';

create or replace function public.admin_get_stats()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Accès réservé aux administrateurs.';
  end if;

  select jsonb_build_object(
    'total_profiles', (select count(*) from public.profiles),
    'premium_profiles', (select count(*) from public.profiles where is_premium),
    'total_matches', (select count(*) from public.matches),
    'total_messages', (select count(*) from public.messages),
    'total_games_played', (select count(*) from public.game_history),
    'total_reports', (select count(*) from public.reports),
    'reports_last_7_days', (select count(*) from public.reports where created_at > now() - interval '7 days'),
    'new_profiles_last_7_days', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'total_referrals_confirmed', (select count(*) from public.referrals where confirmed_at is not null and confirmed_at > 'epoch'::timestamptz)
  ) into result;

  return result;
end;
$$;

revoke execute on function public.admin_get_stats() from public, anon;
grant execute on function public.admin_get_stats() to authenticated;

-- Drop préalable : "create or replace" échoue si le type de retour
-- (colonnes du "returns table") a changé depuis la version précédente.
drop function if exists public.admin_get_reports();
create function public.admin_get_reports()
returns table (
  id uuid,
  reason text,
  details text,
  created_at timestamptz,
  reporter_name text,
  reported_name text,
  reported_id uuid,
  message_text text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin) then
    raise exception 'Accès réservé aux administrateurs.';
  end if;

  return query
  select
    r.id,
    r.reason,
    r.details,
    r.created_at,
    reporter.name as reporter_name,
    reported.name as reported_name,
    r.reported_id,
    msg.text as message_text
  from public.reports r
  left join public.profiles reporter on reporter.id = r.reporter_id
  left join public.profiles reported on reported.id = r.reported_id
  left join public.messages msg on msg.id = r.message_id
  order by r.created_at desc
  limit 200;
end;
$$;

revoke execute on function public.admin_get_reports() from public, anon;
grant execute on function public.admin_get_reports() to authenticated;

-- ------------------------------------------------------------
-- 18. REALTIME — ajout des tables seulement si pas déjà présentes
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['messages', 'games', 'matches', 'game_history', 'match_reads'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

commit;
