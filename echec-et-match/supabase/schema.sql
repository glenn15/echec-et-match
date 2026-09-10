-- ============================================================
-- Échec & Match — schéma Supabase complet
-- À exécuter dans l'éditeur SQL de votre projet Supabase
-- (Dashboard > SQL Editor > New query > coller > Run)
-- ============================================================

-- Extension pour uuid
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1. PROFILES — un profil par utilisateur (lié à auth.users)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text not null,
  name           text not null check (char_length(name) between 1 and 60),
  age            int not null default 25,
  birthdate      date,
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
  terms_accepted_at timestamptz,
  created_at     timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 1bis. Création automatique du profil à l'inscription
-- ------------------------------------------------------------
-- On ne peut pas insérer le profil depuis le client juste après
-- signUp() car, tant que l'email n'est pas confirmé, il n'y a pas
-- de session (RLS bloquerait l'insert). On utilise donc un trigger
-- côté serveur (security definer) qui lit les métadonnées passées
-- à supabase.auth.signUp({ options: { data: {...} } }).
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
begin
  -- Vérification d'âge côté serveur : le formulaire côté client peut être
  -- contourné par un appel direct à l'API d'inscription. Sans date de
  -- naissance valide indiquant 18 ans ou plus, l'inscription est bloquée
  -- entièrement (l'insertion dans auth.users elle-même est annulée).
  if parsed_birthdate is null then
    raise exception 'Date de naissance manquante ou invalide.';
  end if;
  if age(parsed_birthdate) < interval '18 years' then
    raise exception 'Échec & Match est réservé aux personnes de 18 ans ou plus.';
  end if;
  if not accepted_terms then
    raise exception 'Les CGU et la politique de confidentialité doivent être acceptées.';
  end if;

  insert into public.profiles (id, email, name, age, birthdate, bio, aperitif, initials, hue, terms_accepted_at)
  values (
    new.id,
    new.email,
    uname,
    extract(year from age(parsed_birthdate))::int,
    parsed_birthdate,
    coalesce(new.raw_user_meta_data->>'bio', ''),
    coalesce(new.raw_user_meta_data->>'aperitif', ''),
    upper(left(regexp_replace(uname, '\s.*$', ''), 2)),
    chosen_hue,
    now() -- horodatage fiable désormais : on ne l'atteint que si accepted_terms était vraiment true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 1ter. Suppression de compte (RGPD) — supprime le profil et,
-- par cascade, toutes les données liées (swipes, matchs, messages,
-- parties, blocages, signalements). La ligne auth.users elle-même
-- ne peut être supprimée que côté serveur (clé service_role, ex.
-- via une Edge Function) — voir README.
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

-- Postgres accorde EXECUTE à PUBLIC par défaut sur toute nouvelle fonction :
-- on le révoque explicitement pour ne garder que l'accès authentifié voulu.
revoke execute on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

alter table public.profiles enable row level security;

-- Un utilisateur ne peut lire que sa propre ligne complète (email, date de
-- naissance, coordonnées GPS exactes...). Les autres utilisateurs consultent
-- exclusivement la vue public_profiles ci-dessous, qui expose uniquement les
-- champs non sensibles et une distance calculée — jamais les coordonnées brutes.
create policy "Un utilisateur ne lit que son propre profil complet"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Un utilisateur peut créer son propre profil"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Un utilisateur peut modifier son propre profil"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- L'Elo, l'email, la date de naissance et l'horodatage d'acceptation des CGU
-- ne doivent jamais être modifiables directement par le client (l'Elo ne doit
-- changer qu'via record_chess_win / make_chess_move, en SECURITY DEFINER).
-- On restreint donc les colonnes réellement autorisées en écriture directe.
revoke update on public.profiles from authenticated;
grant update (name, age, bio, aperitif, board_theme, photo_url, lat, lng, city) on public.profiles to authenticated;

-- ------------------------------------------------------------
-- 1quater. BLOCKED_USERS — blocage entre utilisateurs
-- ------------------------------------------------------------
-- Créée tôt car public_profiles, swipes et messages doivent tous
-- pouvoir s'appuyer dessus pour appliquer le blocage réellement,
-- pas seulement au niveau de l'interface.
create table if not exists public.blocked_users (
  id          uuid primary key default gen_random_uuid(),
  blocker_id  uuid not null references public.profiles(id) on delete cascade,
  blocked_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (blocker_id, blocked_id)
);

alter table public.blocked_users enable row level security;

create policy "Un utilisateur voit ses propres blocages"
  on public.blocked_users for select
  using (auth.uid() = blocker_id);

create policy "Un utilisateur peut bloquer quelqu'un"
  on public.blocked_users for insert
  with check (auth.uid() = blocker_id);

create policy "Un utilisateur peut débloquer quelqu'un"
  on public.blocked_users for delete
  using (auth.uid() = blocker_id);

-- ------------------------------------------------------------
-- 1quinquies. PUBLIC_PROFILES — vue exposée aux autres utilisateurs
-- ------------------------------------------------------------
-- N'expose jamais : email, birthdate, lat/lng bruts, terms_accepted_at.
-- La distance est calculée côté serveur (formule de la haversine) à partir
-- des coordonnées de l'appelant, jamais renvoyées en clair au client.
-- Exclut aussi tout profil impliqué dans un blocage avec l'appelant, dans
-- les deux sens — le blocage doit être réel, pas seulement un filtre
-- côté client facilement contournable via un appel direct à l'API.
create or replace view public.public_profiles
with (security_invoker = false)
as
select
  p.id,
  p.name,
  p.age,
  p.bio,
  p.aperitif,
  p.initials,
  p.hue,
  p.photo_url,
  p.elo,
  p.board_theme,
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
where not exists (
  select 1 from public.blocked_users b
  where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
     or (b.blocker_id = p.id and b.blocked_id = auth.uid())
);

grant select on public.public_profiles to authenticated;

-- ------------------------------------------------------------
-- 2. SWIPES — chaque "passer" / "trinquer" sur un profil
-- ------------------------------------------------------------
create table if not exists public.swipes (
  id          uuid primary key default gen_random_uuid(),
  swiper_id   uuid not null references public.profiles(id) on delete cascade,
  swiped_id   uuid not null references public.profiles(id) on delete cascade,
  direction   text not null check (direction in ('left','right')),
  created_at  timestamptz not null default now(),
  unique (swiper_id, swiped_id)
);

alter table public.swipes enable row level security;

create policy "Un utilisateur voit ses propres swipes"
  on public.swipes for select
  using (auth.uid() = swiper_id);

create policy "Un utilisateur peut créer ses propres swipes"
  on public.swipes for insert
  with check (
    auth.uid() = swiper_id
    and not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = swiped_id)
         or (b.blocker_id = swiped_id and b.blocked_id = auth.uid())
    )
  );

-- Anti-bot : max 60 swipes par minute par utilisateur.
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
  before insert on public.swipes
  for each row execute function public.enforce_swipe_rate_limit();

-- ------------------------------------------------------------
-- 3. MATCHES — créé automatiquement quand deux swipes "right"
--    se répondent (trigger ci-dessous)
-- ------------------------------------------------------------
create table if not exists public.matches (
  id          uuid primary key default gen_random_uuid(),
  user_a      uuid not null references public.profiles(id) on delete cascade,
  user_b      uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (user_a, user_b)
);

alter table public.matches enable row level security;

create policy "Un utilisateur voit ses propres matchs"
  on public.matches for select
  using (auth.uid() = user_a or auth.uid() = user_b);

create policy "Un participant peut quitter (supprimer) le match"
  on public.matches for delete
  using (auth.uid() = user_a or auth.uid() = user_b);

-- Trigger : quand un swipe 'right' est inséré, on vérifie si
-- l'autre personne a déjà swipé 'right' sur nous -> crée le match
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
  if new.direction = 'right' then
    select exists (
      select 1 from public.swipes
      where swiper_id = new.swiped_id
        and swiped_id = new.swiper_id
        and direction = 'right'
    ) into reciprocal_exists;

    if reciprocal_exists then
      -- ordre stable pour respecter la contrainte unique (user_a, user_b)
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
  after insert on public.swipes
  for each row execute function public.handle_new_swipe();

-- ------------------------------------------------------------
-- 4. MESSAGES — chat par match
-- ------------------------------------------------------------
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.matches(id) on delete cascade,
  sender_id   uuid not null references public.profiles(id) on delete cascade,
  text        text not null check (char_length(text) between 1 and 2000),
  created_at  timestamptz not null default now()
);

alter table public.messages enable row level security;

create policy "Les participants du match voient les messages"
  on public.messages for select
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

create policy "Les participants du match peuvent écrire"
  on public.messages for insert
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

-- Anti-spam : max 20 messages par utilisateur sur les 60 dernières secondes,
-- tous matchs confondus.
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
-- 5. GAMES — une partie d'échecs par match (état + tour)
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

-- À la création d'une partie, le trait revient toujours à user_a (les blancs).
create or replace function public.games_set_initial_turn()
returns trigger
language plpgsql
as $$
begin
  if new.turn_user_id is null then
    select user_a into new.turn_user_id from public.matches where id = new.match_id;
  end if;
  -- Filet de sécurité : si le match n'a pas été trouvé (ne devrait jamais
  -- arriver vu la policy d'insertion), on bloque plutôt que de créer une
  -- partie injouable avec turn_user_id resté à NULL.
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

create policy "Les participants du match voient la partie"
  on public.games for select
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

-- La création d'une partie doit obligatoirement partir de la position
-- de départ standard, sans quoi un client malveillant pourrait insérer
-- un plateau truqué avant même la première partie.
create policy "Les participants du match peuvent créer la partie"
  on public.games for insert
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

-- Seul le joueur dont c'est le tour (turn_user_id) peut modifier la partie.
-- Empêche un joueur de jouer hors tour en appelant l'API directement.
-- Un coup normal ne peut être joué que via la fonction make_chess_move()
-- (security definer, plus bas), qui valide la légalité du déplacement
-- côté serveur. La policy ci-dessous n'autorise plus qu'une remise à zéro
-- de la partie (retour à la position de départ) directement depuis le client.
create policy "Seul un reset vers la position de départ est permis en direct"
  on public.games for update
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  )
  with check (
    board = '[["br","bn","bb","bq","bk","bb","bn","br"],["bp","bp","bp","bp","bp","bp","bp","bp"],["","","","","","","",""],["","","","","","","",""],["","","","","","","",""],["","","","","","","",""],["wp","wp","wp","wp","wp","wp","wp","wp"],["wr","wn","wb","wq","wk","wb","wn","wr"]]'::jsonb
    and winner_id is null
    and log = '[]'::jsonb
  );


-- ------------------------------------------------------------
-- 7. REPORTS — signalement de profil ou de message
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

-- Seuls les signalements qu'on a soi-même créés sont visibles côté client
-- (la modération se fait côté back-office avec la clé service_role, hors RLS)
create policy "Un utilisateur voit ses propres signalements"
  on public.reports for select
  using (auth.uid() = reporter_id);

create policy "Un utilisateur peut signaler"
  on public.reports for insert
  with check (
    auth.uid() = reporter_id
    and exists (
      select 1 from public.matches m
      where (m.user_a = auth.uid() and m.user_b = reported_id)
         or (m.user_b = auth.uid() and m.user_a = reported_id)
    )
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

-- Anti-spam : max 10 signalements par utilisateur sur les 60 dernières minutes.
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
-- 9. STORAGE — bucket public pour les photos de profil
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Les photos de profil sont visibles par tous"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "Un utilisateur peut uploader sa propre photo"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Un utilisateur peut remplacer sa propre photo"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Un utilisateur peut supprimer sa propre photo"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ------------------------------------------------------------
-- 9bis. Realtime — activer la réplication pour le chat et les parties
-- ------------------------------------------------------------
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.matches;

-- ------------------------------------------------------------
-- 10. Auto-création du profil à l'inscription (optionnel, en plus
--     de l'insert côté client dans AuthScreen)
-- ------------------------------------------------------------
-- Le profil est créé explicitement depuis le client juste après
-- supabase.auth.signUp() car on a besoin des champs du formulaire
-- (nom, date de naissance, bio, apéro). Rien à faire ici.

-- ------------------------------------------------------------
-- 11. GAME_HISTORY — trace des parties terminées + évolution Elo
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

create policy "Un joueur voit ses propres parties terminées"
  on public.game_history for select
  using (auth.uid() = winner_id or auth.uid() = loser_id);

-- Met à jour l'Elo des deux joueurs et journalise la partie.
-- security definer car un joueur ne peut normalement pas modifier
-- le profil (donc l'Elo) de son adversaire directement.
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

-- IMPORTANT : cette fonction ne doit JAMAIS être appelable directement par
-- un client — elle fait confiance à winner_id/loser_id fournis en paramètre
-- sans vérifier qu'une partie a réellement été gagnée. Elle n'est destinée
-- qu'à un appel interne depuis make_chess_move() (qui, lui, valide tout).
-- Le rôle propriétaire de make_chess_move conserve un accès implicite à ses
-- propres fonctions même après cette révocation : l'appel interne continue
-- de fonctionner, seul l'appel RPC direct depuis un client est bloqué.
revoke execute on function public.record_chess_win(uuid, uuid, uuid) from public, authenticated, anon;

alter publication supabase_realtime add table public.game_history;

-- ------------------------------------------------------------
-- 12. MAKE_CHESS_MOVE — validation des coups d'échecs côté serveur
-- ------------------------------------------------------------
-- Reproduit les règles de déplacement (sans détection d'échec/mat
-- fine, comme côté client) pour empêcher un client malveillant de
-- forcer un coup illégal en appelant l'API directement.
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
-- 13. INDEX — supportent les triggers anti-spam (comptage sur une
--     fenêtre de temps récente par utilisateur), évitent un scan
--     complet de la table à chaque insertion.
-- ------------------------------------------------------------
create index if not exists idx_swipes_swiper_created on public.swipes (swiper_id, created_at desc);
create index if not exists idx_messages_sender_created on public.messages (sender_id, created_at desc);
create index if not exists idx_reports_reporter_created on public.reports (reporter_id, created_at desc);
