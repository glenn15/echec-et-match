# Échec & Match

Application de rencontre + apéro + échecs, avec authentification et données réelles via Supabase (plus aucune simulation : comptes, profils, matchs, chat et parties d'échecs sont persistés et synchronisés en temps réel).

## 1. Créer le projet Supabase

1. Allez sur [supabase.com](https://supabase.com) → **New project**.
2. Une fois créé, ouvrez **SQL Editor** → **New query**, collez le contenu de `supabase/schema.sql`, puis **Run**.
   Cela crée les tables `profiles`, `swipes`, `matches`, `messages`, `games`, `blocked_users`, `reports`, les policies RLS, les triggers (création automatique du profil, matching mutuel), le bucket de stockage `avatars`, et active le Realtime.
3. Dans **Authentication → Settings**, laissez **"Confirm email" activé** (c'est le comportement par défaut) — l'inscription n'est validée qu'après clic sur le lien reçu par email. C'est un prérequis avant tout lancement public.
4. Dans **Authentication → Email Templates**, personnalisez le template de confirmation (logo, texte en français) avant le lancement. Exemple de template "Confirm signup" en français à coller :

   **Subject** : `Confirmez votre inscription à Échec & Match`

   **Message body** (HTML) :
   ```html
   <h2>Bienvenue à table 🥂♟️</h2>
   <p>Encore une étape avant de rejoindre Échec &amp; Match : confirmez votre adresse email.</p>
   <p><a href="{{ .ConfirmationURL }}">Confirmer mon inscription</a></p>
   <p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
   ```

   Faites de même pour "Reset password" (Réinitialisation du mot de passe) et "Magic Link" si vous les utilisez.
5. Récupérez vos clés dans **Project Settings → API** :
   - `Project URL`
   - `anon public` key

## 2. Configurer le projet local

```bash
cp .env.example .env.local
```

Remplissez `.env.local` :

```
VITE_SUPABASE_URL=https://votre-projet.supabase.co
VITE_SUPABASE_ANON_KEY=votre_cle_anon
```

Installez les dépendances et lancez en local :

```bash
npm install
npm run dev
```

## 3. Déployer (Vercel ou Netlify)

**Vercel**
```bash
npm i -g vercel
vercel
```
Ajoutez les variables `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` dans Project Settings → Environment Variables, puis redéployez.

**Netlify**
```bash
npm run build
```
Déployez le dossier `dist/` (via `netlify deploy` ou glisser-déposer sur app.netlify.com). Ajoutez les mêmes variables d'environnement dans Site settings → Environment variables.

## Comment ça fonctionne

- **Auth** : `supabase.auth.signUp` (avec confirmation email obligatoire) / `signInWithPassword` / `signOut`, session persistée automatiquement par le SDK. Le profil est créé **côté serveur** par un trigger Postgres dès l'inscription (avant même la confirmation), à partir des métadonnées passées à `signUp`.
- **Âge** : date de naissance obligatoire, âge calculé côté client ET vérifié — bloque toute inscription en dessous de 18 ans.
- **Photos** : upload réel vers Supabase Storage (bucket `avatars`, public en lecture, écriture restreinte à son propre dossier).
- **Profils à swiper** : requête sur `profiles` en excluant les profils déjà swipés et les utilisateurs bloqués (dans les deux sens).
- **Matchs** : chaque swipe est enregistré dans `swipes` ; un trigger PostgreSQL détecte automatiquement quand deux personnes se sont swipées "à droite" mutuellement et crée une ligne dans `matches`.
- **Chat** : table `messages`, avec un abonnement Realtime Supabase pour recevoir les nouveaux messages instantanément. Menu "⋯" pour signaler ou bloquer.
- **Modération** : table `reports` (signalements consultables uniquement via la clé `service_role`, côté back-office) et `blocked_users` (le blocage exclut immédiatement la personne des profils à swiper et de la liste de matchs).
- **Suppression de compte** : fonction RPC `delete_own_account()` supprime le profil et, par cascade, toutes les données liées. **Limite connue** : la ligne `auth.users` elle-même doit être supprimée côté serveur avec la clé `service_role` (via une Edge Function ou le dashboard) — l'anon key ne le permet pas pour des raisons de sécurité. Prévoir cette Edge Function avant le lancement public si la suppression complète du compte auth est requise légalement (RGPD).
- **Échecs** : table `games` (une par match), état du plateau stocké en JSON, synchronisé en temps réel avec l'adversaire via Realtime. **Chaque coup est désormais validé côté serveur** par la fonction `make_chess_move()` (security definer) qui réimplémente les règles de déplacement (pion, cavalier, fou, tour, dame, roi, y compris le blocage sur les pièces glissantes) — un client malveillant ne peut plus forcer un coup illégal ni jouer hors tour, même en appelant l'API directement. La table `games` n'accepte plus d'`UPDATE` direct que pour réinitialiser une partie (retour à la position de départ) ; tout coup de jeu doit passer par cette fonction.
- **Quitter un match** : bouton "Quitter la table" dans le menu du chat, supprime le match (et en cascade messages/partie associés).
- **Anti-spam** : triggers Postgres limitant à 20 messages/minute et 60 swipes/minute par utilisateur — au-delà, l'insertion est rejetée côté serveur.
- **Mot de passe** : minimum 8 caractères avec au moins une lettre et un chiffre.
- **Ordre des profils** : mélangé aléatoirement côté client à chaque chargement (évite que les mêmes profils soient toujours vus en premier).
- **Sécurité** : Row Level Security activé sur toutes les tables — chacun ne peut lire/écrire que ses propres données ou celles des matchs dont il fait partie.
- **Présence en ligne** : channel Supabase Realtime Presence — chaque utilisateur connecté "track" sa présence, affichée en badge vert sur les profils et matchs en ligne au même moment.
- **Elo & historique** : table `game_history` + fonction RPC `record_chess_win` (security definer, formule Elo standard K=32) — appelée automatiquement à chaque échec et mat, met à jour l'Elo des deux joueurs et journalise la partie. Consultable dans l'onglet Profil.
- **Thèmes de plateau** : 4 presets stockés dans `profiles.board_theme`, sélectionnables depuis le profil.
- **Onboarding** : modal 4 étapes affiché une seule fois après la première connexion (flag en `localStorage`, pas en base — donc propre à chaque appareil).
- **Résilience réseau** : une bannière apparaît en cas de perte de connexion (`navigator.onLine`) ; au retour du réseau, le deck de profils, la liste des matchs, le chat et la partie d'échecs en cours se rechargent automatiquement plutôt que de rester figés sur un état périmé.
- **Pagination** : les profils à swiper sont chargés par pages de 20 (`range()`), la page suivante se charge automatiquement quand il n'en reste plus que 5 dans la pile — pas de limite artificielle sur la taille de la base.
- **Filtres de recherche** : âge min/max, Elo minimum, distance maximale — appliqués côté client sur le lot de profils chargé.
- **Distance** : chaque profil peut partager sa position (bouton dans l'onglet Profil, `navigator.geolocation`) ; la distance est calculée avec la formule de Haversine et affichée sur les cartes.
- **Notifications navigateur** : après activation (bouton dans Profil, `Notification.requestPermission()`), une notification système apparaît pour un nouveau match ou message reçu **pendant que l'onglet est en arrière-plan**. Limite importante : ceci ne fonctionne que si l'application est ouverte dans un onglet (même en arrière-plan) — recevoir des notifications quand l'app est complètement fermée nécessiterait un Service Worker + push VAPID + une Edge Function côté serveur, non inclus ici.

## Limites connues à traiter avant un lancement à grande échelle

- Suppression complète du compte `auth.users` (nécessite une Edge Function avec la clé `service_role` — l'anon key ne le permet pas).
- Les CGU/politique de confidentialité affichées dans l'app sont un texte indicatif, à faire valider par un juriste.

## Audit de sécurité — failles corrigées

Une relecture complète a révélé et corrigé les failles suivantes :

1. **Fuite de données personnelles (critique)** — la policy de lecture sur `profiles` autorisait n'importe quel utilisateur connecté à lire l'email, la date de naissance et les **coordonnées GPS exactes** de tout le monde (pas seulement des profils affichés dans l'app — via un appel direct à l'API). Corrigé : `profiles` ne peut plus être lu que par son propriétaire ; les autres utilisateurs passent par la nouvelle vue `public_profiles`, qui n'expose que les champs non sensibles et une **distance déjà calculée côté serveur** (jamais les coordonnées brutes).
2. **Triche sur l'Elo (élevé)** — rien n'empêchait un utilisateur d'appeler directement `update profiles set elo = 9999` sur son propre compte. Corrigé : les droits `UPDATE` sur `profiles` sont désormais restreints par colonne (`revoke` + `grant` ciblé) — l'Elo ne peut plus être modifié que par la fonction serveur `record_chess_win`.
3. **Plateau d'échecs truqué à la création (élevé)** — la policy d'insertion sur `games` ne vérifiait pas le contenu du plateau, un client aurait pu créer une partie avec une position déjà gagnante. Corrigé : l'insertion exige désormais explicitement la position de départ standard.
4. **Détournement de `search_path` (moyen, bonne pratique Postgres/Supabase)** — les fonctions `SECURITY DEFINER` (qui s'exécutent avec des privilèges élevés) ne fixaient pas leur `search_path`, ce qui les rend théoriquement détournables. Corrigé : `set search_path = public, pg_temp` ajouté aux 7 fonctions concernées.
5. **Table inutilisée** — `match_reads` (indicateur de lecture) avait été créée mais n'était jamais utilisée par le client ; supprimée pour réduire la surface d'attaque inutile.

## Deuxième passe de sécurité

Une relecture supplémentaire, en creusant spécifiquement les privilèges d'exécution des fonctions (pas seulement les policies RLS), a trouvé :

6. **Triche encore plus grave que prévu (critique)** — `record_chess_win()` était directement appelable par n'importe quel client via RPC, sans aucune vérification qu'une partie avait réellement été gagnée : il suffisait d'appeler la fonction avec son propre id comme gagnant pour s'octroyer de l'Elo et fabriquer un faux historique de victoires, sur n'importe quel match. Corrigé : l'exécution directe est révoquée pour tous les rôles (y compris `PUBLIC`, à qui Postgres accorde `EXECUTE` par défaut sur toute nouvelle fonction) — seul l'appel interne depuis `make_chess_move()` (qui valide tout correctement) reste possible, car le propriétaire d'une fonction conserve toujours ses propres droits d'exécution.
7. **Privilège par défaut de Postgres non révoqué** — `PUBLIC` (donc potentiellement `anon`, les visiteurs non connectés) avait un accès d'exécution implicite sur toutes les fonctions, y compris `make_chess_move` et `delete_own_account`. L'impact réel était limité (ces fonctions vérifient `auth.uid()` en interne), mais révoqué explicitement par prudence.
8. **Signalements non protégés contre le spam** — ajout d'une limite de 10 signalements/heure par utilisateur, et vérification qu'un `message_id` signalé appartient bien à un match dont le signaleur fait partie.
9. **Aucune limite serveur sur les photos de profil** — le bucket de stockage n'imposait ni taille max ni type de fichier ; un client pouvait contourner les vérifications faites côté interface. Corrigé au niveau du bucket lui-même (5 Mo max, images uniquement).

## Troisième passe de sécurité — points de la liste fine résolus

1. **Blocage désormais réellement appliqué en base** — `blocked_users` a été déplacée plus tôt dans le schéma pour que `public_profiles`, `swipes` et `messages` puissent tous s'appuyer dessus. Un utilisateur bloqué ne peut plus swiper, matcher, ni écrire à la personne qui l'a bloqué (ou l'inverse) même en appelant l'API directement, et `public_profiles` n'expose plus le profil d'un utilisateur bloqué dans un sens comme dans l'autre.
2. **Vérification des 18+ côté serveur** — `handle_new_user()` rejette désormais toute inscription sans date de naissance valide indiquant 18 ans ou plus, quel que soit le chemin utilisé (interface ou appel direct à l'API). *Limite à connaître* : l'API d'authentification de Supabase a tendance à renvoyer un message générique ("Database error saving new user") plutôt que le message précis levé par le trigger — la validation elle-même fonctionne, seul l'affichage de l'erreur exacte n'est pas garanti pour quelqu'un qui contournerait l'interface.
3. **Consentement aux CGU réellement vérifié** — le client transmet maintenant `accepted_terms` dans les métadonnées d'inscription, et le trigger refuse la création de compte si ce champ n'est pas explicitement `true`. `terms_accepted_at` ne peut plus être enregistré sans consentement réel.
4. **Limites de longueur** sur `profiles.name/bio/aperitif`, `messages.text`, `reports.details`, et contrainte `CHECK` sur `reports.reason` (valeurs autorisées limitées à celles utilisées par l'app).
5. **`reports.reported_id` vérifié** — on ne peut plus signaler que quelqu'un avec qui on a un match existant.
6. **Index ajoutés** sur `(sender_id/swiper_id/reporter_id, created_at)` pour que les triggers anti-spam n'aient plus à scanner toute la table à chaque insertion.
7. **`games_set_initial_turn()` sécurisée** — lève désormais une exception explicite plutôt que de laisser silencieusement `turn_user_id` à `NULL` (ce qui aurait rendu une partie injouable pour toujours sans message d'erreur).
8. **Garde-fou `winner ≠ loser`** ajouté dans `record_chess_win`, en plus de la restriction d'accès déjà en place.
9. **`WITH CHECK` explicite** ajouté à la policy `UPDATE` de `profiles` (le comportement était déjà correct implicitement, mais dépendait d'un défaut Postgres plutôt que d'une intention écrite).
10. Nettoyage de la numérotation des commentaires de section (dédoublonnage).

**Résiduel, non traité par choix (déjà documenté comme acceptable ou hors-code)** : colonne `profiles.city` inutilisée, coordonnées GPS auto-déclarées par l'utilisateur (comportement voulu), configuration des Redirect URLs dans le dashboard Supabase, stockage du JWT en `localStorage` par le SDK (standard pour une SPA).

Comme pour les passes précédentes, ces correctifs SQL ont été vérifiés syntaxiquement (parenthèses, découpage des instructions) mais pas exécutés contre une vraie instance Postgres dans cet environnement — à valider sur un projet Supabase de test avant la production, en particulier en essayant de créer un compte avec une fausse date de naissance ou sans cocher les CGU pour confirmer que le rejet fonctionne bien.

## Structure du projet

```
├── index.html
├── package.json
├── vite.config.js
├── .env.example
├── supabase/
│   └── schema.sql        ← à exécuter dans Supabase SQL Editor
└── src/
    ├── main.jsx
    ├── App.jsx            ← toute l'UI + logique Supabase
    ├── chess.js           ← moteur d'échecs (règles de déplacement)
    └── supabaseClient.js  ← initialisation du client Supabase
```
