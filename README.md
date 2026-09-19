# Échec & Match

Application de rencontre + apéro + échecs, avec authentification et données réelles via Supabase (comptes, profils, matchs, chat, parties d'échecs et abonnements Premium sont persistés et synchronisés en temps réel — aucune donnée simulée).

Pour l'historique de l'audit de sécurité et la liste des limites connues, voir [`SECURITY.md`](./SECURITY.md).

## 1. Créer le projet Supabase

1. Allez sur [supabase.com](https://supabase.com) → **New project**.
2. Une fois créé, ouvrez **SQL Editor** → **New query**, collez l'intégralité de `supabase/schema.sql`, puis **Run**.
   Cela crée toutes les tables (`profiles`, `swipes`, `matches`, `messages`, `games`, `game_history`, `blocked_users`, `reports`, `profile_photos`, `referrals`, `match_reads`), les policies RLS, les fonctions et triggers serveur, le bucket de stockage `avatars`, et active le Realtime — voir la section [Structure de la base](#structure-de-la-base) plus bas pour le détail de chaque table.
3. Dans **Authentication → Settings**, laissez **"Confirm email" activé** (comportement par défaut) — l'inscription n'est validée qu'après clic sur le lien reçu par email. Prérequis pour que le système de parrainage fonctionne.
4. Dans **Authentication → Email Templates**, personnalisez le template de confirmation (logo, texte en français) avant le lancement. Exemple de template "Confirm signup" à coller :

   **Subject** : `Confirmez votre inscription à Échec & Match`

   **Message body** (HTML) :
   ```html
   <h2>Bienvenue à table 🥂♟️</h2>
   <p>Encore une étape avant de rejoindre Échec &amp; Match : confirmez votre adresse email.</p>
   <p><a href="{{ .ConfirmationURL }}">Confirmer mon inscription</a></p>
   <p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
   ```

   Faites de même pour "Reset password" et "Magic Link" si vous les utilisez.
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

## 4. Se désigner administrateur (optionnel)

Aucune interface ne permet de s'accorder le rôle admin — c'est volontaire, pour qu'il ne soit jamais accessible via l'application elle-même. Une fois votre compte créé, exécutez dans le SQL Editor de Supabase :

```sql
update public.profiles set is_admin = true where email = 'vous@gmail.com';
```

Un onglet "🛡️ Admin" apparaît alors dans l'app, avec statistiques d'usage et liste des signalements.

## Comment ça fonctionne

### Compte et inscription
- **Auth** : `supabase.auth.signUp` (confirmation email obligatoire) / `signInWithPassword` / `signOut`, session persistée automatiquement par le SDK. Le profil est créé **côté serveur** par un trigger Postgres dès l'inscription (avant même la confirmation), à partir des métadonnées passées à `signUp` — jamais par un insert direct du client.
- **Âge** : date de naissance obligatoire, vérifiée côté client ET côté serveur — bloque toute inscription en dessous de 18 ans, même via un appel direct à l'API.
- **Domaines email restreints** : seules les adresses Gmail, Outlook et iCloud sont acceptées (vérifié client + serveur), pour limiter les faux comptes créés avec des boîtes mail jetables.
- **CGU** : la case à cocher est réellement vérifiée côté serveur (`accepted_terms` dans les métadonnées) — impossible de créer un compte sans elle. Le texte affiché (`LegalModal` dans `App.jsx`) est indicatif, à faire valider par un juriste avant tout lancement public.
- **Genre, orientation, préférences de visibilité** : trois champs (`gender`, `orientation`, `looking_for`) collectés à l'inscription et modifiables depuis le profil. La visibilité dans le deck de swipe est **mutuelle** : un profil n'apparaît que si vous correspondez à ce qu'iel recherche, et inversement. Affichés en badges sur les cartes.
- **Mot de passe** : minimum 8 caractères, au moins une lettre et un chiffre.

### Photos
- **Photos multiples + carrousel**, pour tous les comptes y compris gratuits — jusqu'à 6 par profil (`profile_photos`, limite appliquée côté serveur), galerie de gestion dans le profil (ajout, suppression, définir comme photo principale), et vrai carrousel sur les cartes de swipe (zones tactiles gauche/droite, points indicateurs).
- **Photo de profil obligatoire** : un écran dédié (`MandatoryPhotoScreen`) bloque tout accès à l'application tant qu'aucune photo n'a été ajoutée ; la navigation reste cachée jusque-là.
- Upload réel vers Supabase Storage (bucket `avatars`, 5 Mo max, images uniquement, écriture restreinte à son propre dossier).

### Rencontre
- **Profils à swiper** : exclut les profils déjà swipés et les utilisateurs bloqués (dans les deux sens), respecte la visibilité mutuelle de genre, mélangés aléatoirement, paginés par lots de 20 (la page suivante se charge automatiquement).
- **Filtres** : âge min/max, Elo minimum, distance maximale.
- **Distance** : partage de position optionnel (`navigator.geolocation`), distance calculée côté serveur (formule de Haversine) et affichée sur les cartes — jamais les coordonnées brutes envoyées au client.
- **Revoir les profils passés** : les profils swipés à gauche sont mémorisés en session ; un bouton en bout de liste permet de les réinjecter dans le deck.
- **Matchs** : chaque swipe est enregistré (`swipes`) ; un trigger détecte le mutuel et crée une ligne dans `matches`.
- **Aperçu du dernier message + non-lu** : la liste des matchs affiche le dernier message échangé, avec un badge numéroté par conversation (`match_reads`, marqué comme lu à l'ouverture et à chaque nouveau message reçu). Le badge de l'onglet "Matchs" reflète le nombre de conversations non lues.
- **Quitter un match** : bouton "Quitter la table" dans le menu du chat, supprime le match et, par cascade, messages/partie associés.
- **Chat** : messages en temps réel (Realtime), menu "⋯" pour signaler ou bloquer.
- **Modération** : `blocked_users` exclut immédiatement la personne des profils à swiper, des matchs et du chat, dans les deux sens — appliqué par les policies RLS, pas seulement caché côté interface. `reports` permet de signaler un profil **avec ou sans match existant** (bouton "⚑" sur les cartes de swipe et menu dans le chat) ; consultable via le tableau de bord admin.
- **Suppression de compte** : `delete_own_account()` supprime le profil et, par cascade, toutes les données liées (voir limite connue dans `SECURITY.md`).

### Échecs
- **Parties en temps réel** : une ligne par match (`games`), plateau stocké en JSON, synchronisé via Realtime.
- **Coups validés côté serveur** : `make_chess_move()` réimplémente les règles de déplacement (pion, cavalier, fou, tour, dame, roi, blocage sur les pièces glissantes) — un client malveillant ne peut ni jouer un coup illégal ni jouer hors tour. `games` n'accepte un `UPDATE` direct que pour réinitialiser la partie ; tout coup passe par cette fonction.
- **Elo & historique** : `record_chess_win()` (formule standard K=32) met à jour l'Elo des deux joueurs et journalise la partie dans `game_history` à chaque échec et mat.
- **Thèmes de plateau** : 4 presets (2 exclusifs aux comptes Premium, verrouillés par une contrainte `CHECK` sur `profiles`, pas seulement caché dans l'interface).
- **Statistiques** : taux de victoire, série en cours, calculés dans l'onglet Profil (historique limité à 5 parties pour les comptes gratuits, plus pour Premium).

### Premium
Deux façons de débloquer le Premium, aucune bascule manuelle : le parrainage se déclenche une seule fois, le partage est répétable à volonté.
- **Parrainage** (une seule fois) : 2 personnes doivent s'inscrire **et confirmer leur email** → 1 mois de Premium offert, **une seule fois** — un 3e, 4e... filleul ne rapporte rien de plus via ce mécanisme. Code de parrainage unique par profil (`referral_code`) et lien partageable (`?ref=CODE`, pré-rempli automatiquement à l'inscription). La confirmation est détectée par un trigger sur `auth.users`, mais l'octroi du Premium est **différé de 48h** (`evaluate_referral_rewards()`, appelée à chaque chargement de profil) pour empêcher la fraude "confirmer puis supprimer aussitôt" — voir `SECURITY.md` pour le détail des garde-fous anti-fraude.
- **Partages** : 2 semaines de Premium par tranche de **5 ouvertures distinctes** de votre lien de parrainage. Contrairement à l'ancienne version, ce n'est plus le clic sur "Partager" qui est compté (un clic ne prouve rien — on peut cliquer chez soi sans jamais rien envoyer à personne), mais l'**ouverture réelle du lien par un navigateur différent** du vôtre. Chaque navigateur reçoit un identifiant anonyme (`visitor_id`, stocké en `localStorage`) dès sa première visite ; `record_link_open()` (callable même par un visiteur non connecté) enregistre l'ouverture uniquement si ce `visitor_id` diffère de celui associé à votre propre compte — s'auto-envoyer son propre lien ne compte donc plus. `evaluate_link_open_rewards()` accorde la récompense par tranches de 5, appelée comme les autres à chaque chargement de profil.
- **Expiration réelle** : `premium_until` est vérifié dans toutes les policies sensibles (Super Trinque, "qui m'a trinqué", limite de swipes), pas seulement le booléen `is_premium`. `settle_my_premium_status()` (appelée à chaque chargement de profil) remet `is_premium` à `false` une fois expiré.
- **Fonctionnalités Premium** : Super Trinque (⭐ super-like), Rewind (annuler le dernier swipe), "Qui m'a trinqué" (voir les swipes reçus avant d'y répondre), swipes illimités (25/jour pour les comptes gratuits), thèmes de plateau exclusifs, historique de parties complet.
- `is_premium`, `premium_until`, `referral_code`, `referred_by`, `referral_rewards_granted`, `link_opens_rewards_granted` sont exclus de tout `GRANT UPDATE` direct — aucun de ces champs n'est modifiable par un client, même en appelant l'API sans passer par l'app. `visitor_id`, lui, est volontairement modifiable (c'est un identifiant anonyme non sensible).

### Administration
- **Tableau de bord admin** : statistiques globales (`admin_get_stats()`) et liste des signalements avec noms des personnes concernées (`admin_get_reports()`, sans jamais exposer email/GPS/date de naissance) — deux fonctions RPC réservées aux comptes `is_admin`.
- `is_admin` n'est accordable qu'en SQL direct (voir section 4 plus haut), jamais via l'application.

### Produit
- **Landing page** avant la connexion (pitch, fonctionnalités clés, boutons d'action).
- **Mode clair** : bouton ☀️/🌙 persisté, fond/panneaux/texte s'adaptent (voir limite connue dans `SECURITY.md` sur la couverture partielle).
- **Onboarding** : modal 4 étapes affiché une seule fois après la première connexion.
- **Pop-up Premium** : juste après l'onboarding (et une fois la photo obligatoire ajoutée), un second pop-up présente les avantages du Premium et les deux façons de l'obtenir (parrainage, partage), avec un lien direct vers l'onglet Profil. Affiché une seule fois par compte, et jamais si le compte est déjà Premium.
- **Notifications navigateur** : nouveau match/message signalé quand l'onglet est en arrière-plan (voir limite connue : ne fonctionne pas app complètement fermée).
- **Présence en ligne** : badge vert en temps réel via Supabase Realtime Presence.
- **Résilience réseau** : bannière en cas de perte de connexion, rechargement automatique des données au retour du réseau.

### Sécurité générale
- Row Level Security activé sur toutes les tables.
- Anti-spam : limites de débit sur messages (20/min), swipes (60/min + 25/jour pour les comptes gratuits) et signalements (10/heure), avec index dédiés.
- Détail complet des failles trouvées et corrigées, ainsi que les limites connues restantes : voir [`SECURITY.md`](./SECURITY.md).

## Structure du projet

```
├── index.html
├── package.json
├── vite.config.js
├── .env.example
├── SECURITY.md            ← audit de sécurité + limites connues
├── supabase/
│   └── schema.sql         ← à exécuter dans Supabase SQL Editor
└── src/
    ├── main.jsx
    ├── App.jsx             ← toute l'UI + logique Supabase
    ├── chess.js            ← moteur d'échecs (règles de déplacement)
    └── supabaseClient.js   ← initialisation du client Supabase
```

## Structure de la base

| Table | Rôle |
|---|---|
| `profiles` | Un profil par utilisateur — infos publiques et privées (email, GPS exact, Elo, Premium...) |
| `public_profiles` (vue) | Ce que les autres utilisateurs voient réellement — jamais l'email, la date de naissance ou les coordonnées GPS brutes |
| `profile_photos` | Photos multiples par profil (max 6), pour le carrousel |
| `swipes` | Historique des passer/trinquer/super-trinquer |
| `matches` | Créée automatiquement par trigger sur swipe mutuel |
| `match_reads` | Dernière lecture d'un match par utilisateur (badge non-lu) |
| `messages` | Chat par match |
| `blocked_users` | Blocages, appliqués au niveau RLS (pas juste l'interface) |
| `reports` | Signalements, avec ou sans match |
| `games` | État d'une partie d'échecs par match |
| `game_history` | Historique des parties terminées + évolution Elo |
| `referrals` | Parrainages (parrain, filleul, date de confirmation) |
| `link_opens` | Ouvertures distinctes du lien de parrainage (par `visitor_id`), pour la récompense "partages" |
