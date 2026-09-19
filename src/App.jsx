import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";
import { START_BOARD, GLYPHS, PIECE_VALUE, legalMoves, findKing, isAttacked } from "./chess";

// Petit bus d'événements : quand la connexion revient, les écrans qui
// affichent des données temps réel (chat, échecs) se rechargent tout
// seuls au lieu de rester figés sur un état potentiellement périmé.
const connectivityBus = new EventTarget();
function useReconnect(callback) {
  useEffect(() => {
    const handler = () => callback();
    connectivityBus.addEventListener("reconnect", handler);
    return () => connectivityBus.removeEventListener("reconnect", handler);
  }, [callback]);
}

function OfflineBanner({ online }) {
  if (online) return null;
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 60, background: "#e08a8a", textAlign: "center", padding: "6px 0" }}>
      <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, fontWeight: 600, color: "#170f1a" }}>
        Connexion perdue — en attente du réseau…
      </span>
    </div>
  );
}

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Outfit:wght@400;500;600;700&display=swap";

const ORIENTATION_LABELS = {
  hetero: "Hétéro", gay: "Gay", lesbienne: "Lesbienne", bi: "Bi", pan: "Pansexuel·le",
  ase: "Asexuel·le", demi: "Demisexuel·le", queer: "Queer", questionnement: "En questionnement",
};
// La valeur interne "autre" est conservée pour ne pas migrer les comptes existants.
const GENDER_LABELS = { homme: "Homme", femme: "Femme", autre: "Non-binaire" };
const GENDER_OPTIONS = [{ v: "homme", l: "Homme" }, { v: "femme", l: "Femme" }, { v: "autre", l: "Non-binaire" }];
const LOOKING_OPTIONS = [{ v: "homme", l: "Hommes" }, { v: "femme", l: "Femmes" }, { v: "autre", l: "Personnes non-binaires" }];

function LookingForPicker({ value, onToggle, onSetAll }) {
  const everyone = LOOKING_OPTIONS.every((o) => value.includes(o.v));
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <ChoiceChip label="Tout le monde" active={everyone} onClick={() => onSetAll(everyone ? [] : LOOKING_OPTIONS.map((o) => o.v))} />
      {LOOKING_OPTIONS.map((o) => (
        <ChoiceChip key={o.v} active={!everyone && value.includes(o.v)} onClick={() => (everyone ? onSetAll([o.v]) : onToggle(o.v))} label={o.l} />
      ))}
    </div>
  );
}

// ---------- Fiche profil enrichie ----------
const PROMPT_QUESTIONS = [
  "Mon apéro idéal, c'est…",
  "Échec et mat assuré si tu m'invites à…",
  "Mon premier coup pour briser la glace…",
  "Un dimanche parfait…",
  "On va bien s'entendre si…",
  "Je te parie un verre que…",
  "Mon plaisir coupable…",
  "Le coup le plus audacieux que j'aie joué dans la vie…",
  "Je perds tous mes moyens quand…",
  "Le dernier truc qui m'a fait rire…",
  "Ma plus grande fierté…",
  "Mon red flag, c'est…",
  "Je cherche quelqu'un qui…",
];
const INTERESTS = [
  "🍷 Vin", "🍺 Bière artisanale", "🍸 Cocktails", "☕ Café", "🍳 Cuisine", "🥐 Pâtisserie",
  "🎬 Cinéma", "📺 Séries", "📚 Lecture", "🎮 Jeux vidéo", "🎲 Jeux de société", "🧩 Énigmes",
  "🎵 Concerts", "🎸 Musique", "🎨 Art", "📸 Photo", "🎭 Théâtre", "💃 Danse",
  "✈️ Voyages", "🏕️ Camping", "🥾 Randonnée", "🌊 Plage", "🚴 Vélo", "🏃 Running",
  "🏋️ Muscu", "🧘 Yoga", "⚽ Foot", "🏉 Rugby", "🐶 Chiens", "🐱 Chats",
  "🌱 Jardinage", "🔧 Bricolage", "💻 Tech", "🗣️ Langues", "🏰 Histoire", "🔭 Sciences",
];
const GOAL_LABELS = { serieux: "💍 Relation sérieuse", fun: "🥂 Rencontres sympas", amitie: "🤝 Amitié", on_verra: "🤷 On verra bien" };
const DRINKS_LABELS = { jamais: "Ne boit pas", parfois: "Boit parfois", souvent: "Boit volontiers" };
const SMOKES_LABELS = { non: "Non-fumeur", parfois: "Fume parfois", oui: "Fumeur" };
const KIDS_LABELS = { non: "Pas d'enfants", en_ont: "A des enfants", en_veulent: "Veut des enfants", pas_decide: "Pas encore décidé" };
const LEVEL_LABELS = { decouvre: "🐣 Je découvre les échecs", regles: "♟ Je connais les règles", souvent: "🏆 Je joue souvent" };
const LEVEL_SHORT = { decouvre: "🐣 Découvre les échecs", regles: "♟ Connaît les règles", souvent: "🏆 Joue souvent" };
const PIECE_LABELS = {
  roi: "♚ Le roi : j'aime qu'on prenne soin de moi",
  dame: "♛ La dame : je vais partout",
  tour: "♜ La tour : droit·e et fiable",
  fou: "♝ Le fou : j'avance de biais",
  cavalier: "♞ Le cavalier : imprévisible",
  pion: "♟ Le pion : petit mais ambitieux",
};
const PIECE_NAMES = { k: "Roi", q: "Dame", r: "Tour", b: "Fou", n: "Cavalier", p: "Pion" };
const PIECE_TIPS = {
  k: "avance d'une seule case, dans toutes les directions. C'est la pièce à protéger !",
  q: "va aussi loin qu'elle veut, en ligne droite ou en diagonale. La pièce la plus forte.",
  r: "va aussi loin qu'elle veut en ligne droite, à l'horizontale ou à la verticale.",
  b: "va aussi loin qu'il veut, mais uniquement en diagonale.",
  n: "se déplace en « L » (2 cases puis 1 sur le côté) et peut sauter par-dessus les pièces.",
  p: "avance tout droit d'une case (deux au premier coup) et prend en diagonale.",
};

const BOARD_THEMES = {
  sauge: { label: "Sauge", dark: ["#4a5d43", "#3a4a35"], light: ["#d9d3b8", "#c9c2a4"] },
  ivoire: { label: "Ivoire", dark: ["#9c8f70", "#867a5f"], light: ["#f3ecd9", "#e6dcc2"] },
  nuit: { label: "Nuit", dark: ["#2b3a52", "#212c3f"], light: ["#8fa3bf", "#7891ad"] },
  bordeaux: { label: "Bordeaux", dark: ["#6d2438", "#54192a"], light: ["#e3c3b5", "#d3ac9c"] },
};

const GLOBAL_STYLES = `
:root, [data-theme="dark"] { --text-rgb: 244,236,219; --panel-a: rgba(255,255,255,0.14); --panel-b: rgba(255,255,255,0.04); --panel-border: rgba(255,255,255,0.16); --panel-shadow: rgba(0,0,0,0.35); --modal-bg: linear-gradient(160deg, #2c1a26, #1a111c); --accent: #f0dcae; --accent-2: #cda45e; }
[data-theme="light"] { --text-rgb: 47,34,38; --panel-a: rgba(23,15,26,0.06); --panel-b: rgba(23,15,26,0.02); --panel-border: rgba(23,15,26,0.12); --panel-shadow: rgba(120,100,80,0.18); --modal-bg: linear-gradient(160deg, #fffaf2, #f4e9d8); --accent: #8a5a1c; --accent-2: #9a6a24; }
@keyframes fadeSlideUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
@keyframes popIn { 0% { opacity: 0; transform: scale(0.85); } 60% { transform: scale(1.04); } 100% { opacity: 1; transform: scale(1); } }
@keyframes splashFade { 0% { opacity: 1; } 85% { opacity: 1; } 100% { opacity: 0; visibility: hidden; } }
* { box-sizing: border-box; }
.em-modal { background: var(--modal-bg) !important; }
::selection { background: rgba(205,164,94,0.35); }
input, textarea { transition: border-color 0.2s ease, box-shadow 0.2s ease; }
input:focus, textarea:focus { border-color: rgba(205,164,94,0.6) !important; box-shadow: 0 0 0 3px rgba(205,164,94,0.15); }
.em-fade-in { animation: fadeSlideUp 0.4s cubic-bezier(0.22,1,0.36,1) both; }
.em-btn { transition: transform 0.15s ease, filter 0.15s ease, box-shadow 0.15s ease; }
.em-btn:hover { filter: brightness(1.08); }
.em-btn:active { transform: scale(0.96); }
.em-nav-btn { transition: background 0.2s ease, color 0.2s ease, transform 0.15s ease; }
.em-nav-btn:active { transform: scale(0.92); }
.em-list-row { transition: transform 0.18s ease; }
.em-list-row:hover { transform: translateY(-2px); }
.em-square { transition: background 0.15s ease; }
.em-square:hover { filter: brightness(1.15); }
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-thumb { background: rgba(205,164,94,0.4); border-radius: 999px; }
`;

const THEME_BG = {
  dark: "radial-gradient(circle at 20% 0%, #2a1520 0%, #170f1a 45%, #0e0810 100%)",
  light: "radial-gradient(circle at 20% 0%, #fdf6ec 0%, #f2e6d5 45%, #e9d9c4 100%)",
};

// ---------- Glass primitives ----------
function GlassPanel({ children, style = {}, className = "" }) {
  return (
    <div
      className={className}
      style={{
        background: "linear-gradient(160deg, var(--panel-a), var(--panel-b))",
        backdropFilter: "blur(22px) saturate(160%)",
        WebkitBackdropFilter: "blur(22px) saturate(160%)",
        border: "1px solid var(--panel-border)",
        borderRadius: 24,
        boxShadow: "0 8px 32px var(--panel-shadow), inset 0 1px 0 var(--panel-a)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function EloBadge({ elo }) {
  return (
    <span
      style={{
        fontFamily: "'Outfit', sans-serif",
        fontSize: 12,
        fontWeight: 600,
        color: "var(--accent)",
        background: "rgba(205,164,94,0.18)",
        border: "1px solid rgba(205,164,94,0.4)",
        borderRadius: 999,
        padding: "4px 10px",
      }}
    >
      ♟ {elo} pts
    </span>
  );
}

function LevelBadge({ level }) {
  if (!level) return null;
  return (
    <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, fontWeight: 600, color: "var(--accent)", background: "rgba(205,164,94,0.18)", border: "1px solid rgba(205,164,94,0.4)", borderRadius: 999, padding: "4px 10px", whiteSpace: "nowrap" }}>
      {LEVEL_SHORT[level]}
    </span>
  );
}

function Chip({ label }) {
  return (
    <span
      style={{
        fontFamily: "'Outfit', sans-serif",
        fontSize: 12.5,
        color: "rgb(var(--text-rgb))",
        background: "rgba(255,255,255,0.09)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 999,
        padding: "5px 11px",
      }}
    >
      {label}
    </span>
  );
}

function RoundButton({ onClick, label, symbol, tint, big, disabled, locked }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        position: "relative",
        width: big ? 64 : 54,
        height: big ? 64 : 54,
        borderRadius: "50%",
        border: "1px solid rgba(255,255,255,0.22)",
        background: `radial-gradient(circle at 35% 30%, ${tint}, rgba(255,255,255,0.05))`,
        backdropFilter: "blur(14px)",
        color: "rgb(var(--text-rgb))",
        fontSize: big ? 24 : 20,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : locked ? 0.55 : 1,
        boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
        transition: "transform 0.15s ease",
      }}
      onMouseDown={(e) => !disabled && (e.currentTarget.style.transform = "scale(0.92)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
    >
      {symbol}
      {locked && (
        <span style={{ position: "absolute", bottom: -2, right: -2, fontSize: 12, background: "#170f1a", borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(255,255,255,0.3)" }}>
          🔒
        </span>
      )}
    </button>
  );
}

function Avatar({ initials, hue, photoUrl, size = 48 }) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          flexShrink: 0,
          objectFit: "cover",
          border: "1px solid rgba(255,255,255,0.16)",
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Fraunces', serif",
        fontWeight: 500,
        fontSize: size * 0.36,
        color: "rgb(var(--text-rgb))",
        background: `radial-gradient(circle at 30% 25%, ${hue}dd, #170f1a)`,
        border: "1px solid rgba(255,255,255,0.16)",
      }}
    >
      {initials}
    </div>
  );
}

async function uploadProfilePhoto(userId, file) {
  const ext = file.name.split(".").pop();
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("avatars").upload(path, file, { cacheControl: "3600" });
  if (error) return { ok: false, error: error.message };
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  const url = `${data.publicUrl}?t=${Date.now()}`;

  const { count } = await supabase.from("profile_photos").select("*", { count: "exact", head: true }).eq("profile_id", userId);
  const { error: insertError } = await supabase.from("profile_photos").insert({ profile_id: userId, url, position: count || 0 });
  if (insertError) return { ok: false, error: insertError.message };

  if (!count) {
    await supabase.from("profiles").update({ photo_url: url }).eq("id", userId);
  }
  return { ok: true, url };
}

async function deleteProfilePhoto(photoId, profileId, wasCover, remainingPhotos) {
  await supabase.from("profile_photos").delete().eq("id", photoId);
  if (wasCover) {
    const nextCover = remainingPhotos.find((p) => p.id !== photoId);
    await supabase.from("profiles").update({ photo_url: nextCover ? nextCover.url : null }).eq("id", profileId);
  }
}

function notifyIfHidden(title, body) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (typeof document !== "undefined" && document.visibilityState === "visible") return;
  try {
    new Notification(title, { body, icon: undefined });
  } catch {
    // ignore — some browsers restrict Notification outside a service worker context
  }
}

function getOrCreateVisitorId() {
  if (typeof localStorage === "undefined") return null;
  let id = localStorage.getItem("em_visitor_id");
  if (!id) {
    id = (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem("em_visitor_id", id);
  }
  return id;
}

function calcAge(birthdate) {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  if (isNaN(b.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - b.getFullYear();
  const m = today.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
  return age;
}

function LegalModal({ onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,6,10,0.65)", backdropFilter: "blur(6px)", padding: 20 }}>
      <GlassPanel style={{ padding: 24, maxWidth: 380, maxHeight: "80vh", overflowY: "auto" }} className="em-fade-in em-modal">
        <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: "rgb(var(--text-rgb))", marginTop: 0 }}>CGU &amp; Confidentialité</h3>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12.5, lineHeight: 1.6, color: "rgba(var(--text-rgb),0.75)" }}>
          Échec &amp; Match est réservé aux personnes de 18 ans ou plus. En créant un compte, vous acceptez que vos
          données (profil, messages, parties) soient stockées afin de faire fonctionner le service, et que d'autres
          utilisateurs puissent voir votre profil public. Vous pouvez demander la suppression de votre compte et de
          vos données à tout moment depuis votre profil. Les messages et signalements peuvent être examinés en cas
          de comportement abusif. Nous ne partageons pas vos données avec des tiers à des fins publicitaires.
        </p>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "rgba(var(--text-rgb),0.5)" }}>
          Ceci est un texte indicatif — à faire valider par un juriste avant tout lancement public.
        </p>
        <button
          className="em-btn"
          onClick={onClose}
          style={{ marginTop: 10, fontFamily: "'Outfit', sans-serif", fontSize: 12.5, fontWeight: 600, color: "#170f1a", background: "linear-gradient(160deg, #f0dcae, #cda45e)", border: "none", borderRadius: 999, padding: "9px 18px", cursor: "pointer" }}
        >
          Fermer
        </button>
      </GlassPanel>
    </div>
  );
}

function SplashScreen({ text }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        background: "radial-gradient(circle at 20% 0%, #2a1520 0%, #170f1a 45%, #0e0810 100%)",
      }}
    >
      <div style={{ fontSize: 42, animation: "popIn 0.6s cubic-bezier(0.22,1,0.36,1) both" }}>🥂♟️</div>
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 24, color: "rgb(var(--text-rgb))" }}>Échec &amp; Match</div>
      <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: "rgba(var(--text-rgb),0.5)" }}>{text}</div>
    </div>
  );
}

function Toast({ text }) {
  if (!text) return null;
  return (
    <div style={{ position: "fixed", top: 18, left: "50%", transform: "translateX(-50%)", zIndex: 40, animation: "fadeSlideUp 0.3s ease both" }}>
      <GlassPanel style={{ padding: "10px 18px" }}>
        <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12.5, color: "rgb(var(--text-rgb))" }}>{text}</span>
      </GlassPanel>
    </div>
  );
}

function Bokeh({ top, left, size, color, dur }) {
  return (
    <div
      style={{
        position: "absolute", top, left, width: size, height: size, borderRadius: "50%",
        background: `radial-gradient(circle, ${color}, transparent 70%)`,
        filter: "blur(30px)", animation: `float ${dur} ease-in-out infinite`, pointerEvents: "none",
      }}
    >
      <style>{`@keyframes float { 0%,100% { transform: translateY(0) translateX(0); } 50% { transform: translateY(24px) translateX(14px); } }`}</style>
    </div>
  );
}

const labelStyle = { display: "block", fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "rgba(var(--text-rgb),0.6)", marginBottom: 5 };
const inputStyle = {
  width: "100%", boxSizing: "border-box", fontFamily: "'Outfit', sans-serif", fontSize: 13.5, color: "rgb(var(--text-rgb))",
  background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 12, padding: "10px 14px", outline: "none",
};

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type={type} value={value} onChange={onChange} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}

function SectionTitle({ icon, title, hint }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ fontFamily: "'Fraunces', serif", fontSize: 16, color: "rgb(var(--text-rgb))" }}>{title}</span>
        <span style={{ flex: 1, height: 1, background: "var(--panel-border)", marginLeft: 6 }} />
      </div>
      {hint && <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "rgba(var(--text-rgb),0.5)", margin: "4px 0 0" }}>{hint}</p>}
    </div>
  );
}

function ChoiceChip({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="em-btn"
      style={{
        fontFamily: "'Outfit', sans-serif", fontSize: 12, fontWeight: 600,
        color: active ? "#170f1a" : "rgb(var(--text-rgb))",
        background: active ? "linear-gradient(160deg, #f0dcae, #cda45e)" : "rgba(255,255,255,0.08)",
        border: active ? "none" : "1px solid rgba(255,255,255,0.18)",
        borderRadius: 999, padding: "7px 14px", cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

// ---------- Landing ----------
function LandingScreen({ onStart }) {
  const features = [
    { icon: "🥂", title: "Swipez", text: "Découvrez des profils près de chez vous, filtrez par âge, distance ou niveau aux échecs." },
    { icon: "💌", title: "Matchez", text: "En cas de coup de cœur mutuel, une table s'ouvre pour discuter." },
    { icon: "♟️", title: "Jouez", text: "Faites une partie avec votre match, même sans savoir jouer : l'app montre les coups possibles et les règles tiennent en un apéro." },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28, paddingTop: 12 }}>
      <div style={{ textAlign: "center" }} className="em-fade-in">
        <div style={{ fontSize: 44, marginBottom: 6 }}>🥂♟️</div>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 14, color: "rgba(var(--text-rgb),0.75)", maxWidth: 300, margin: "0 auto", lineHeight: 1.6 }}>
          Débutant ou mordu, tout le monde a sa place à la table. Ici on trinque d'abord, et on joue ensuite.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 340 }}>
        {features.map((f, i) => (
          <GlassPanel key={i} style={{ padding: 16, display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ fontSize: 22 }}>{f.icon}</div>
            <div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, color: "rgb(var(--text-rgb))", marginBottom: 2 }}>{f.title}</div>
              <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12.5, color: "rgba(var(--text-rgb),0.65)", lineHeight: 1.5 }}>{f.text}</div>
            </div>
          </GlassPanel>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 340 }}>
        <button
          className="em-btn"
          onClick={() => onStart("register")}
          style={{
            fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 600, color: "#170f1a",
            background: "linear-gradient(160deg, #f0dcae, #cda45e)", border: "none", borderRadius: 999,
            padding: "13px 0", cursor: "pointer",
          }}
        >
          Créer un compte
        </button>
        <button
          className="em-btn"
          onClick={() => onStart("login")}
          style={{
            fontFamily: "'Outfit', sans-serif", fontSize: 13, fontWeight: 600, color: "rgb(var(--text-rgb))",
            background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999,
            padding: "12px 0", cursor: "pointer",
          }}
        >
          J'ai déjà un compte
        </button>
      </div>

      <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 10.5, color: "rgba(var(--text-rgb),0.35)", textAlign: "center", maxWidth: 300 }}>
        Réservé aux 18 ans et plus · Adresses Gmail, Outlook ou iCloud uniquement
      </p>
    </div>
  );
}

// ---------- Auth ----------
function AuthScreen({ onLogin, onRegister, initialMode = "login", onBackToLanding }) {
  const [mode, setMode] = useState(initialMode);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [showLegal, setShowLegal] = useState(false);
  const initialReferralCode = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("ref") || "" : "";
  const [fields, setFields] = useState({
    email: "", password: "", name: "", birthdate: "", bio: "", aperitif: "", acceptTerms: false,
    gender: "", lookingFor: [], referralCode: initialReferralCode,
  });

  const update = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));
  const toggleLookingFor = (value) =>
    setFields((f) => ({
      ...f,
      lookingFor: f.lookingFor.includes(value) ? f.lookingFor.filter((v) => v !== value) : [...f.lookingFor, value],
    }));

  const submit = async () => {
    setError("");
    setInfo("");
    if (mode === "login") {
      setLoading(true);
      const res = await onLogin(fields.email.trim().toLowerCase(), fields.password);
      setLoading(false);
      if (!res.ok) setError(res.error);
    } else {
      if (!fields.name.trim() || !fields.email.trim() || !fields.password) {
        setError("Nom, email et mot de passe sont obligatoires.");
        return;
      }
      const emailDomain = fields.email.trim().toLowerCase().split("@")[1] || "";
      if (!["gmail.com", "outlook.com", "icloud.com"].includes(emailDomain)) {
        setError("Seules les adresses Gmail, Outlook ou iCloud sont acceptées.");
        return;
      }
      if (fields.password.length < 8) {
        setError("Le mot de passe doit contenir au moins 8 caractères.");
        return;
      }
      if (!/[A-Za-z]/.test(fields.password) || !/[0-9]/.test(fields.password)) {
        setError("Le mot de passe doit contenir au moins une lettre et un chiffre.");
        return;
      }
      if (!fields.birthdate) {
        setError("Votre date de naissance est obligatoire.");
        return;
      }
      const age = calcAge(fields.birthdate);
      if (age === null || age < 18) {
        setError("Échec & Match est réservé aux personnes de 18 ans ou plus.");
        return;
      }
      if (!fields.gender) {
        setError("Merci d'indiquer votre genre.");
        return;
      }
      if (fields.lookingFor.length === 0) {
        setError("Sélectionnez au moins qui vous souhaitez voir.");
        return;
      }
      if (!fields.acceptTerms) {
        setError("Vous devez accepter les CGU et la politique de confidentialité.");
        return;
      }
      setLoading(true);
      const res = await onRegister({
        email: fields.email.trim().toLowerCase(),
        password: fields.password,
        name: fields.name.trim(),
        age,
        birthdate: fields.birthdate,
        gender: fields.gender,
        lookingFor: fields.lookingFor,
        bio: fields.bio.trim() || "Nouveau·elle à la table, prêt·e pour un apéro et une partie.",
        aperitif: fields.aperitif.trim() || "À définir",
        acceptTerms: fields.acceptTerms === true,
        referralCode: fields.referralCode.trim(),
      });
      setLoading(false);
      if (!res.ok) setError(res.error);
      else if (res.needsConfirmation) setInfo(res.message);
    }
  };

  const handleKeyDown = (e) => { if (e.key === "Enter") submit(); };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, paddingTop: 8 }}>
      {onBackToLanding && (
        <button
          onClick={onBackToLanding}
          style={{ alignSelf: "flex-start", marginLeft: 4, fontFamily: "'Outfit', sans-serif", fontSize: 12, color: "rgba(var(--text-rgb),0.6)", background: "none", border: "none", cursor: "pointer" }}
        >
          ← Retour
        </button>
      )}
      <GlassPanel style={{ padding: 26, width: "100%", maxWidth: 360 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 20, background: "rgba(255,255,255,0.06)", borderRadius: 999, padding: 4 }}>
          {["login", "register"].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(""); }}
              style={{
                flex: 1, fontFamily: "'Outfit', sans-serif", fontSize: 12.5, fontWeight: 600, padding: "9px 0",
                borderRadius: 999, border: "none", cursor: "pointer",
                color: mode === m ? "#170f1a" : "rgba(var(--text-rgb),0.7)",
                background: mode === m ? "linear-gradient(160deg, #f0dcae, #cda45e)" : "transparent",
              }}
            >
              {m === "login" ? "Connexion" : "Créer un compte"}
            </button>
          ))}
        </div>

        <div onKeyDown={handleKeyDown} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {mode === "register" && (
            <>
              <Field label="Prénom" value={fields.name} onChange={update("name")} placeholder="Léa" />
              <Field label="Date de naissance" value={fields.birthdate} onChange={update("birthdate")} type="date" />

              <div>
                <label style={labelStyle}>Je suis</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {GENDER_OPTIONS.map((o) => (
                    <ChoiceChip key={o.v} active={fields.gender === o.v} onClick={() => setFields((f) => ({ ...f, gender: o.v }))} label={o.l} />
                  ))}
                </div>
              </div>

              <div>
                <label style={labelStyle}>Je souhaite voir</label>
                <LookingForPicker value={fields.lookingFor} onToggle={toggleLookingFor} onSetAll={(v) => setFields((f) => ({ ...f, lookingFor: v }))} />
              </div>
            </>
          )}
          <Field label={mode === "register" ? "Email (Gmail, Outlook ou iCloud)" : "Email"} value={fields.email} onChange={update("email")} placeholder="vous@gmail.com" />
          <Field label="Mot de passe" value={fields.password} onChange={update("password")} placeholder="••••••••" type="password" />
          {mode === "register" && (
            <>
              <Field label="Apéro préféré" value={fields.aperitif} onChange={update("aperitif")} placeholder="Spritz maison" />
              <Field label="Code de parrainage (optionnel)" value={fields.referralCode} onChange={update("referralCode")} placeholder="ABCD1234" />
              <div>
                <label style={labelStyle}>Bio</label>
                <textarea
                  value={fields.bio}
                  onChange={update("bio")}
                  placeholder="Joueur·euse occasionnel·le, toujours partant·e pour un verre."
                  rows={3}
                  style={{ ...inputStyle, resize: "none", fontFamily: "'Outfit', sans-serif" }}
                />
              </div>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={fields.acceptTerms}
                  onChange={(e) => setFields((f) => ({ ...f, acceptTerms: e.target.checked }))}
                  style={{ marginTop: 3 }}
                />
                <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "rgba(var(--text-rgb),0.7)" }}>
                  Je certifie avoir 18 ans ou plus et j'accepte les{" "}
                  <span onClick={(e) => { e.preventDefault(); setShowLegal(true); }} style={{ color: "var(--accent)", textDecoration: "underline", cursor: "pointer" }}>
                    CGU et la politique de confidentialité
                  </span>
                  .
                </span>
              </label>
            </>
          )}

          {error && <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12.5, color: "#e08a8a" }}>{error}</div>}
          {info && <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12.5, color: "#a8d8a8" }}>{info}</div>}

          <button
            type="button"
            className="em-btn"
            onClick={submit}
            disabled={loading}
            style={{
              marginTop: 6, fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 600, color: "#170f1a",
              background: "linear-gradient(160deg, #f0dcae, #cda45e)", border: "none", borderRadius: 999,
              padding: "12px 0", cursor: loading ? "default" : "pointer", opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Un instant…" : mode === "login" ? "Se connecter 🥂" : "Créer mon compte ♟"}
          </button>
        </div>
      </GlassPanel>
      {showLegal && <LegalModal onClose={() => setShowLegal(false)} />}
    </div>
  );
}

// ---------- Profile ----------
function AdminScreen() {
  const [stats, setStats] = useState(null);
  const [reports, setReports] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("stats");

  useEffect(() => {
    let active = true;
    (async () => {
      const [{ data: statsData, error: statsErr }, { data: reportsData, error: reportsErr }] = await Promise.all([
        supabase.rpc("admin_get_stats"),
        supabase.rpc("admin_get_reports"),
      ]);
      if (!active) return;
      if (statsErr || reportsErr) { setError((statsErr || reportsErr).message); return; }
      setStats(statsData);
      setReports(reportsData || []);
    })();
    return () => { active = false; };
  }, []);

  if (error) {
    return (
      <GlassPanel style={{ padding: 24, textAlign: "center" }}>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: "#e08a8a" }}>{error}</p>
      </GlassPanel>
    );
  }

  const STAT_LABELS = {
    total_profiles: "Profils", premium_profiles: "Premium", total_matches: "Matchs",
    total_messages: "Messages", total_games_played: "Parties jouées", total_reports: "Signalements",
    reports_last_7_days: "Signalements (7j)", new_profiles_last_7_days: "Nouveaux profils (7j)",
    total_referrals_confirmed: "Parrainages confirmés",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 6, background: "rgba(255,255,255,0.06)", borderRadius: 999, padding: 4 }}>
        {["stats", "reports"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, fontFamily: "'Outfit', sans-serif", fontSize: 12.5, fontWeight: 600, padding: "9px 0",
              borderRadius: 999, border: "none", cursor: "pointer",
              color: tab === t ? "#170f1a" : "rgba(var(--text-rgb),0.7)",
              background: tab === t ? "linear-gradient(160deg, #f0dcae, #cda45e)" : "transparent",
            }}
          >
            {t === "stats" ? "Statistiques" : `Signalements${reports ? ` (${reports.length})` : ""}`}
          </button>
        ))}
      </div>

      {tab === "stats" && (
        stats ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {Object.entries(STAT_LABELS).map(([key, label]) => (
              <GlassPanel key={key} style={{ padding: 16 }}>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, color: "rgb(var(--text-rgb))" }}>{stats[key] ?? "—"}</div>
                <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "rgba(var(--text-rgb),0.55)" }}>{label}</div>
              </GlassPanel>
            ))}
          </div>
        ) : (
          <GlassPanel style={{ padding: 20, textAlign: "center" }}>
            <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: "rgba(var(--text-rgb),0.6)" }}>Chargement…</p>
          </GlassPanel>
        )
      )}

      {tab === "reports" && (
        reports && reports.length === 0 ? (
          <GlassPanel style={{ padding: 20, textAlign: "center" }}>
            <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: "rgba(var(--text-rgb),0.6)" }}>Aucun signalement.</p>
          </GlassPanel>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {(reports || []).map((r) => (
              <GlassPanel key={r.id} style={{ padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12.5, fontWeight: 600, color: "var(--accent)" }}>{r.reason}</span>
                  <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 10.5, color: "rgba(var(--text-rgb),0.45)" }}>
                    {new Date(r.created_at).toLocaleDateString("fr-FR")}
                  </span>
                </div>
                <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: "rgba(var(--text-rgb),0.75)", margin: "0 0 4px" }}>
                  <b>{r.reporter_name || "?"}</b> a signalé <b>{r.reported_name || "?"}</b>
                </p>
                {r.message_text && (
                  <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "rgba(var(--text-rgb),0.6)", fontStyle: "italic", margin: "0 0 4px" }}>
                    "{r.message_text}"
                  </p>
                )}
                {r.details && (
                  <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "rgba(var(--text-rgb),0.6)", margin: 0 }}>{r.details}</p>
                )}
              </GlassPanel>
            ))}
          </div>
        )
      )}
    </div>
  );
}

function ProfileScreen({ profile, onSave, onLogout, onDeleteAccount, onRefreshProfile, fireToast }) {
  const [form, setForm] = useState({
    name: profile.name, bio: profile.bio, aperitif: profile.aperitif,
    gender: profile.gender, lookingFor: profile.looking_for || [],
    orientations: profile.orientations || [], showOrientation: !!profile.show_orientation,
    job: profile.job || "", height: profile.height_cm ? String(profile.height_cm) : "",
    goal: profile.relationship_goal || "", drinks: profile.drinks || "", smokes: profile.smokes || "", kids: profile.kids || "",
    interests: profile.interests || [], prompts: Array.isArray(profile.prompts) ? profile.prompts : [],
    level: profile.chess_level || "", favPiece: profile.fav_piece || "",
  });
  const [showPreview, setShowPreview] = useState(false);
  const setField = (key, value) => { setForm((f) => ({ ...f, [key]: value })); setSaved(false); };
  const toggleSingle = (key, value) => setField(key, form[key] === value ? "" : value);
  const toggleInterest = (value) => {
    if (form.interests.includes(value)) setField("interests", form.interests.filter((v) => v !== value));
    else if (form.interests.length < 6) setField("interests", [...form.interests, value]);
    else fireToast?.("6 centres d'intérêt maximum.");
  };
  const addPrompt = () => {
    if (form.prompts.length >= 3) return;
    const used = form.prompts.map((p) => p.q);
    const q = PROMPT_QUESTIONS.find((x) => !used.includes(x)) || PROMPT_QUESTIONS[0];
    setField("prompts", [...form.prompts, { q, a: "" }]);
  };
  const updatePrompt = (i, patch) => setField("prompts", form.prompts.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const removePrompt = (i) => setField("prompts", form.prompts.filter((_, j) => j !== i));
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [notifStatus, setNotifStatus] = useState(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showLegal, setShowLegal] = useState(false);
  const [history, setHistory] = useState(null);
  const [historyNames, setHistoryNames] = useState({});
  const [photos, setPhotos] = useState(null);
  const update = (key) => (e) => { setForm((f) => ({ ...f, [key]: e.target.value })); setSaved(false); };
  const toggleLookingFor = (value) =>
    setForm((f) => ({
      ...f,
      lookingFor: f.lookingFor.includes(value) ? f.lookingFor.filter((v) => v !== value) : [...f.lookingFor, value],
    }));

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("game_history")
        .select("*")
        .or(`winner_id.eq.${profile.id},loser_id.eq.${profile.id}`)
        .order("created_at", { ascending: false })
        .limit(profile.is_premium ? 100 : 5);
      if (!active) return;
      setHistory(data || []);
      const otherIds = [...new Set((data || []).map((h) => (h.winner_id === profile.id ? h.loser_id : h.winner_id)))];
      if (otherIds.length) {
        const { data: others } = await supabase.from("public_profiles").select("id, name").in("id", otherIds);
        const map = {};
        (others || []).forEach((o) => { map[o.id] = o.name; });
        if (active) setHistoryNames(map);
      }
    })();
    return () => { active = false; };
  }, [profile.id, profile.is_premium]);

  const stats = useMemo(() => {
    if (!history || history.length === 0) return null;
    const wins = history.filter((h) => h.winner_id === profile.id).length;
    const winRate = Math.round((wins / history.length) * 100);
    let streak = 0;
    for (const h of history) {
      if (h.winner_id === profile.id) streak++;
      else break;
    }
    return { wins, total: history.length, winRate, streak };
  }, [history, profile.id]);

  const setBoardTheme = (key) => {
    if (!profile.is_premium && (key === "nuit" || key === "bordeaux")) {
      fireToast?.("🔒 Thème réservé aux comptes Premium");
      return;
    }
    onSave({ board_theme: key });
  };

  const [referrals, setReferrals] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    supabase
      .from("referrals")
      .select("*")
      .eq("referrer_id", profile.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => { if (active) setReferrals(data || []); });
    return () => { active = false; };
  }, [profile.id]);

  const referralLink = typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}?ref=${profile.referral_code || ""}` : "";
  const copyReferralLink = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      fireToast?.("Impossible de copier — copiez le lien manuellement.");
    }
  };

  const EPOCH = new Date(0).getTime();
  const now = Date.now();
  const validReferrals = (referrals || []).filter((r) => r.referred_id);
  const confirmedReferrals = validReferrals.filter(
    (r) => r.confirmed_at && new Date(r.confirmed_at).getTime() > EPOCH && now - new Date(r.confirmed_at).getTime() >= 48 * 3600 * 1000
  ).length;
  const inCooldown = validReferrals.filter(
    (r) => r.confirmed_at && new Date(r.confirmed_at).getTime() > EPOCH && now - new Date(r.confirmed_at).getTime() < 48 * 3600 * 1000
  ).length;
  const pendingReferrals = validReferrals.filter((r) => !r.confirmed_at).length;

  const [linkOpens, setLinkOpens] = useState(null);
  useEffect(() => {
    let active = true;
    supabase
      .from("link_opens")
      .select("*", { count: "exact", head: true })
      .eq("referrer_id", profile.id)
      .gt("created_at", profile.link_reward_at || "1970-01-01T00:00:00Z")
      .then(({ count }) => { if (active) setLinkOpens(count || 0); });
    return () => { active = false; };
  }, [profile.id, profile.link_reward_at]);
  // Une récompense à la fois : le compteur ne compte que les ouvertures
  // depuis la dernière récompense, et il est en pause pendant un Premium actif.
  const premiumActive = profile.is_premium && (!profile.premium_until || new Date(profile.premium_until).getTime() > Date.now());
  const linkOpenProgress = Math.min(linkOpens || 0, 5);

  const [sharing, setSharing] = useState(false);
  const handleShare = async () => {
    setSharing(true);
    const shareData = {
      title: "Échec & Match",
      text: "Rejoins-moi sur Échec & Match — rencontre, apéro et échecs 🥂♟️",
      url: referralLink,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(referralLink);
        fireToast?.("Lien copié — collez-le où vous voulez pour partager !");
      }
      // Rien n'est comptabilisé ici : seule l'ouverture réelle du lien par
      // quelqu'un d'autre (voir record_link_open côté serveur) compte pour
      // la récompense — cliquer "Partager" chez soi ne prouve rien.
    } catch {
      // L'utilisateur a annulé le partage (navigator.share rejeté).
    } finally {
      setSharing(false);
    }
  };

  const save = async () => {
    const heightNum = parseInt(form.height, 10);
    if (form.height && (!heightNum || heightNum < 120 || heightNum > 230)) {
      fireToast?.("Taille invalide (entre 120 et 230 cm).");
      return;
    }
    const ok = await onSave({
      name: form.name, bio: form.bio, aperitif: form.aperitif,
      gender: form.gender, looking_for: form.lookingFor,
      orientations: form.orientations, show_orientation: form.orientations.length > 0 && form.showOrientation,
      job: form.job.trim() || null,
      height_cm: form.height ? heightNum : null,
      relationship_goal: form.goal || null,
      drinks: form.drinks || null,
      smokes: form.smokes || null,
      kids: form.kids || null,
      interests: form.interests,
      prompts: form.prompts.map((p) => ({ q: p.q, a: p.a.trim() })).filter((p) => p.a),
      chess_level: form.level || null,
      fav_piece: form.favPiece || null,
    });
    if (ok !== false) setSaved(true);
  };

  const shareLocation = () => {
    if (!navigator.geolocation) { setLocationError("Géolocalisation non disponible sur cet appareil."); return; }
    setLocationError("");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setLocating(false);
        await onSave({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => { setLocating(false); setLocationError("Position refusée ou indisponible."); },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  };

  const enableNotifications = async () => {
    if (typeof Notification === "undefined") return;
    const res = await Notification.requestPermission();
    setNotifStatus(res);
  };

  const loadPhotos = useCallback(async () => {
    const { data } = await supabase.from("profile_photos").select("*").eq("profile_id", profile.id).order("position", { ascending: true });
    setPhotos(data || []);
  }, [profile.id]);

  useEffect(() => { loadPhotos(); }, [loadPhotos]);

  const onPhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setPhotoError("Choisissez une image."); return; }
    if (file.size > 5 * 1024 * 1024) { setPhotoError("Image trop lourde (5 Mo max)."); return; }
    if ((photos || []).length >= 6) { setPhotoError("Maximum 6 photos."); return; }
    setPhotoError("");
    setUploading(true);
    const res = await uploadProfilePhoto(profile.id, file);
    setUploading(false);
    e.target.value = "";
    if (!res.ok) { setPhotoError(res.error); return; }
    await loadPhotos();
    await onRefreshProfile?.();
  };

  const removePhoto = async (photo) => {
    const wasCover = profile.photo_url === photo.url;
    await deleteProfilePhoto(photo.id, profile.id, wasCover, photos || []);
    await loadPhotos();
    await onRefreshProfile?.();
  };

  const setCoverPhoto = async (photo) => {
    await onSave({ photo_url: photo.url });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <GlassPanel style={{ padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <div style={{ position: "relative" }}>
            <Avatar initials={profile.initials} hue={profile.hue} photoUrl={profile.photo_url} size={56} />
            <label
              style={{
                position: "absolute", bottom: -2, right: -2, width: 22, height: 22, borderRadius: "50%",
                background: "linear-gradient(160deg, #f0dcae, #cda45e)", display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 11, cursor: "pointer", border: "2px solid #170f1a",
              }}
            >
              📷
              <input type="file" accept="image/*" onChange={onPhotoChange} style={{ display: "none" }} />
            </label>
          </div>
          <div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: "rgb(var(--text-rgb))" }}>{profile.name}</div>
            <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: "rgba(var(--text-rgb),0.6)" }}>{profile.email}</div>
            <div style={{ marginTop: 4 }}><EloBadge elo={profile.elo} /></div>
          </div>
        </div>
        {uploading && <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "rgba(var(--text-rgb),0.6)" }}>Envoi de la photo…</p>}
        {photoError && <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "#e08a8a" }}>{photoError}</p>}

        <label style={labelStyle}>Mes photos ({(photos || []).length}/6)</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 16 }}>
          {(photos || []).map((p) => (
            <div key={p.id} style={{ position: "relative", aspectRatio: "1", borderRadius: 12, overflow: "hidden", border: profile.photo_url === p.url ? "2px solid #cda45e" : "1px solid rgba(255,255,255,0.14)" }}>
              <img src={p.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              {profile.photo_url !== p.url && (
                <button
                  onClick={() => setCoverPhoto(p)}
                  title="Définir comme photo principale"
                  style={{ position: "absolute", bottom: 3, left: 3, fontSize: 10, background: "rgba(0,0,0,0.55)", color: "rgb(var(--text-rgb))", border: "none", borderRadius: 999, padding: "2px 6px", cursor: "pointer" }}
                >
                  ⭐
                </button>
              )}
              <button
                onClick={() => removePhoto(p)}
                aria-label="Supprimer"
                style={{ position: "absolute", top: 3, right: 3, width: 18, height: 18, fontSize: 10, background: "rgba(0,0,0,0.55)", color: "rgb(var(--text-rgb))", border: "none", borderRadius: "50%", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>
          ))}
          {(photos || []).length < 6 && (
            <label style={{ aspectRatio: "1", borderRadius: 12, border: "2px dashed rgba(255,255,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: "rgba(var(--text-rgb),0.5)", cursor: "pointer" }}>
              +
              <input type="file" accept="image/*" onChange={onPhotoChange} style={{ display: "none" }} />
            </label>
          )}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            onClick={shareLocation}
            disabled={locating}
            style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "rgb(var(--text-rgb))", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 999, padding: "6px 12px", cursor: locating ? "default" : "pointer" }}
          >
            {locating ? "Localisation…" : profile.lat ? "📍 Position partagée ✓" : "📍 Partager ma position"}
          </button>
          {notifStatus !== "unsupported" && notifStatus !== "granted" && (
            <button
              type="button"
              onClick={enableNotifications}
              style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "rgb(var(--text-rgb))", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 999, padding: "6px 12px", cursor: "pointer" }}
            >
              🔔 Activer les notifications
            </button>
          )}
          {notifStatus === "granted" && (
            <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "rgba(var(--text-rgb),0.5)", alignSelf: "center" }}>🔔 Notifications activées</span>
          )}
        </div>
        {locationError && <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "#e08a8a", marginTop: -8 }}>{locationError}</p>}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {(() => {
            const checks = [
              (photos || []).length >= 2, !!form.bio.trim(), !!form.aperitif.trim(), !!form.job.trim(), !!form.goal,
              form.prompts.filter((p) => p.a.trim()).length >= 1, form.prompts.filter((p) => p.a.trim()).length >= 3,
              form.interests.length >= 3, !!(form.drinks && form.smokes), !!form.kids, !!form.level, !!form.favPiece,
            ];
            const pct = Math.round((checks.filter(Boolean).length / checks.length) * 100);
            return (
              <div style={{ padding: 14, borderRadius: 14, background: "rgba(205,164,94,0.1)", border: "1px solid rgba(205,164,94,0.3)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12.5, fontWeight: 600, color: "rgb(var(--text-rgb))" }}>
                    Profil complété à {pct}%
                  </span>
                  <button type="button" className="em-btn" onClick={() => setShowPreview(true)} style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, fontWeight: 600, color: "#170f1a", background: "linear-gradient(160deg, #f0dcae, #cda45e)", border: "none", borderRadius: 999, padding: "6px 12px", cursor: "pointer" }}>
                    👁 Aperçu
                  </button>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.1)", overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(90deg, #f0dcae, #cda45e)", transition: "width 0.3s ease" }} />
                </div>
                {pct < 100 && (
                  <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "rgba(var(--text-rgb),0.55)", margin: "8px 0 0" }}>
                    Un profil complet reçoit bien plus de « Santé ! ». Ajoutez des questions et vos centres d'intérêt.
                  </p>
                )}
              </div>
            );
          })()}

          <SectionTitle icon="👤" title="L'essentiel" />
          <Field label="Prénom" value={form.name} onChange={update("name")} />
          <div>
            <label style={labelStyle}>Âge</label>
            <div style={{ ...inputStyle, opacity: 0.6, cursor: "default" }}>
              {calcAge(profile.birthdate) ?? profile.age} ans
            </div>
            <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 10.5, color: "rgba(var(--text-rgb),0.4)", margin: "4px 0 0" }}>
              Calculé automatiquement depuis votre date de naissance.
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
            <Field label="Métier" value={form.job} onChange={update("job")} placeholder="Ex. plieur, prof, infirmière…" />
            <Field label="Taille (cm)" value={form.height} onChange={update("height")} placeholder="175" type="number" />
          </div>

          <div>
            <label style={labelStyle}>Je suis</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {GENDER_OPTIONS.map((o) => (
                <ChoiceChip key={o.v} active={form.gender === o.v} onClick={() => setField("gender", o.v)} label={o.l} />
              ))}
            </div>
          </div>
          <div>
            <label style={labelStyle}>Je souhaite voir</label>
            <LookingForPicker value={form.lookingFor} onToggle={toggleLookingFor} onSetAll={(v) => setField("lookingFor", v)} />
          </div>
          <div>
            <label style={labelStyle}>Mon orientation (facultatif, 3 max)</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {Object.entries(ORIENTATION_LABELS).map(([v, l]) => (
                <ChoiceChip
                  key={v}
                  label={l}
                  active={form.orientations.includes(v)}
                  onClick={() => {
                    if (form.orientations.includes(v)) setField("orientations", form.orientations.filter((x) => x !== v));
                    else if (form.orientations.length < 3) setField("orientations", [...form.orientations, v]);
                    else fireToast?.("3 choix maximum.");
                  }}
                />
              ))}
            </div>
            {form.orientations.length > 0 && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, cursor: "pointer", fontFamily: "'Outfit', sans-serif", fontSize: 12.5, color: "rgb(var(--text-rgb))" }}>
                <input type="checkbox" checked={form.showOrientation} onChange={(e) => setField("showOrientation", e.target.checked)} style={{ accentColor: "#cda45e", width: 16, height: 16 }} />
                Afficher mon orientation sur mon profil
              </label>
            )}
            <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 10.5, lineHeight: 1.5, color: "rgba(var(--text-rgb),0.5)", margin: "6px 0 0" }}>
              🔒 Masquée par défaut : personne ne la voit tant que vous ne cochez pas la case. Elle ne sert pas à choisir les profils qu'on vous propose.
            </p>
          </div>
          <div>
            <label style={labelStyle}>Ce que je cherche ici</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {Object.entries(GOAL_LABELS).map(([v, l]) => (
                <ChoiceChip key={v} active={form.goal === v} onClick={() => toggleSingle("goal", v)} label={l} />
              ))}
            </div>
          </div>

          <SectionTitle icon="✍️" title="À propos de moi" />
          <div>
            <label style={labelStyle}>Bio ({form.bio.length}/500)</label>
            <textarea value={form.bio} onChange={update("bio")} maxLength={500} rows={3} placeholder="Quelques mots pour briser la glace…" style={{ ...inputStyle, resize: "none", fontFamily: "'Outfit', sans-serif" }} />
          </div>
          <Field label="Apéro préféré" value={form.aperitif} onChange={update("aperitif")} placeholder="Spritz, pastis, jus de pomme…" />

          <SectionTitle icon="💬" title={`Mes questions (${form.prompts.length}/3)`} hint="Choisissez une question et répondez-y : c'est ce qui fait démarrer les conversations." />
          {form.prompts.map((p, i) => (
            <div key={i} style={{ padding: 12, borderRadius: 14, background: "var(--panel-a)", border: "1px solid var(--panel-border)", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select value={p.q} onChange={(e) => updatePrompt(i, { q: e.target.value })} style={{ ...inputStyle, flex: 1, fontWeight: 600, fontSize: 12.5 }}>
                  {(PROMPT_QUESTIONS.includes(p.q) ? PROMPT_QUESTIONS : [p.q, ...PROMPT_QUESTIONS]).filter((q) => q === p.q || !form.prompts.some((o) => o.q === q)).map((q) => (
                    <option key={q} value={q} style={{ color: "#170f1a" }}>{q}</option>
                  ))}
                </select>
                <button type="button" onClick={() => removePrompt(i)} aria-label="Retirer la question" style={{ width: 30, height: 30, flexShrink: 0, borderRadius: "50%", border: "1px solid var(--panel-border)", background: "transparent", color: "rgb(var(--text-rgb))", cursor: "pointer" }}>✕</button>
              </div>
              <textarea value={p.a} onChange={(e) => updatePrompt(i, { a: e.target.value })} maxLength={150} rows={2} placeholder="Votre réponse…" style={{ ...inputStyle, resize: "none", fontFamily: "'Outfit', sans-serif" }} />
              <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 10.5, color: "rgba(var(--text-rgb),0.4)", alignSelf: "flex-end" }}>{p.a.length}/150</span>
            </div>
          ))}
          {form.prompts.length < 3 && (
            <button type="button" onClick={addPrompt} style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12.5, fontWeight: 600, color: "rgb(var(--text-rgb))", background: "transparent", border: "2px dashed rgba(205,164,94,0.45)", borderRadius: 14, padding: "12px 0", cursor: "pointer" }}>
              + Ajouter une question
            </button>
          )}

          <SectionTitle icon="✨" title={`Centres d'intérêt (${form.interests.length}/6)`} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {INTERESTS.map((it) => (
              <ChoiceChip key={it} active={form.interests.includes(it)} onClick={() => toggleInterest(it)} label={it} />
            ))}
          </div>

          <SectionTitle icon="🌿" title="Mode de vie" />
          {[
            { key: "drinks", label: "Alcool", labels: DRINKS_LABELS },
            { key: "smokes", label: "Tabac", labels: SMOKES_LABELS },
            { key: "kids", label: "Enfants", labels: KIDS_LABELS },
          ].map(({ key, label, labels }) => (
            <div key={key}>
              <label style={labelStyle}>{label}</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {Object.entries(labels).map(([v, l]) => (
                  <ChoiceChip key={v} active={form[key] === v} onClick={() => toggleSingle(key, v)} label={l} />
                ))}
              </div>
            </div>
          ))}

          <SectionTitle icon="♟️" title="Côté échiquier" hint="Aucun niveau requis : beaucoup viennent ici pour découvrir le jeu." />
          <div>
            <label style={labelStyle}>Mon niveau</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {Object.entries(LEVEL_LABELS).map(([v, l]) => (
                <ChoiceChip key={v} active={form.level === v} onClick={() => toggleSingle("level", v)} label={l} />
              ))}
            </div>
          </div>
          <div>
            <label style={labelStyle}>Si j'étais une pièce, je serais…</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {Object.entries(PIECE_LABELS).map(([v, l]) => (
                <ChoiceChip key={v} active={form.favPiece === v} onClick={() => toggleSingle("favPiece", v)} label={l} />
              ))}
            </div>
          </div>

          <button
            type="button"
            className="em-btn"
            onClick={save}
            style={{
              position: "sticky", bottom: 12, zIndex: 2,
              fontFamily: "'Outfit', sans-serif", fontSize: 13, fontWeight: 600, color: "#170f1a",
              background: "linear-gradient(160deg, #f0dcae, #cda45e)", border: "none", borderRadius: 999,
              padding: "12px 0", cursor: "pointer", boxShadow: "0 6px 20px rgba(0,0,0,0.3)",
            }}
          >
            {saved ? "Enregistré ✓" : "Enregistrer les modifications"}
          </button>
          {showPreview && (
            <ProfileViewModal
              other={{
                ...profile,
                name: form.name, bio: form.bio, aperitif: form.aperitif, gender: form.gender,
                orientations: form.showOrientation ? form.orientations : [],
                age: calcAge(profile.birthdate) ?? profile.age,
                job: form.job, height_cm: parseInt(form.height, 10) || null, relationship_goal: form.goal || null,
                drinks: form.drinks || null, smokes: form.smokes || null, kids: form.kids || null,
                interests: form.interests, prompts: form.prompts.filter((p) => p.a.trim()),
                chess_level: form.level || null, fav_piece: form.favPiece || null, distance_km: null,
              }}
              onClose={() => setShowPreview(false)}
              title="Aperçu : voici ce que les autres voient"
            />
          )}
        </div>
      </GlassPanel>

      <GlassPanel style={{ padding: 20, border: profile.is_premium ? "1px solid rgba(205,164,94,0.5)" : undefined }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, color: "var(--accent)" }}>
            {profile.is_premium ? "⭐ Compte Premium" : "Compte gratuit"}
          </div>
          <button
            onClick={onRefreshProfile}
            style={{ fontFamily: "'Outfit', sans-serif", fontSize: 10.5, color: "rgba(var(--text-rgb),0.5)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
          >
            Actualiser
          </button>
        </div>
        {profile.is_premium && profile.premium_until && (
          <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "rgba(var(--text-rgb),0.5)", margin: "0 0 8px" }}>
            Valable jusqu'au {new Date(profile.premium_until).toLocaleDateString("fr-FR")}
          </p>
        )}
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: "rgba(var(--text-rgb),0.65)", margin: "0 0 14px" }}>
          {profile.is_premium
            ? "Swipes illimités, Super Trinque, Rewind, qui vous a trinqué, thèmes exclusifs et historique complet. Continuez à parrainer ou partager pour prolonger."
            : "Deux façons de débloquer le Premium : parrainez (Gmail, Outlook ou iCloud) 2 personnes qui confirment leur email — 1 mois offert, une seule fois — ou faites ouvrir votre lien par 5 personnes différentes pour 2 semaines, répétable à volonté."}
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          {[0, 1].map((i) => (
            <div key={i} style={{ flex: 1, height: 6, borderRadius: 999, background: i < Math.min(confirmedReferrals, 2) ? "linear-gradient(90deg, #f0dcae, #cda45e)" : "rgba(255,255,255,0.1)" }} />
          ))}
          <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "rgba(var(--text-rgb),0.6)", whiteSpace: "nowrap" }}>
            {profile.referral_rewards_granted ? "Récompense obtenue ✓" : `${confirmedReferrals}/2 confirmés`}
          </span>
        </div>
        {!profile.referral_rewards_granted && pendingReferrals > 0 && (
          <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "rgba(var(--text-rgb),0.5)", margin: "0 0 6px" }}>
            + {pendingReferrals} en attente de confirmation d'email
          </p>
        )}
        {!profile.referral_rewards_granted && inCooldown > 0 && (
          <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "rgba(var(--text-rgb),0.5)", margin: "0 0 12px" }}>
            + {inCooldown} confirmé{inCooldown > 1 ? "s" : ""}, comptabilisé{inCooldown > 1 ? "s" : ""} sous 48h
          </p>
        )}

        <label style={labelStyle}>Votre lien de parrainage</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input readOnly value={referralLink} style={{ ...inputStyle, fontSize: 11.5 }} onFocus={(e) => e.target.select()} />
          <button
            className="em-btn"
            onClick={copyReferralLink}
            style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, fontWeight: 600, color: "#170f1a", background: "linear-gradient(160deg, #f0dcae, #cda45e)", border: "none", borderRadius: 12, padding: "0 16px", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            {copied ? "Copié ✓" : "Copier"}
          </button>
        </div>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 10.5, color: "rgba(var(--text-rgb),0.4)", marginTop: 8, marginBottom: 0 }}>
          Ou partagez votre code : <b style={{ color: "rgba(var(--text-rgb),0.7)" }}>{profile.referral_code}</b>
        </p>

        <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "16px 0" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          {(() => {
            const inCycle = linkOpenProgress;
            return [...Array(5)].map((_, i) => (
              <div key={i} style={{ flex: 1, height: 6, borderRadius: 999, background: i < inCycle ? "linear-gradient(90deg, #f0dcae, #cda45e)" : "rgba(255,255,255,0.1)" }} />
            ));
          })()}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "rgba(var(--text-rgb),0.6)" }}>
            {premiumActive
              ? "Premium actif — le compteur reprendra à la fin de votre Premium"
              : `${linkOpenProgress}/5 ouvertures de votre lien — 5 = 2 semaines de Premium`}
          </span>
          <button
            className="em-btn"
            onClick={handleShare}
            disabled={sharing}
            style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, fontWeight: 600, color: "rgb(var(--text-rgb))", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999, padding: "7px 14px", cursor: sharing ? "default" : "pointer", whiteSpace: "nowrap" }}
          >
            {sharing ? "…" : "📤 Partager"}
          </button>
        </div>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 10, color: "rgba(var(--text-rgb),0.4)", marginTop: 6, marginBottom: 0 }}>
          Ne compte que si quelqu'un d'autre ouvre réellement votre lien — cliquer sur "Partager" seul chez vous ne suffit pas.
        </p>
      </GlassPanel>

      {stats && (
        <GlassPanel style={{ padding: 20 }}>
          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "rgba(var(--text-rgb),0.5)", marginBottom: 10 }}>STATISTIQUES</div>
          <div style={{ display: "flex", gap: 18 }}>
            <div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, color: "rgb(var(--text-rgb))" }}>{stats.winRate}%</div>
              <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 10.5, color: "rgba(var(--text-rgb),0.55)" }}>Victoires</div>
            </div>
            <div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, color: "rgb(var(--text-rgb))" }}>{stats.wins}/{stats.total}</div>
              <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 10.5, color: "rgba(var(--text-rgb),0.55)" }}>Score</div>
            </div>
            <div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, color: "rgb(var(--text-rgb))" }}>{stats.streak}</div>
              <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 10.5, color: "rgba(var(--text-rgb),0.55)" }}>Série en cours</div>
            </div>
          </div>
          {!profile.is_premium && (
            <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 10.5, color: "rgba(var(--text-rgb),0.4)", marginTop: 10, marginBottom: 0 }}>
              Calculé sur vos 5 dernières parties — Premium débloque l'historique complet.
            </p>
          )}
        </GlassPanel>
      )}

      <GlassPanel style={{ padding: 20 }}>
        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "rgba(var(--text-rgb),0.5)", marginBottom: 10 }}>THÈME DU PLATEAU</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {Object.entries(BOARD_THEMES).map(([key, t]) => {
            const locked = !profile.is_premium && (key === "nuit" || key === "bordeaux");
            return (
              <button
                key={key}
                onClick={() => setBoardTheme(key)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, fontFamily: "'Outfit', sans-serif", fontSize: 11.5,
                  color: "rgb(var(--text-rgb))", background: profile.board_theme === key ? "rgba(205,164,94,0.2)" : "rgba(255,255,255,0.06)",
                  border: profile.board_theme === key ? "1px solid rgba(205,164,94,0.5)" : "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 999, padding: "6px 12px", cursor: "pointer", opacity: locked ? 0.6 : 1,
                }}
              >
                <span style={{ display: "inline-grid", gridTemplateColumns: "1fr 1fr", width: 16, height: 16, borderRadius: 4, overflow: "hidden" }}>
                  <span style={{ background: t.dark[0] }} />
                  <span style={{ background: t.light[0] }} />
                  <span style={{ background: t.light[0] }} />
                  <span style={{ background: t.dark[0] }} />
                </span>
                {t.label}
                {locked && "🔒"}
              </button>
            );
          })}
        </div>
      </GlassPanel>

      {history && history.length > 0 && (
        <GlassPanel style={{ padding: 20 }}>
          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "rgba(var(--text-rgb),0.5)", marginBottom: 10 }}>
            HISTORIQUE DES PARTIES {!profile.is_premium && "(5 dernières)"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {history.map((h) => {
              const won = h.winner_id === profile.id;
              const opponentName = historyNames[won ? h.loser_id : h.winner_id] || "un match";
              return (
                <div key={h.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "'Outfit', sans-serif", fontSize: 12.5 }}>
                  <span style={{ color: "rgba(var(--text-rgb),0.8)" }}>
                    {won ? "♟ Victoire contre " : "✕ Défaite contre "}{opponentName}
                  </span>
                  <span style={{ color: won ? "#7fd88f" : "#e08a8a", fontWeight: 600 }}>
                    {won ? `+${h.elo_delta}` : `-${h.elo_delta}`}
                  </span>
                </div>
              );
            })}
          </div>
        </GlassPanel>
      )}

      <button
        onClick={() => setShowLegal(true)}
        style={{
          fontFamily: "'Outfit', sans-serif", fontSize: 12, color: "rgba(var(--text-rgb),0.6)", background: "none",
          border: "none", textDecoration: "underline", cursor: "pointer", padding: 0,
        }}
      >
        CGU &amp; politique de confidentialité
      </button>

      <button
        className="em-btn"
        onClick={onLogout}
        style={{
          fontFamily: "'Outfit', sans-serif", fontSize: 12.5, fontWeight: 600, color: "#e08a8a",
          background: "rgba(224,138,138,0.1)", border: "1px solid rgba(224,138,138,0.3)", borderRadius: 999,
          padding: "10px 0", cursor: "pointer",
        }}
      >
        Se déconnecter
      </button>

      {!confirmDelete ? (
        <button
          onClick={() => setConfirmDelete(true)}
          style={{
            fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "rgba(224,138,138,0.6)", background: "none",
            border: "none", textDecoration: "underline", cursor: "pointer", padding: 0,
          }}
        >
          Supprimer mon compte et mes données
        </button>
      ) : (
        <GlassPanel style={{ padding: 16 }}>
          <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: "rgba(var(--text-rgb),0.75)", margin: "0 0 10px" }}>
            Cette action supprime définitivement votre profil, vos matchs, messages et parties. Confirmer ?
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setConfirmDelete(false)} style={{ flex: 1, fontFamily: "'Outfit', sans-serif", fontSize: 12, color: "rgb(var(--text-rgb))", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999, padding: "8px 0", cursor: "pointer" }}>
              Annuler
            </button>
            <button onClick={onDeleteAccount} style={{ flex: 1, fontFamily: "'Outfit', sans-serif", fontSize: 12, fontWeight: 600, color: "#170f1a", background: "#e08a8a", border: "none", borderRadius: 999, padding: "8px 0", cursor: "pointer" }}>
              Supprimer définitivement
            </button>
          </div>
        </GlassPanel>
      )}

      {showLegal && <LegalModal onClose={() => setShowLegal(false)} />}
    </div>
  );
}
function LikesModal({ profile, onClose, onMatch, fireToast }) {
  const [likes, setLikes] = useState(null);

  useEffect(() => {
    if (!profile.is_premium) { setLikes([]); return; }
    let active = true;
    (async () => {
      const { data: rows } = await supabase
        .from("swipes")
        .select("swiper_id, direction, created_at")
        .eq("swiped_id", profile.id)
        .in("direction", ["right", "superlike"])
        .order("created_at", { ascending: false });
      if (!rows || rows.length === 0) { if (active) setLikes([]); return; }
      const { data: already } = await supabase.from("swipes").select("swiped_id").eq("swiper_id", profile.id);
      const alreadySwiped = new Set((already || []).map((s) => s.swiped_id));
      const pending = rows.filter((r) => !alreadySwiped.has(r.swiper_id));
      const ids = pending.map((r) => r.swiper_id);
      const { data: people } = ids.length ? await supabase.from("public_profiles").select("*").in("id", ids) : { data: [] };
      const merged = pending
        .map((r) => ({ ...r, person: (people || []).find((p) => p.id === r.swiper_id) }))
        .filter((r) => r.person);
      if (active) setLikes(merged);
    })();
    return () => { active = false; };
  }, [profile.id, profile.is_premium]);

  const likeBack = async (person) => {
    await supabase.from("swipes").upsert(
      { swiper_id: profile.id, swiped_id: person.id, direction: "right" },
      { onConflict: "swiper_id,swiped_id" }
    );
    const a = profile.id < person.id ? profile.id : person.id;
    const b = profile.id < person.id ? person.id : profile.id;
    const { data: match } = await supabase.from("matches").select("*").eq("user_a", a).eq("user_b", b).maybeSingle();
    setLikes((prev) => (prev || []).filter((l) => l.person.id !== person.id));
    if (match) { onClose(); onMatch(match, person); }
    else fireToast(`Swipe envoyé à ${person.name}`);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 15, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,6,10,0.65)", backdropFilter: "blur(6px)", padding: 20 }}>
      <GlassPanel className="em-fade-in em-modal" style={{ padding: 22, maxWidth: 360, width: "100%", maxHeight: "75vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: "rgb(var(--text-rgb))", margin: 0 }}>Qui m'a trinqué</h3>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: "50%", width: 30, height: 30, color: "rgb(var(--text-rgb))", cursor: "pointer" }}>✕</button>
        </div>

        {!profile.is_premium ? (
          <div style={{ textAlign: "center", padding: "20px 10px" }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>🔒</div>
            <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: "rgba(var(--text-rgb),0.75)", margin: "0 0 6px" }}>
              Fonctionnalité Premium
            </p>
            <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: "rgba(var(--text-rgb),0.55)" }}>
              Passez Premium pour voir qui vous a déjà trinqué avant même de swiper.
            </p>
          </div>
        ) : likes === null ? (
          <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: "rgba(var(--text-rgb),0.6)", textAlign: "center" }}>Chargement…</p>
        ) : likes.length === 0 ? (
          <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: "rgba(var(--text-rgb),0.6)", textAlign: "center" }}>
            Personne pour l'instant — revenez plus tard 🥂
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {likes.map((l) => (
              <div key={l.person.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar initials={l.person.initials} hue={l.person.hue} photoUrl={l.person.photo_url} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, color: "rgb(var(--text-rgb))" }}>
                    {l.direction === "superlike" ? "⭐ " : ""}{l.person.name}
                  </div>
                  <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "rgba(var(--text-rgb),0.6)" }}>🥂 {l.person.aperitif}</div>
                </div>
                <button
                  className="em-btn"
                  onClick={() => likeBack(l.person)}
                  style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, fontWeight: 600, color: "#170f1a", background: "linear-gradient(160deg, #f0dcae, #cda45e)", border: "none", borderRadius: 999, padding: "7px 12px", cursor: "pointer" }}
                >
                  Trinquer
                </button>
              </div>
            ))}
          </div>
        )}
      </GlassPanel>
    </div>
  );
}

function ProfilesScreen({ profile, onMatch, fireToast, onlineIds = new Set() }) {
  const [viewingFull, setViewingFull] = useState(false);
  const [candidates, setCandidates] = useState(null); // null = loading
  const [index, setIndex] = useState(0);
  const [exit, setExit] = useState(null);
  const [drag, setDrag] = useState({ active: false, x: 0, startX: 0 });
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ ageMin: 18, ageMax: 99, level: "", maxDistance: 0 });
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const PAGE_SIZE = 20;

  const excludeIdsRef = useRef(null);

  const buildExcludeIds = useCallback(async () => {
    const { data: swiped } = await supabase.from("swipes").select("swiped_id").eq("swiper_id", profile.id);
    const { data: blockedByMe } = await supabase.from("blocked_users").select("blocked_id").eq("blocker_id", profile.id);
    const { data: blockedMe } = await supabase.from("blocked_users").select("blocker_id").eq("blocked_id", profile.id);
    return [
      profile.id,
      ...(swiped || []).map((s) => s.swiped_id),
      ...(blockedByMe || []).map((b) => b.blocked_id),
      ...(blockedMe || []).map((b) => b.blocker_id),
    ];
  }, [profile.id]);

  const loadPage = useCallback(async (pageNum, excludeIds) => {
    const { data, error } = await supabase
      .from("public_profiles")
      .select("*")
      .not("id", "in", `(${excludeIds.join(",")})`)
      .range(pageNum * PAGE_SIZE, pageNum * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) return [];
    if ((data || []).length < PAGE_SIZE) setHasMore(false);
    const rows = data || [];
    if (rows.length) {
      const { data: photoRows } = await supabase
        .from("profile_photos")
        .select("profile_id, url, position")
        .in("profile_id", rows.map((r) => r.id))
        .order("position", { ascending: true });
      const byProfile = {};
      (photoRows || []).forEach((p) => { (byProfile[p.profile_id] ||= []).push(p.url); });
      rows.forEach((r) => { r.photos = byProfile[r.id] || (r.photo_url ? [r.photo_url] : []); });
    }
    return rows;
  }, []);

  const loadCandidates = useCallback(async () => {
    setIndex(0);
    setPage(0);
    setHasMore(true);
    setPassedThisSession([]);
    const excludeIds = await buildExcludeIds();
    excludeIdsRef.current = excludeIds;
    const first = await loadPage(0, excludeIds);
    const shuffled = [...first];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setCandidates(shuffled);
  }, [buildExcludeIds, loadPage]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !excludeIdsRef.current) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    const more = await loadPage(nextPage, excludeIdsRef.current);
    setCandidates((prev) => [...(prev || []), ...more]);
    setPage(nextPage);
    setLoadingMore(false);
  }, [page, hasMore, loadingMore, loadPage]);

  useEffect(() => { loadCandidates(); }, [loadCandidates]);
  useReconnect(loadCandidates);

  const filtered = useMemo(() => {
    if (!candidates) return candidates;
    return candidates.filter((p) => {
      if (p.age < filters.ageMin || p.age > filters.ageMax) return false;
      if (filters.level && p.chess_level !== filters.level) return false;
      if (filters.maxDistance > 0) {
        if (p.distance_km == null || p.distance_km > filters.maxDistance) return false;
      }
      // Visibilité mutuelle : le profil doit correspondre à qui je veux voir,
      // et moi correspondre à qui iel veut voir.
      if (profile.looking_for && !profile.looking_for.includes(p.gender)) return false;
      if (p.looking_for && !p.looking_for.includes(profile.gender)) return false;
      return true;
    });
  }, [candidates, filters, profile.looking_for, profile.gender]);

  const current = filtered && filtered[index % Math.max(filtered.length, 1)];
  const currentDistance = current ? current.distance_km : null;
  const currentPhotos = current?.photos?.length ? current.photos : current?.photo_url ? [current.photo_url] : [];

  const [photoIndex, setPhotoIndex] = useState(0);
  useEffect(() => { setPhotoIndex(0); setReportMenuOpen(false); }, [current?.id]);

  useEffect(() => {
    if (candidates && hasMore && !loadingMore && candidates.length - index <= 5) {
      loadMore();
    }
  }, [candidates, index, hasMore, loadingMore, loadMore]);

  const [passedThisSession, setPassedThisSession] = useState([]);
  const [reportMenuOpen, setReportMenuOpen] = useState(false);

  const reportCurrent = async (reason) => {
    if (!current) return;
    setReportMenuOpen(false);
    const { error } = await supabase.from("reports").insert({ reporter_id: profile.id, reported_id: current.id, reason });
    fireToast(error ? error.message || "Signalement refusé." : "Signalement envoyé, merci.");
  };
  const [lastAction, setLastAction] = useState(null); // { profile, prevIndex } for Rewind

  const advance = async (dir) => {
    if (!current) return;
    if (dir === "superlike" && !profile.is_premium) {
      fireToast("⭐ Super Trinque réservé aux comptes Premium.");
      return;
    }
    setExit(dir === "superlike" ? "right" : dir);
    setDrag({ active: false, x: 0, startX: 0 });
    const direction = dir === "right" ? "right" : dir === "superlike" ? "superlike" : "left";
    const { error } = await supabase.from("swipes").upsert(
      { swiper_id: profile.id, swiped_id: current.id, direction },
      { onConflict: "swiper_id,swiped_id" }
    );
    if (error) {
      fireToast(error.message || "Action refusée, réessayez.");
    } else if (direction === "right" || direction === "superlike") {
      setPassedThisSession((prev) => prev.filter((p) => p.id !== current.id));
      const a = profile.id < current.id ? profile.id : current.id;
      const b = profile.id < current.id ? current.id : profile.id;
      const { data: match } = await supabase.from("matches").select("*").eq("user_a", a).eq("user_b", b).maybeSingle();
      if (match) onMatch(match, current);
      else fireToast(direction === "superlike" ? `⭐ Super Trinque envoyé à ${current.name} !` : `Swipe envoyé à ${current.name}`);
      setLastAction(null);
    } else {
      setPassedThisSession((prev) => (prev.some((p) => p.id === current.id) ? prev : [...prev, current]));
      setLastAction({ profile: current, index });
    }
    setTimeout(() => {
      setExit(null);
      setIndex((i) => i + 1);
    }, 260);
  };

  const revisitPassed = () => {
    if (passedThisSession.length === 0) return;
    setCandidates((prev) => [...(prev || []), ...passedThisSession]);
    setPassedThisSession([]);
  };

  const rewind = async () => {
    if (!profile.is_premium) {
      fireToast("↺ Rewind réservé aux comptes Premium.");
      return;
    }
    if (!lastAction) {
      fireToast("Rien à annuler pour l'instant.");
      return;
    }
    await supabase.from("swipes").delete().eq("swiper_id", profile.id).eq("swiped_id", lastAction.profile.id);
    setPassedThisSession((prev) => prev.filter((p) => p.id !== lastAction.profile.id));
    setCandidates((prev) => {
      const withoutIt = (prev || []).filter((p) => p.id !== lastAction.profile.id);
      const idx = Math.min(lastAction.index, withoutIt.length);
      return [...withoutIt.slice(0, idx), lastAction.profile, ...withoutIt.slice(idx)];
    });
    setIndex(lastAction.index);
    setLastAction(null);
    fireToast("↺ Dernier swipe annulé");
  };

  const onPointerDown = (e) => { if (exit) return; setDrag({ active: true, x: 0, startX: e.clientX }); };
  const onPointerMove = (e) => { if (!drag.active) return; setDrag((d) => ({ ...d, x: e.clientX - d.startX })); };
  const endDrag = () => {
    if (!drag.active) return;
    if (drag.x > 90) advance("right");
    else if (drag.x < -90) advance("left");
    else setDrag({ active: false, x: 0, startX: 0 });
  };

  const dragX = exit ? (exit === "right" ? 160 : -160) : drag.x;
  const rotate = dragX / 18;
  const likeOpacity = Math.min(Math.max(dragX / 90, 0), 1);
  const passOpacity = Math.min(Math.max(-dragX / 90, 0), 1);

  const FilterPanel = () => (
    <GlassPanel className="em-fade-in" style={{ padding: 18, width: "100%", maxWidth: 340, marginBottom: 4 }}>
      <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "rgba(var(--text-rgb),0.5)", marginBottom: 10 }}>FILTRES</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <Field label="Âge min" value={filters.ageMin} onChange={(e) => { setFilters((f) => ({ ...f, ageMin: parseInt(e.target.value, 10) || 18 })); setIndex(0); }} />
          <Field label="Âge max" value={filters.ageMax} onChange={(e) => { setFilters((f) => ({ ...f, ageMax: parseInt(e.target.value, 10) || 99 })); setIndex(0); }} />
        </div>
        <div>
          <label style={labelStyle}>Niveau aux échecs</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <ChoiceChip label="Tous" active={!filters.level} onClick={() => { setFilters((f) => ({ ...f, level: "" })); setIndex(0); }} />
            {Object.entries(LEVEL_SHORT).map(([v, l]) => (
              <ChoiceChip key={v} label={l} active={filters.level === v} onClick={() => { setFilters((f) => ({ ...f, level: v })); setIndex(0); }} />
            ))}
          </div>
        </div>
        <Field
          label={profile.lat ? "Distance max (km, 0 = illimité)" : "Distance (activez votre position dans Profil)"}
          value={filters.maxDistance}
          onChange={(e) => { setFilters((f) => ({ ...f, maxDistance: parseInt(e.target.value, 10) || 0 })); setIndex(0); }}
        />
      </div>
    </GlassPanel>
  );

  const [showLikes, setShowLikes] = useState(false);

  const FilterToggle = () => (
    <div style={{ display: "flex", gap: 8 }}>
      <button
        className="em-btn"
        onClick={() => setShowFilters((v) => !v)}
        style={{
          fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "rgb(var(--text-rgb))", background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.16)", borderRadius: 999, padding: "6px 14px", cursor: "pointer", marginBottom: 4,
        }}
      >
        {showFilters ? "Masquer les filtres ▲" : "Filtres ▼"}
      </button>
      <button
        className="em-btn"
        onClick={() => setShowLikes(true)}
        style={{
          fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "rgb(var(--text-rgb))", background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.16)", borderRadius: 999, padding: "6px 14px", cursor: "pointer", marginBottom: 4,
        }}
      >
        💌 Qui m'a trinqué {!profile.is_premium && "🔒"}
      </button>
    </div>
  );

  if (filtered === null) {
    return (
      <GlassPanel className="em-fade-in" style={{ padding: 30, textAlign: "center" }}>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: "rgba(var(--text-rgb),0.65)", margin: 0 }}>Chargement des profils…</p>
      </GlassPanel>
    );
  }

  if (filtered.length === 0 || !current || index >= filtered.length) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <FilterToggle />
        {showFilters && <FilterPanel />}
        <GlassPanel className="em-fade-in" style={{ padding: 30, textAlign: "center" }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>🍾</div>
          <p style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: "rgb(var(--text-rgb))", margin: 0 }}>
            {candidates.length === 0 ? "Vous avez fait le tour de la salle" : "Aucun profil ne correspond à vos filtres"}
          </p>
          <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: "rgba(var(--text-rgb),0.65)", margin: "8px 0 18px" }}>
            {candidates.length === 0 ? "Revenez plus tard pour de nouveaux profils." : "Essayez d'élargir vos critères."}
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              className="em-btn"
              onClick={loadCandidates}
              style={{
                fontFamily: "'Outfit', sans-serif", fontSize: 12.5, fontWeight: 600, color: "#170f1a",
                background: "linear-gradient(160deg, #f0dcae, #cda45e)", border: "none", borderRadius: 999,
                padding: "10px 20px", cursor: "pointer",
              }}
            >
              Actualiser
            </button>
            {passedThisSession.length > 0 && (
              <button
                className="em-btn"
                onClick={revisitPassed}
                style={{
                  fontFamily: "'Outfit', sans-serif", fontSize: 12.5, fontWeight: 600, color: "rgb(var(--text-rgb))",
                  background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999,
                  padding: "10px 20px", cursor: "pointer",
                }}
              >
                ↺ Revoir les {passedThisSession.length} profil{passedThisSession.length > 1 ? "s" : ""} passé{passedThisSession.length > 1 ? "s" : ""}
              </button>
            )}
          </div>
        </GlassPanel>
        {showLikes && <LikesModal profile={profile} onClose={() => setShowLikes(false)} onMatch={onMatch} fireToast={fireToast} />}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
      <FilterToggle />
      {showFilters && <FilterPanel />}
      {showLikes && <LikesModal profile={profile} onClose={() => setShowLikes(false)} onMatch={onMatch} fireToast={fireToast} />}
      <div
        key={current.id}
        className="em-fade-in"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        style={{
          position: "relative", width: "100%", maxWidth: 340, touchAction: "pan-y",
          cursor: drag.active ? "grabbing" : "grab", userSelect: "none",
          transition: drag.active ? "none" : "transform 0.28s cubic-bezier(0.22,1,0.36,1), opacity 0.26s ease",
          transform: `translateX(${dragX}px) rotate(${rotate}deg)`,
          opacity: exit ? 0 : 1,
        }}
      >
        <GlassPanel style={{ padding: 22, overflow: "hidden" }}>
          <div
            style={{
              position: "relative", height: 170, borderRadius: 18, marginBottom: 18, overflow: "hidden",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "'Fraunces', serif", fontSize: 52, fontWeight: 500, color: "rgba(255,255,255,0.92)",
              background: currentPhotos.length > 0 ? "#170f1a" : `radial-gradient(circle at 30% 20%, ${current.hue}dd, ${current.hue}55 60%, #170f1a)`,
              border: "1px solid rgba(255,255,255,0.14)",
            }}
          >
            {currentPhotos.length > 0 ? (
              <img src={currentPhotos[photoIndex] || currentPhotos[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              current.initials
            )}
            {currentPhotos.length > 1 && (
              <>
                <div
                  onClick={(e) => { e.stopPropagation(); setPhotoIndex((i) => (i - 1 + currentPhotos.length) % currentPhotos.length); }}
                  style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "35%", cursor: "pointer" }}
                />
                <div
                  onClick={(e) => { e.stopPropagation(); setPhotoIndex((i) => (i + 1) % currentPhotos.length); }}
                  style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "35%", cursor: "pointer" }}
                />
                <div style={{ position: "absolute", top: 8, left: 8, right: 8, display: "flex", gap: 4 }}>
                  {currentPhotos.map((_, i) => (
                    <span key={i} style={{ flex: 1, height: 3, borderRadius: 999, background: i === photoIndex ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.3)" }} />
                  ))}
                </div>
              </>
            )}
            {onlineIds.has(current.id) && (
              <span style={{ position: "absolute", top: currentPhotos.length > 1 ? 20 : 12, left: 12, display: "flex", alignItems: "center", gap: 5, fontFamily: "'Outfit', sans-serif", fontSize: 10.5, fontWeight: 600, color: "rgb(var(--text-rgb))", background: "rgba(0,0,0,0.4)", borderRadius: 999, padding: "4px 9px" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#7fd88f", boxShadow: "0 0 6px #7fd88f" }} />
                En ligne
              </span>
            )}
            <span style={{ position: "absolute", top: 12, right: 12, fontFamily: "'Outfit', sans-serif", fontSize: 20, opacity: likeOpacity, color: "#7fd88f", fontWeight: 700, border: "2px solid #7fd88f", borderRadius: 8, padding: "2px 8px", transform: "rotate(-12deg)" }}>
              SANTÉ
            </span>
            <span style={{ position: "absolute", top: 12, left: "50%", fontFamily: "'Outfit', sans-serif", fontSize: 20, opacity: passOpacity, color: "#e08a8a", fontWeight: 700, border: "2px solid #e08a8a", borderRadius: 8, padding: "2px 8px", transform: "translateX(-50%) rotate(12deg)" }}>
              PASSER
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); setReportMenuOpen((v) => !v); }}
              aria-label="Signaler"
              style={{ position: "absolute", bottom: 10, right: 10, width: 28, height: 28, borderRadius: "50%", background: "rgba(0,0,0,0.45)", border: "none", color: "rgb(var(--text-rgb))", fontSize: 13, cursor: "pointer" }}
            >
              ⚑
            </button>
            {reportMenuOpen && (
              <div style={{ position: "absolute", bottom: 44, right: 10, zIndex: 5 }} onClick={(e) => e.stopPropagation()}>
                <GlassPanel className="em-modal" style={{ padding: 8, minWidth: 170 }}>
                  <MenuItem label="Comportement déplacé" onClick={() => reportCurrent("comportement_deplace")} />
                  <MenuItem label="Faux profil" onClick={() => reportCurrent("faux_profil")} />
                  <MenuItem label="Contenu inapproprié" onClick={() => reportCurrent("contenu_inapproprie")} />
                  <MenuItem label="Autre" onClick={() => reportCurrent("autre")} />
                </GlassPanel>
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
            <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 26, margin: 0, color: "rgb(var(--text-rgb))" }}>
              {current.name}, {current.age}
            </h2>
            <LevelBadge level={current.chess_level} />
          </div>
          <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 14.5, lineHeight: 1.55, color: "rgba(var(--text-rgb),0.82)", margin: "8px 0 14px" }}>
            {current.bio}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Chip label={`🥂 ${current.aperitif}`} />
            {currentDistance !== null && <Chip label={`📍 ${currentDistance} km`} />}
            {current.gender && <Chip label={GENDER_LABELS[current.gender] || current.gender} />}
            {(current.orientations || []).map((o) => <Chip key={o} label={ORIENTATION_LABELS[o] || o} />)}
            {current.relationship_goal && <Chip label={GOAL_LABELS[current.relationship_goal]} />}
          </div>
          {Array.isArray(current.prompts) && current.prompts[0]?.a && (
            <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 14, background: "var(--panel-a)", border: "1px solid var(--panel-border)" }}>
              <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, fontWeight: 600, color: "var(--accent-2)", marginBottom: 4 }}>{current.prompts[0].q}</div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, lineHeight: 1.4, color: "rgb(var(--text-rgb))" }}>{current.prompts[0].a}</div>
            </div>
          )}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setViewingFull(true); }}
            style={{ marginTop: 12, width: "100%", fontFamily: "'Outfit', sans-serif", fontSize: 12.5, fontWeight: 600, color: "rgb(var(--text-rgb))", background: "transparent", border: "1px solid var(--panel-border)", borderRadius: 999, padding: "8px 0", cursor: "pointer" }}
          >
            Voir le profil complet ↓
          </button>
        </GlassPanel>
      </div>
      {viewingFull && current && <ProfileViewModal other={current} onClose={() => setViewingFull(false)} />}

      <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "rgba(var(--text-rgb),0.4)", margin: 0 }}>
        Glissez la carte, ou utilisez les boutons
      </p>

      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <RoundButton onClick={rewind} label="Rewind" symbol="↺" tint="rgba(143,163,191,0.28)" locked={!profile.is_premium} />
        <RoundButton onClick={() => advance("left")} label="Passer" symbol="✕" tint="rgba(220,90,90,0.28)" />
        <RoundButton onClick={() => advance("right")} label="Trinquer" symbol="🥂" tint="rgba(205,164,94,0.32)" big />
        <RoundButton onClick={() => advance("superlike")} label="Super Trinque" symbol="⭐" tint="rgba(205,164,94,0.32)" locked={!profile.is_premium} />
      </div>
    </div>
  );
}

function ViewSection({ title, children }) {
  const items = React.Children.toArray(children).filter(Boolean);
  if (!items.length) return null;
  return (
    <div>
      <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase", color: "rgba(var(--text-rgb),0.5)", marginBottom: 8 }}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{items}</div>
    </div>
  );
}

// ---------- Fiche profil ----------
function ProfileViewModal({ other, onClose, title }) {
  const [photos, setPhotos] = useState(null);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    let active = true;
    supabase
      .from("profile_photos")
      .select("url, position")
      .eq("profile_id", other.id)
      .order("position", { ascending: true })
      .then(({ data }) => {
        if (!active) return;
        const urls = (data || []).map((r) => r.url);
        setPhotos(urls.length ? urls : other.photo_url ? [other.photo_url] : []);
      });
    return () => { active = false; };
  }, [other.id, other.photo_url]);

  const current = photos && photos.length ? photos[Math.min(idx, photos.length - 1)] : null;
  const navBtn = { position: "absolute", top: "50%", transform: "translateY(-50%)", width: 32, height: 32, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", cursor: "pointer", fontSize: 16 };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,6,10,0.6)", backdropFilter: "blur(6px)", padding: 20 }}>
      <GlassPanel className="em-fade-in em-modal" style={{ width: "100%", maxWidth: 360, maxHeight: "90vh", overflowY: "auto", padding: 0 }}>
        <div onClick={(e) => e.stopPropagation()}>
          <div style={{ position: "relative", aspectRatio: "4 / 5", background: other.hue || "#8f3350", borderRadius: "16px 16px 0 0", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {current ? (
              <img src={current} alt={other.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span style={{ fontFamily: "'Fraunces', serif", fontSize: 64, color: "#fff" }}>{other.initials}</span>
            )}
            {photos && photos.length > 1 && (
              <>
                <div style={{ position: "absolute", top: 8, left: 8, right: 8, display: "flex", gap: 4 }}>
                  {photos.map((_, i) => (
                    <div key={i} style={{ flex: 1, height: 3, borderRadius: 999, background: i === idx ? "#fff" : "rgba(255,255,255,0.35)" }} />
                  ))}
                </div>
                <button aria-label="Photo précédente" onClick={() => setIdx((i) => (i - 1 + photos.length) % photos.length)} style={{ ...navBtn, left: 8 }}>‹</button>
                <button aria-label="Photo suivante" onClick={() => setIdx((i) => (i + 1) % photos.length)} style={{ ...navBtn, right: 8 }}>›</button>
              </>
            )}
            <button aria-label="Fermer" onClick={onClose} style={{ ...navBtn, top: 26, right: 8, transform: "none" }}>✕</button>
          </div>

          <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            {title && (
              <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, fontWeight: 600, color: "var(--accent)", textAlign: "center" }}>{title}</div>
            )}
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontFamily: "'Fraunces', serif", fontSize: 24, color: "rgb(var(--text-rgb))" }}>
                {other.name}{other.age ? `, ${other.age}` : ""}
              </span>
              <LevelBadge level={other.chess_level} />
            </div>
            {(other.job || other.height_cm || other.distance_km != null) && (
              <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: "rgba(var(--text-rgb),0.7)", display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
                {other.job && <span>💼 {other.job}</span>}
                {other.height_cm && <span>📏 {other.height_cm} cm</span>}
                {other.distance_km != null && <span>📍 {other.distance_km} km</span>}
              </div>
            )}
            {other.relationship_goal && (
              <div style={{ alignSelf: "flex-start", fontFamily: "'Outfit', sans-serif", fontSize: 12.5, fontWeight: 600, color: "#170f1a", background: "linear-gradient(160deg, #f0dcae, #cda45e)", borderRadius: 999, padding: "5px 12px" }}>
                Cherche : {GOAL_LABELS[other.relationship_goal]}
              </div>
            )}

            {other.bio ? (
              <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 14, lineHeight: 1.6, color: "rgba(var(--text-rgb),0.85)", margin: 0, whiteSpace: "pre-wrap" }}>{other.bio}</p>
            ) : (
              <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: "rgba(var(--text-rgb),0.5)", margin: 0, fontStyle: "italic" }}>Pas encore de bio.</p>
            )}

            {Array.isArray(other.prompts) && other.prompts.filter((p) => p && p.a).map((p, i) => (
              <div key={i} style={{ padding: "14px 16px", borderRadius: 16, background: "var(--panel-a)", border: "1px solid var(--panel-border)" }}>
                <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, fontWeight: 600, color: "var(--accent-2)", marginBottom: 6 }}>{p.q}</div>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 17, lineHeight: 1.4, color: "rgb(var(--text-rgb))" }}>{p.a}</div>
              </div>
            ))}

            {other.interests && other.interests.length > 0 && (
              <ViewSection title="Centres d'intérêt">
                {other.interests.map((it) => <Chip key={it} label={it} />)}
              </ViewSection>
            )}

            <ViewSection title="En bref">
              {other.gender && <Chip label={GENDER_LABELS[other.gender] || other.gender} />}
              {(other.orientations || []).map((o) => <Chip key={o} label={ORIENTATION_LABELS[o] || o} />)}
              {other.aperitif && <Chip label={`🥂 ${other.aperitif}`} />}
              {other.drinks && <Chip label={`🍷 ${DRINKS_LABELS[other.drinks]}`} />}
              {other.smokes && <Chip label={`🚬 ${SMOKES_LABELS[other.smokes]}`} />}
              {other.kids && <Chip label={`👶 ${KIDS_LABELS[other.kids]}`} />}
            </ViewSection>

            {other.fav_piece && (
              <ViewSection title="Si c'était une pièce d'échecs…">
                <Chip label={PIECE_LABELS[other.fav_piece]} />
              </ViewSection>
            )}
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}

// ---------- Matches / chat ----------
function MatchesScreen({ profile, onPlay, activeChatId, setActiveChatId, fireToast, onlineIds = new Set(), onUnreadChange }) {
  const [matches, setMatches] = useState(null);
  const [viewing, setViewing] = useState(null);

  const loadMatches = useCallback(async () => {
    const { data: rows } = await supabase
      .from("matches")
      .select("*")
      .or(`user_a.eq.${profile.id},user_b.eq.${profile.id}`)
      .order("created_at", { ascending: false });
    if (!rows) { setMatches([]); onUnreadChange?.(0); return; }
    const { data: blocked } = await supabase.from("blocked_users").select("blocked_id").eq("blocker_id", profile.id);
    const blockedIds = new Set((blocked || []).map((b) => b.blocked_id));
    const otherIds = rows.map((m) => (m.user_a === profile.id ? m.user_b : m.user_a)).filter((id) => !blockedIds.has(id));
    const { data: otherProfiles } = otherIds.length
      ? await supabase.from("public_profiles").select("*").in("id", otherIds)
      : { data: [] };

    const matchIds = rows.map((m) => m.id);
    const { data: lastMessages } = matchIds.length
      ? await supabase.from("messages").select("match_id, sender_id, text, created_at").in("match_id", matchIds).order("created_at", { ascending: false })
      : { data: [] };
    const lastByMatch = {};
    (lastMessages || []).forEach((m) => { if (!lastByMatch[m.match_id]) lastByMatch[m.match_id] = m; });

    const { data: reads } = await supabase.from("match_reads").select("match_id, last_read_at").eq("user_id", profile.id);
    const readByMatch = {};
    (reads || []).forEach((r) => { readByMatch[r.match_id] = r.last_read_at; });

    const merged = rows.map((m) => {
      const otherId = m.user_a === profile.id ? m.user_b : m.user_a;
      const other = (otherProfiles || []).find((p) => p.id === otherId);
      const lastMsg = lastByMatch[m.id];
      const lastRead = readByMatch[m.id];
      const unread = (lastMessages || []).filter(
        (msg) => msg.match_id === m.id && msg.sender_id !== profile.id && (!lastRead || new Date(msg.created_at) > new Date(lastRead))
      ).length;
      return { match: m, profile: other, lastMsg, unread };
    }).filter((m) => m.profile);

    setMatches(merged);
    onUnreadChange?.(merged.filter((m) => m.unread > 0).length);
  }, [profile.id, onUnreadChange]);

  useEffect(() => {
    loadMatches();
    const channel = supabase
      .channel("matches-listen")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "matches" }, () => loadMatches())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [loadMatches]);

  useReconnect(loadMatches);

  const activeEntry = matches?.find((m) => m.match.id === activeChatId);

  if (activeEntry) {
    return (
      <ChatScreen
        matchId={activeEntry.match.id}
        me={profile}
        other={activeEntry.profile}
        onBack={() => setActiveChatId(null)}
        onBlocked={() => { setActiveChatId(null); loadMatches(); }}
        onUnmatched={() => { setActiveChatId(null); loadMatches(); }}
        onRead={loadMatches}
        fireToast={fireToast}
      />
    );
  }

  if (matches === null) {
    return (
      <GlassPanel style={{ padding: 28, textAlign: "center" }}>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: "rgba(var(--text-rgb),0.65)", margin: 0 }}>Chargement…</p>
      </GlassPanel>
    );
  }

  if (matches.length === 0) {
    return (
      <GlassPanel style={{ padding: 28, textAlign: "center" }}>
        <p style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: "rgb(var(--text-rgb))", margin: 0 }}>Aucun match pour l'instant</p>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13.5, color: "rgba(var(--text-rgb),0.7)", marginTop: 8 }}>
          Trinquez avec un profil pour ouvrir une table et lancer une partie.
        </p>
      </GlassPanel>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {viewing && <ProfileViewModal other={viewing} onClose={() => setViewing(null)} />}
      {matches.map(({ match, profile: other, lastMsg, unread }) => (
        <GlassPanel key={match.id} className="em-list-row" style={{ padding: 16, display: "flex", alignItems: "center", gap: 14 }}>
          <div onClick={() => setViewing(other)} title="Voir le profil" style={{ cursor: "pointer", position: "relative" }}>
            <Avatar initials={other.initials} hue={other.hue} photoUrl={other.photo_url} />
            {onlineIds.has(other.id) && (
              <span style={{ position: "absolute", bottom: 0, right: 0, width: 11, height: 11, borderRadius: "50%", background: "#7fd88f", border: "2px solid #170f1a", boxShadow: "0 0 6px #7fd88f" }} />
            )}
          </div>
          <div style={{ flex: 1, cursor: "pointer", minWidth: 0 }} onClick={() => setActiveChatId(match.id)}>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, color: "rgb(var(--text-rgb))" }}>{other.name}</div>
            <div
              style={{
                fontFamily: "'Outfit', sans-serif", fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                color: unread > 0 ? "var(--accent)" : "rgba(var(--text-rgb),0.65)", fontWeight: unread > 0 ? 600 : 400,
              }}
            >
              {lastMsg
                ? `${lastMsg.sender_id === profile.id ? "Vous : " : ""}${lastMsg.text}`
                : [other.aperitif && `🥂 ${other.aperitif}`, other.chess_level && LEVEL_SHORT[other.chess_level]].filter(Boolean).join(" · ") || "Dites bonjour 👋"}
            </div>
          </div>
          {unread > 0 && (
            <span style={{
              minWidth: 20, height: 20, borderRadius: "50%", background: "#cda45e", color: "#170f1a",
              fontFamily: "'Outfit', sans-serif", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center",
              justifyContent: "center", padding: "0 5px", flexShrink: 0,
            }}>
              {unread > 9 ? "9+" : unread}
            </span>
          )}
          <button
            className="em-btn"
            onClick={() => onPlay(match, other)}
            style={{
              fontFamily: "'Outfit', sans-serif", fontSize: 12.5, fontWeight: 600, color: "#170f1a",
              background: "linear-gradient(160deg, #f0dcae, #cda45e)", border: "none", borderRadius: 999,
              padding: "8px 14px", cursor: "pointer", flexShrink: 0,
            }}
          >
            Jouer ♟
          </button>
        </GlassPanel>
      ))}
    </div>
  );
}

function MenuItem({ label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block", width: "100%", textAlign: "left", fontFamily: "'Outfit', sans-serif", fontSize: 12.5,
        color: danger ? "#e08a8a" : "rgb(var(--text-rgb))", background: "none", border: "none", borderRadius: 10,
        padding: "8px 10px", cursor: "pointer",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
    >
      {label}
    </button>
  );
}

function ChatScreen({ matchId, me, other, onBack, onBlocked, onUnmatched, onRead, fireToast }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const bottomRef = useRef(null);

  const reloadMessages = useCallback(async () => {
    const { data } = await supabase.from("messages").select("*").eq("match_id", matchId).order("created_at", { ascending: true });
    setMessages(data || []);
  }, [matchId]);

  const markRead = useCallback(async () => {
    await supabase.from("match_reads").upsert(
      { user_id: me.id, match_id: matchId, last_read_at: new Date().toISOString() },
      { onConflict: "user_id,match_id" }
    );
    onRead?.();
  }, [me.id, matchId, onRead]);

  useEffect(() => {
    reloadMessages();
    markRead();
    const channel = supabase
      .channel(`messages-${matchId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `match_id=eq.${matchId}` }, (payload) => {
        setMessages((prev) => (prev.some((m) => m.id === payload.new.id) ? prev : [...prev, payload.new]));
        if (payload.new.sender_id !== me.id) markRead();
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, reloadMessages]);

  useReconnect(reloadMessages);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  const send = async (value) => {
    const trimmed = (value ?? text).trim();
    if (!trimmed) return;
    setText("");
    const { error } = await supabase.from("messages").insert({ match_id: matchId, sender_id: me.id, text: trimmed });
    if (error) fireToast("Message non envoyé — trop rapide, patientez un instant.");
  };

  const block = async () => {
    await supabase.from("blocked_users").insert({ blocker_id: me.id, blocked_id: other.id });
    fireToast(`${other.name} a été bloqué·e`);
    onBlocked();
  };

  const unmatch = async () => {
    await supabase.from("matches").delete().eq("id", matchId);
    fireToast("Vous avez quitté la table");
    onUnmatched();
  };

  const report = async (reason) => {
    await supabase.from("reports").insert({ reporter_id: me.id, reported_id: other.id, reason });
    setReportOpen(false);
    setMenuOpen(false);
    fireToast("Signalement envoyé, merci.");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {showProfile && <ProfileViewModal other={other} onClose={() => setShowProfile(false)} />}
      <div style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
        <button onClick={onBack} aria-label="Retour" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: "50%", width: 34, height: 34, color: "rgb(var(--text-rgb))", cursor: "pointer" }}>
          ←
        </button>
        <button onClick={() => setShowProfile(true)} title="Voir le profil" style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
          <Avatar initials={other.initials} hue={other.hue} photoUrl={other.photo_url} size={34} />
          <span style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: "rgb(var(--text-rgb))" }}>{other.name}</span>
        </button>
        <button onClick={() => setMenuOpen((v) => !v)} aria-label="Options" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: "50%", width: 34, height: 34, color: "rgb(var(--text-rgb))", cursor: "pointer" }}>
          ⋯
        </button>
        {menuOpen && (
          <div style={{ position: "absolute", top: 40, right: 0, zIndex: 5 }}>
            <GlassPanel className="em-modal" style={{ padding: 8, minWidth: 160 }}>
              {!reportOpen ? (
                <>
                  <MenuItem label="Voir le profil" onClick={() => { setMenuOpen(false); setShowProfile(true); }} />
                  <MenuItem label="Quitter la table" onClick={unmatch} />
                  <MenuItem label="Signaler" onClick={() => setReportOpen(true)} />
                  <MenuItem label="Bloquer" danger onClick={block} />
                </>
              ) : (
                <>
                  <MenuItem label="Comportement déplacé" onClick={() => report("comportement_deplace")} />
                  <MenuItem label="Faux profil" onClick={() => report("faux_profil")} />
                  <MenuItem label="Contenu inapproprié" onClick={() => report("contenu_inapproprie")} />
                  <MenuItem label="Autre" onClick={() => report("autre")} />
                </>
              )}
            </GlassPanel>
          </div>
        )}
      </div>

      <GlassPanel style={{ padding: 14, minHeight: 220, maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {messages.length === 0 && (
          <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: "rgba(var(--text-rgb),0.6)", margin: "auto" }}>
            Dites bonjour avant de vous asseoir à la table 🥂
          </p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              alignSelf: msg.sender_id === me.id ? "flex-end" : "flex-start",
              maxWidth: "78%",
              background: msg.sender_id === me.id ? "linear-gradient(160deg, #f0dcae, #cda45e)" : "rgba(255,255,255,0.1)",
              color: msg.sender_id === me.id ? "#170f1a" : "rgb(var(--text-rgb))",
              borderRadius: 14, padding: "8px 12px", fontFamily: "'Outfit', sans-serif", fontSize: 13.5,
            }}
          >
            {msg.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </GlassPanel>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {["🥂 Santé !", "♟️ On joue ?", "😄 Haha"].map((quick) => (
          <button key={quick} onClick={() => send(quick)} style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: "rgb(var(--text-rgb))", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 999, padding: "6px 12px", cursor: "pointer" }}>
            {quick}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Écrire un message…"
          style={{ flex: 1, fontFamily: "'Outfit', sans-serif", fontSize: 13.5, color: "rgb(var(--text-rgb))", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999, padding: "10px 16px", outline: "none" }}
        />
        <button onClick={() => send()} style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 600, color: "#170f1a", background: "linear-gradient(160deg, #f0dcae, #cda45e)", border: "none", borderRadius: 999, padding: "0 18px", cursor: "pointer" }}>
          Envoyer
        </button>
      </div>
    </div>
  );
}

function MatchModal({ profile, onClose, onChat }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,6,10,0.6)", backdropFilter: "blur(6px)", padding: 24 }}>
      <GlassPanel style={{ padding: 28, textAlign: "center", maxWidth: 320 }} className="em-fade-in em-modal">
        <div style={{ fontSize: 36, marginBottom: 6 }}>🥂</div>
        <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 24, color: "rgb(var(--text-rgb))", margin: "0 0 6px" }}>Nouveau match !</h2>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13.5, color: "rgba(var(--text-rgb),0.75)", margin: "0 0 20px" }}>
          Vous et {profile.name} avez trinqué. La table vous attend.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button className="em-btn" onClick={onClose} style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12.5, fontWeight: 600, color: "rgb(var(--text-rgb))", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999, padding: "9px 16px", cursor: "pointer" }}>
            Continuer
          </button>
          <button className="em-btn" onClick={onChat} style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12.5, fontWeight: 600, color: "#170f1a", background: "linear-gradient(160deg, #f0dcae, #cda45e)", border: "none", borderRadius: 999, padding: "9px 16px", cursor: "pointer" }}>
            Dire bonjour
          </button>
        </div>
      </GlassPanel>
    </div>
  );
}

// ---------- Chess ----------
function RulesModal({ onClose }) {
  const pieces = ["k", "q", "r", "b", "n", "p"];
  const rules = [
    { icon: "⚠️", title: "L'échec", text: "Quand votre roi est attaqué, vous devez le mettre à l'abri tout de suite : le déplacer, bloquer l'attaque ou prendre l'attaquant. L'app ne vous laissera jamais jouer un coup qui laisse votre roi en danger." },
    { icon: "🏰", title: "Le roque", text: "Une fois par partie, le roi glisse de 2 cases vers une tour, et la tour passe de l'autre côté du roi. C'est possible si ni l'un ni l'autre n'a encore bougé, que rien ne les sépare et que le roi n'est pas attaqué. Pour roquer, déplacez simplement le roi de 2 cases." },
    { icon: "👑", title: "La promotion", text: "Un pion qui atteint le bout du plateau se transforme en dame, tour, fou ou cavalier. On choisit presque toujours la dame !" },
    { icon: "👻", title: "La prise en passant", text: "Si un pion adverse avance de 2 cases et arrive juste à côté du vôtre, vous pouvez le prendre comme s'il n'avait avancé que d'une case. Uniquement au coup qui suit." },
    { icon: "🤝", title: "Le match nul", text: "Le « pat » : le joueur qui doit jouer n'a aucun coup possible sans être en échec. Il y a aussi nulle quand il ne reste plus assez de pièces pour faire mat, ou après 50 coups sans prise ni coup de pion." },
  ];
  const h = { fontFamily: "'Fraunces', serif", fontSize: 15, color: "rgb(var(--text-rgb))", margin: "0 0 4px" };
  const t = { fontFamily: "'Outfit', sans-serif", fontSize: 12.5, lineHeight: 1.55, color: "rgba(var(--text-rgb),0.75)", margin: 0 };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 25, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,6,10,0.6)", backdropFilter: "blur(6px)", padding: 20 }}>
      <GlassPanel className="em-fade-in em-modal" style={{ width: "100%", maxWidth: 380, maxHeight: "88vh", overflowY: "auto", padding: 22 }}>
        <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 30 }}>🥂♟️</div>
            <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: 21, color: "rgb(var(--text-rgb))", margin: "4px 0" }}>Les échecs en un apéro</h3>
            <p style={t}>Le temps de finir votre verre, vous connaîtrez les règles.</p>
          </div>
          <div>
            <h4 style={h}>🎯 Le but</h4>
            <p style={t}>Mettre le roi adverse « échec et mat » : il est attaqué et n'a plus aucune case sûre. On ne prend jamais le roi, on le coince. Les blancs commencent toujours.</p>
          </div>
          <div>
            <h4 style={h}>♟ Comment bougent les pièces</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
              {pieces.map((k) => (
                <div key={k} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 24, lineHeight: 1, width: 28, textAlign: "center", flexShrink: 0, color: "rgb(var(--text-rgb))" }}>{GLYPHS["b" + k]}</span>
                  <p style={t}><b style={{ color: "rgb(var(--text-rgb))" }}>{PIECE_NAMES[k]}</b> : {PIECE_TIPS[k]}</p>
                </div>
              ))}
            </div>
          </div>
          {rules.map((r) => (
            <div key={r.title}>
              <h4 style={h}>{r.icon} {r.title}</h4>
              <p style={t}>{r.text}</p>
            </div>
          ))}
          <div style={{ padding: 12, borderRadius: 14, background: "rgba(205,164,94,0.12)", border: "1px solid rgba(205,164,94,0.3)" }}>
            <p style={t}>💡 <b style={{ color: "rgb(var(--text-rgb))" }}>Astuce :</b> touchez une de vos pièces, les points dorés montrent où elle peut aller. Pas de stress, l'app refuse tout coup interdit.</p>
          </div>
          <button className="em-btn" onClick={onClose} style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, fontWeight: 600, color: "#170f1a", background: "linear-gradient(160deg, #f0dcae, #cda45e)", border: "none", borderRadius: 999, padding: "11px 0", cursor: "pointer" }}>
            C'est parti !
          </button>
        </div>
      </GlassPanel>
    </div>
  );
}

function ChessScreen({ match, me, opponent, fireToast }) {
  const [game, setGame] = useState(null);
  const [selected, setSelected] = useState(null);
  const [promoPending, setPromoPending] = useState(null);
  const [showRules, setShowRules] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);
  const [busy, setBusy] = useState(false);
  const myColor = match.user_a === me.id ? "w" : "b";
  const oppColor = myColor === "w" ? "b" : "w";
  const theme = BOARD_THEMES[me.board_theme] || BOARD_THEMES.sauge;

  const loadOrCreateGame = useCallback(async () => {
    const { data: existing } = await supabase.from("games").select("*").eq("match_id", match.id).maybeSingle();
    if (existing) { setGame(existing); return; }
    const fresh = { match_id: match.id, board: START_BOARD, turn: "w", captured_w: [], captured_b: [], log: [] };
    const { data: created } = await supabase.from("games").insert(fresh).select().maybeSingle();
    if (created) setGame(created);
    else {
      // L'adversaire a peut-être créé la partie au même instant.
      const { data: again } = await supabase.from("games").select("*").eq("match_id", match.id).maybeSingle();
      setGame(again || { ...fresh, castling: "KQkq", ep_r: null, ep_c: null, result: null });
    }
  }, [match.id]);

  useEffect(() => {
    loadOrCreateGame();
    const channel = supabase
      .channel(`game-${match.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games", filter: `match_id=eq.${match.id}` }, (payload) => {
        setGame(payload.new);
        setSelected(null);
        setConfirmResign(false);
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [match.id, loadOrCreateGame]);

  useReconnect(loadOrCreateGame);

  const board = game?.board || START_BOARD;
  const turn = game?.turn || "w";
  const chessState = useMemo(
    () => ({ castling: game?.castling ?? "KQkq", ep: game?.ep_r != null ? [game.ep_r, game.ep_c] : null }),
    [game?.castling, game?.ep_r, game?.ep_c]
  );
  const captured = { w: game?.captured_w || [], b: game?.captured_b || [] };
  const log = game?.log || [];
  const result = game?.result || (game?.winner_id ? "checkmate" : null);
  const over = !!result;
  const iWon = game?.winner_id === me.id;
  const myTurn = turn === myColor && !over;

  const moves = useMemo(
    () => (selected && myTurn ? legalMoves(board, selected[0], selected[1], chessState) : []),
    [board, selected, myTurn, chessState]
  );
  const kingPos = findKing(board, turn);
  const inCheck = !over && kingPos && isAttacked(board, kingPos[0], kingPos[1], turn === "w" ? "b" : "w");

  const sendMove = async (fr, fc, tr, tc, promo = "q") => {
    setBusy(true);
    const { data, error } = await supabase.rpc("make_chess_move", {
      p_game_id: game.id, p_from_r: fr, p_from_c: fc, p_to_r: tr, p_to_c: tc, p_promotion: promo,
    });
    setBusy(false);
    setSelected(null);
    setPromoPending(null);
    if (error) {
      // Le serveur fait foi : on recharge l'état réel de la partie.
      fireToast?.("Coup refusé, la partie a été resynchronisée.");
      loadOrCreateGame();
    } else if (data?.result === "checkmate") fireToast?.("Échec et mat ! Ça se fête 🥂");
    else if (data?.result) fireToast?.("Match nul 🤝");
    else if (data?.check) fireToast?.("Échec au roi ! ♚");
  };

  const handleSquare = (r, c) => {
    if (!game || !myTurn || busy) return;
    const piece = board[r][c];
    if (selected && moves.some(([mr, mc]) => mr === r && mc === c)) {
      const moving = board[selected[0]][selected[1]];
      if (moving[1] === "p" && (r === 0 || r === 7)) setPromoPending([selected[0], selected[1], r, c]);
      else sendMove(selected[0], selected[1], r, c);
      return;
    }
    if (piece && piece[0] === myColor) setSelected(selected && selected[0] === r && selected[1] === c ? null : [r, c]);
    else setSelected(null);
  };

  const rematch = async () => {
    const { error } = await supabase
      .from("games")
      .update({
        board: START_BOARD, turn: "w", turn_user_id: match.user_a, captured_w: [], captured_b: [], log: [],
        winner_id: null, result: null, castling: "KQkq", ep_r: null, ep_c: null, halfmove: 0, updated_at: new Date().toISOString(),
      })
      .eq("id", game.id);
    if (error) fireToast?.("Impossible de relancer la partie.");
    setSelected(null);
  };

  const resign = async () => {
    const { error } = await supabase.rpc("resign_chess_game", { p_game_id: game.id });
    setConfirmResign(false);
    if (error) fireToast?.("Impossible d'abandonner : " + error.message);
  };

  const score = (color) => captured[color].reduce((sum, p) => sum + PIECE_VALUE[p[1]], 0);

  if (!game) {
    return (
      <GlassPanel style={{ padding: 28, textAlign: "center" }}>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: "rgba(var(--text-rgb),0.65)", margin: 0 }}>Installation de la table…</p>
      </GlassPanel>
    );
  }

  let status;
  if (result === "checkmate") status = iWon ? "Échec et mat, vous gagnez ! 🥂" : `Échec et mat, ${opponent.name} gagne. Revanche ?`;
  else if (result === "resign") status = iWon ? `${opponent.name} a abandonné : victoire ! 🥂` : "Vous avez abandonné. Revanche ?";
  else if (result === "stalemate") status = "Pat : plus aucun coup possible sans se mettre en échec. Match nul 🤝";
  else if (result === "draw_material") status = "Match nul : plus assez de pièces pour faire mat 🤝";
  else if (result === "draw_50") status = "Match nul : 50 coups sans prise ni coup de pion 🤝";
  else if (inCheck && myTurn) status = "Échec ! Mettez votre roi à l'abri ♚";
  else if (inCheck) status = `Échec au roi de ${opponent.name} !`;
  else status = myTurn ? "À vous de jouer" : `${opponent.name} réfléchit…`;

  const selPiece = selected ? board[selected[0]][selected[1]] : null;
  const rowsOrder = myColor === "w" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const colsOrder = myColor === "w" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const smallBtn = { fontFamily: "'Outfit', sans-serif", fontSize: 12.5, fontWeight: 600, color: "rgb(var(--text-rgb))", background: "rgba(255,255,255,0.08)", border: "1px solid var(--panel-border)", borderRadius: 999, padding: "8px 14px", cursor: "pointer" };
  const goldBtn = { fontFamily: "'Outfit', sans-serif", fontSize: 12.5, fontWeight: 600, color: "#170f1a", background: "linear-gradient(160deg, #f0dcae, #cda45e)", border: "none", borderRadius: 999, padding: "8px 16px", cursor: "pointer" };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      {promoPending && (
        <div style={{ position: "fixed", inset: 0, zIndex: 25, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,6,10,0.6)", backdropFilter: "blur(6px)", padding: 20 }}>
          <GlassPanel className="em-fade-in em-modal" style={{ padding: 22, textAlign: "center", maxWidth: 320 }}>
            <div style={{ fontSize: 28 }}>👑</div>
            <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: 19, color: "rgb(var(--text-rgb))", margin: "4px 0 6px" }}>Promotion !</h3>
            <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12.5, color: "rgba(var(--text-rgb),0.7)", margin: "0 0 14px" }}>Votre pion est arrivé au bout. En quoi se transforme-t-il ?</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              {["q", "r", "b", "n"].map((k) => (
                <button key={k} className="em-btn" onClick={() => sendMove(...promoPending, k)} style={{ width: 62, padding: "8px 0", borderRadius: 14, border: "1px solid rgba(205,164,94,0.5)", background: "rgba(205,164,94,0.15)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <span style={{ fontSize: 28, color: "rgb(var(--text-rgb))" }}>{GLYPHS[myColor + k]}</span>
                  <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 10.5, color: "rgba(var(--text-rgb),0.7)" }}>{PIECE_NAMES[k]}</span>
                </button>
              ))}
            </div>
            <button onClick={() => { setPromoPending(null); setSelected(null); }} style={{ marginTop: 12, fontFamily: "'Outfit', sans-serif", fontSize: 12, color: "rgba(var(--text-rgb),0.55)", background: "none", border: "none", cursor: "pointer" }}>
              Annuler
            </button>
          </GlassPanel>
        </div>
      )}

      <GlassPanel style={{ padding: "10px 18px", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: "rgba(var(--text-rgb),0.85)" }}>
          Table avec <b style={{ color: "var(--accent)" }}>{opponent.name}</b> · vous jouez les {myColor === "w" ? "blancs ♔" : "noirs ♚"}
        </span>
      </GlassPanel>

      <CapturedTray pieces={captured[oppColor]} label={`${opponent.name} a pris (+${score(oppColor)})`} />

      <GlassPanel style={{ padding: "14px 12px 6px" }}>
        <div style={{ display: "flex" }}>
          <div style={{ display: "grid", gridTemplateRows: "repeat(8, 1fr)", width: 16, height: 304, marginRight: 3 }}>
            {rowsOrder.map((r) => (
              <span key={r} style={{ fontFamily: "'Outfit', sans-serif", fontSize: 9, color: "rgba(var(--text-rgb),0.4)", display: "flex", alignItems: "center" }}>{8 - r}</span>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", width: 304, height: 304, borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.18)", boxShadow: "inset 0 2px 12px rgba(0,0,0,0.4)" }}>
            {rowsOrder.map((r) =>
              colsOrder.map((c) => {
                const piece = board[r][c];
                const dark = (r + c) % 2 === 1;
                const isSelected = selected && selected[0] === r && selected[1] === c;
                const isMoveTarget = moves.some(([mr, mc]) => mr === r && mc === c);
                const isCheckedKing = inCheck && kingPos && kingPos[0] === r && kingPos[1] === c;
                return (
                  <div
                    key={`${r}-${c}`}
                    className="em-square"
                    onClick={() => handleSquare(r, c)}
                    style={{
                      width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24,
                      cursor: myTurn ? "pointer" : "default", position: "relative",
                      background: isCheckedKing
                        ? "radial-gradient(circle, rgba(224,90,90,0.95) 0%, rgba(224,90,90,0.35) 70%)"
                        : dark ? `linear-gradient(160deg, ${theme.dark[0]}, ${theme.dark[1]})` : `linear-gradient(160deg, ${theme.light[0]}, ${theme.light[1]})`,
                      color: piece && piece[0] === "w" ? "#fdf8ee" : "#1a1210",
                      textShadow: piece && piece[0] === "w" ? "0 1px 2px rgba(0,0,0,0.7)" : "none",
                      outline: isSelected ? "2px solid #cda45e" : "none",
                      outlineOffset: -2,
                    }}
                  >
                    {piece && GLYPHS[piece]}
                    {isMoveTarget && (
                      <span style={{ position: "absolute", width: piece ? 34 : 10, height: piece ? 34 : 10, borderRadius: "50%", border: piece ? "2px solid rgba(205,164,94,0.9)" : "none", background: piece ? "transparent" : "rgba(205,164,94,0.8)" }} />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
        <div style={{ display: "flex", paddingLeft: 19, marginTop: 4 }}>
          {colsOrder.map((c) => (
            <span key={c} style={{ width: 38, textAlign: "center", fontFamily: "'Outfit', sans-serif", fontSize: 9, color: "rgba(var(--text-rgb),0.4)" }}>{"abcdefgh"[c]}</span>
          ))}
        </div>
      </GlassPanel>

      <CapturedTray pieces={captured[myColor]} label={`Vous avez pris (+${score(myColor)})`} />

      <GlassPanel style={{ padding: "10px 16px", textAlign: "center", maxWidth: 330 }}>
        <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, fontWeight: 600, color: inCheck ? "#e08a8a" : "var(--accent)" }}>{status}</span>
        {!over && myTurn && (
          <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, lineHeight: 1.5, color: "rgba(var(--text-rgb),0.65)", margin: "6px 0 0" }}>
            {selPiece
              ? <>{GLYPHS[selPiece]} <b>{PIECE_NAMES[selPiece[1]]}</b> : {PIECE_TIPS[selPiece[1]]}{moves.length === 0 && " Elle ne peut pas bouger pour l'instant."}</>
              : "Touchez une de vos pièces pour voir où elle peut aller."}
          </p>
        )}
      </GlassPanel>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        <button className="em-btn" onClick={() => setShowRules(true)} style={smallBtn}>📖 Les règles</button>
        {over ? (
          <button className="em-btn" onClick={rematch} style={goldBtn}>Revanche 🥂</button>
        ) : confirmResign ? (
          <>
            <button className="em-btn" onClick={resign} style={{ ...smallBtn, color: "#e08a8a", borderColor: "rgba(224,138,138,0.5)" }}>Oui, j'abandonne</button>
            <button className="em-btn" onClick={() => setConfirmResign(false)} style={smallBtn}>Non, je continue</button>
          </>
        ) : (
          <button className="em-btn" onClick={() => setConfirmResign(true)} style={smallBtn}>🏳 Abandonner</button>
        )}
      </div>

      {log.length > 0 && (
        <GlassPanel style={{ padding: "12px 16px", width: "100%", maxWidth: 304, maxHeight: 120, overflowY: "auto" }}>
          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 10.5, color: "rgba(var(--text-rgb),0.5)", marginBottom: 6 }}>HISTORIQUE</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px" }}>
            {log.map((entry, i) => (
              <span key={i} style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: "rgba(var(--text-rgb),0.8)" }}>{i + 1}. {entry}</span>
            ))}
          </div>
        </GlassPanel>
      )}
    </div>
  );
}

function CapturedTray({ pieces, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 20 }}>
      <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "rgba(var(--text-rgb),0.55)" }}>{label}:</span>
      <div style={{ display: "flex", gap: 2 }}>
        {pieces.map((p, i) => (
          <span key={i} style={{ fontSize: 16, color: p[0] === "w" ? "rgb(var(--text-rgb))" : "#a99b7f" }}>{GLYPHS[p]}</span>
        ))}
      </div>
    </div>
  );
}

function NavButton({ active, onClick, icon, label, badge }) {
  return (
    <button
      className="em-nav-btn"
      onClick={onClick}
      style={{
        position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
        background: active ? "rgba(205,164,94,0.18)" : "transparent", border: "none", borderRadius: 16,
        padding: "8px 18px", cursor: "pointer", color: active ? "var(--accent)" : "rgba(var(--text-rgb),0.6)",
      }}
    >
      <span style={{ fontSize: 18 }}>{icon}</span>
      <span style={{ fontSize: 10.5, fontWeight: 600 }}>{label}</span>
      {!!badge && (
        <span style={{ position: "absolute", top: 2, right: 8, width: 16, height: 16, borderRadius: "50%", background: "#cda45e", color: "#170f1a", fontSize: 9.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {badge}
        </span>
      )}
    </button>
  );
}

function MandatoryPhotoScreen({ profile, onUploaded, onLogout }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const onPhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Choisissez une image."); return; }
    if (file.size > 5 * 1024 * 1024) { setError("Image trop lourde (5 Mo max)."); return; }
    setError("");
    setUploading(true);
    const res = await uploadProfilePhoto(profile.id, file);
    setUploading(false);
    if (!res.ok) { setError(res.error); return; }
    onUploaded(res.url);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, paddingTop: 20 }}>
      <GlassPanel className="em-fade-in" style={{ padding: 30, maxWidth: 340, textAlign: "center" }}>
        <div style={{ fontSize: 38, marginBottom: 10 }}>📷</div>
        <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: 20, color: "rgb(var(--text-rgb))", margin: "0 0 8px" }}>Ajoutez une photo</h3>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, lineHeight: 1.6, color: "rgba(var(--text-rgb),0.75)", margin: "0 0 20px" }}>
          Une photo de profil est obligatoire pour continuer — ça met tout de suite plus à l'aise à l'apéro qu'un avatar anonyme.
        </p>

        <label
          style={{
            width: 120, height: 120, margin: "0 auto 18px", borderRadius: "50%", cursor: "pointer",
            background: `radial-gradient(circle at 30% 25%, ${profile.hue}dd, #170f1a)`,
            border: "2px dashed rgba(255,255,255,0.3)", display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'Fraunces', serif", fontSize: 34, color: "rgb(var(--text-rgb))",
          }}
        >
          {uploading ? "…" : profile.initials}
          <input type="file" accept="image/*" onChange={onPhotoChange} style={{ display: "none" }} />
        </label>

        {error && <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: "#e08a8a", marginBottom: 12 }}>{error}</p>}

        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "rgba(var(--text-rgb),0.5)" }}>
          {uploading ? "Envoi en cours…" : "Touchez le cercle pour choisir une photo"}
        </p>
      </GlassPanel>

      <button
        onClick={onLogout}
        style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "rgba(var(--text-rgb),0.5)", background: "none", border: "none", textDecoration: "underline", cursor: "pointer" }}
      >
        Se déconnecter
      </button>
    </div>
  );
}

function OnboardingModal({ name, onClose }) {
  const [step, setStep] = useState(0);
  const steps = [
    { icon: "🥂", title: `Bienvenue, ${name} !`, text: "Échec & Match combine rencontre, apéro et échecs. Petit tour du propriétaire en 4 étapes." },
    { icon: "👉", title: "Swipez", text: "Glissez une carte à droite pour trinquer, à gauche pour passer. Vous pouvez aussi filtrer par âge, niveau ou distance." },
    { icon: "💌", title: "Discutez", text: "En cas de match mutuel, une table s'ouvre : discutez dans l'onglet Matchs." },
    { icon: "♟️", title: "Jouez", text: "Lancez une partie avec votre match. Vous débutez ? Touchez une pièce : l'app vous montre où elle peut aller, et les règles sont à portée de clic." },
  ];
  const s = steps[step];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,6,10,0.7)", backdropFilter: "blur(6px)", padding: 24 }}>
      <GlassPanel className="em-fade-in em-modal" style={{ padding: 30, maxWidth: 340, textAlign: "center" }}>
        <div style={{ fontSize: 38, marginBottom: 10 }}>{s.icon}</div>
        <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: 20, color: "rgb(var(--text-rgb))", margin: "0 0 8px" }}>{s.title}</h3>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, lineHeight: 1.6, color: "rgba(var(--text-rgb),0.75)", margin: "0 0 20px" }}>{s.text}</p>
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 20 }}>
          {steps.map((_, i) => (
            <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: i === step ? "#cda45e" : "rgba(255,255,255,0.2)" }} />
          ))}
        </div>
        <button
          className="em-btn"
          onClick={() => (step < steps.length - 1 ? setStep((s2) => s2 + 1) : onClose())}
          style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, fontWeight: 600, color: "#170f1a", background: "linear-gradient(160deg, #f0dcae, #cda45e)", border: "none", borderRadius: 999, padding: "10px 26px", cursor: "pointer" }}
        >
          {step < steps.length - 1 ? "Suivant" : "C'est parti !"}
        </button>
      </GlassPanel>
    </div>
  );
}

function PremiumPromoModal({ onClose, onSeeProfile }) {
  const benefits = [
    { icon: "⭐", text: "Super Trinque — démarquez-vous auprès d'un profil qui vous plaît" },
    { icon: "↺", text: "Rewind — annulez votre dernier swipe" },
    { icon: "💌", text: "Qui m'a trinqué — voyez qui a swipé sur vous avant même de swiper" },
    { icon: "♾️", text: "Swipes illimités (25/jour pour les comptes gratuits)" },
    { icon: "♟️", text: "Thèmes de plateau exclusifs et historique de parties complet" },
  ];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,6,10,0.7)", backdropFilter: "blur(6px)", padding: 24 }}>
      <GlassPanel className="em-fade-in em-modal" style={{ padding: 30, maxWidth: 360, textAlign: "center", border: "1px solid rgba(205,164,94,0.4)" }}>
        <div style={{ fontSize: 38, marginBottom: 8 }}>⭐</div>
        <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: 21, color: "rgb(var(--text-rgb))", margin: "0 0 6px" }}>Passez Premium</h3>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12.5, lineHeight: 1.5, color: "rgba(var(--text-rgb),0.65)", margin: "0 0 18px" }}>
          Et c'est gratuit — pas de carte bancaire, jamais.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, textAlign: "left", marginBottom: 20 }}>
          {benefits.map((b, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16, flexShrink: 0, width: 22, textAlign: "center" }}>{b.icon}</span>
              <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12.5, color: "rgba(var(--text-rgb),0.85)", lineHeight: 1.4 }}>{b.text}</span>
            </div>
          ))}
        </div>

        <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "0 0 16px" }} />

        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "rgba(var(--text-rgb),0.6)", lineHeight: 1.6, margin: "0 0 20px", textAlign: "left" }}>
          <b style={{ color: "rgb(var(--text-rgb))" }}>Deux façons de l'obtenir :</b><br />
          🎁 Parrainez 2 personnes qui s'inscrivent et confirment leur email → <b>1 mois offert</b><br />
          📤 Faites ouvrir votre lien à 5 personnes différentes → <b>2 semaines</b>, renouvelable une fois votre Premium terminé
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            className="em-btn"
            onClick={onSeeProfile}
            style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13.5, fontWeight: 600, color: "#170f1a", background: "linear-gradient(160deg, #f0dcae, #cda45e)", border: "none", borderRadius: 999, padding: "12px 0", cursor: "pointer" }}
          >
            Voir mon lien de parrainage
          </button>
          <button
            onClick={onClose}
            style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12.5, color: "rgba(var(--text-rgb),0.55)", background: "none", border: "none", cursor: "pointer" }}
          >
            Plus tard
          </button>
        </div>
      </GlassPanel>
    </div>
  );
}

// ---------- Root ----------
export default function App() {
  const [authUser, setAuthUser] = useState(undefined); // undefined = loading, null = logged out
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState("profils");
  const [activeOpponentMatch, setActiveOpponentMatch] = useState(null); // { match, other }
  const [activeChatId, setActiveChatId] = useState(null);
  const [matchModal, setMatchModal] = useState(null);
  const [toast, setToast] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [onlineIds, setOnlineIds] = useState(new Set());
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showPremiumPromo, setShowPremiumPromo] = useState(false);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const hasReferralInUrl = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("ref");
  const [showAuthForm, setShowAuthForm] = useState(hasReferralInUrl);

  // Enregistre l'ouverture du lien de parrainage par CE navigateur (une
  // seule fois par visite) — c'est ça qui compte pour la récompense, pas le
  // clic sur "Partager" chez celui qui l'a envoyé.
  useEffect(() => {
    if (!hasReferralInUrl) return;
    const code = new URLSearchParams(window.location.search).get("ref");
    const visitorId = getOrCreateVisitorId();
    if (code && visitorId) {
      supabase.rpc("record_link_open", { p_referral_code: code, p_visitor_id: visitorId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [theme, setTheme] = useState(() => {
    if (typeof localStorage === "undefined") return "dark";
    return localStorage.getItem("em_theme") || "dark";
  });
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (typeof localStorage !== "undefined") localStorage.setItem("em_theme", next);
  };
  const [authInitialMode, setAuthInitialMode] = useState(hasReferralInUrl ? "register" : "login");

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      connectivityBus.dispatchEvent(new Event("reconnect"));
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const fireToast = (text) => { setToast(text); setTimeout(() => setToast(""), 2200); };

  const loadProfile = useCallback(async (userId) => {
    await Promise.all([
      supabase.rpc("settle_my_premium_status"),
      supabase.rpc("evaluate_referral_rewards"),
      supabase.rpc("evaluate_link_open_rewards"),
    ]);
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (data) {
      if (!data.visitor_id) {
        const visitorId = getOrCreateVisitorId();
        if (visitorId) {
          await supabase.from("profiles").update({ visitor_id: visitorId }).eq("id", userId);
          data.visitor_id = visitorId;
        }
      }
      setProfile(data);
      const key = `em_onboarded_${data.id}`;
      if (typeof localStorage !== "undefined" && !localStorage.getItem(key)) {
        setShowOnboarding(true);
        localStorage.setItem(key, "1");
      }
      const promoKey = `em_premium_promo_${data.id}`;
      if (!data.is_premium && typeof localStorage !== "undefined" && !localStorage.getItem(promoKey)) {
        setShowPremiumPromo(true);
        localStorage.setItem(promoKey, "1");
      }
    } else setProfile(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!profile) return;
    await Promise.all([
      supabase.rpc("settle_my_premium_status"),
      supabase.rpc("evaluate_referral_rewards"),
      supabase.rpc("evaluate_link_open_rewards"),
    ]);
    const { data } = await supabase.from("profiles").select("*").eq("id", profile.id).maybeSingle();
    if (data) setProfile(data);
  }, [profile]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthUser(session?.user ?? null);
      if (session?.user) loadProfile(session.user.id, session.user.email);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null);
      if (session?.user) loadProfile(session.user.id, session.user.email);
      else setProfile(null);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const refreshUnreadCount = useCallback(async () => {
    if (!profile) return;
    const { data: rows } = await supabase
      .from("matches")
      .select("id")
      .or(`user_a.eq.${profile.id},user_b.eq.${profile.id}`);
    const matchIds = (rows || []).map((m) => m.id);
    if (matchIds.length === 0) { setUnreadCount(0); return; }
    const { data: reads } = await supabase.from("match_reads").select("match_id, last_read_at").eq("user_id", profile.id);
    const readByMatch = {};
    (reads || []).forEach((r) => { readByMatch[r.match_id] = r.last_read_at; });
    const { data: incoming } = await supabase
      .from("messages")
      .select("match_id, created_at")
      .in("match_id", matchIds)
      .neq("sender_id", profile.id)
      .order("created_at", { ascending: false });
    const unreadMatches = new Set();
    (incoming || []).forEach((m) => {
      const lastRead = readByMatch[m.match_id];
      if (!lastRead || new Date(m.created_at) > new Date(lastRead)) unreadMatches.add(m.match_id);
    });
    setUnreadCount(unreadMatches.size);
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    refreshUnreadCount();
    const channel = supabase
      .channel("match-count")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "matches" }, (payload) => {
        refreshUnreadCount();
        const row = payload.new;
        if (row.user_a === profile.id || row.user_b === profile.id) {
          notifyIfHidden("Nouveau match ! 🥂", "Quelqu'un a trinqué avec vous sur Échec & Match.");
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [profile, refreshUnreadCount]);

  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel("global-messages")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, async (payload) => {
        const msg = payload.new;
        if (msg.sender_id === profile.id) return;
        if (msg.match_id === activeChatId && tab === "matchs") return;
        const { data: match } = await supabase.from("matches").select("*").eq("id", msg.match_id).maybeSingle();
        if (!match || (match.user_a !== profile.id && match.user_b !== profile.id)) return;
        refreshUnreadCount();
        const { data: sender } = await supabase.from("public_profiles").select("name").eq("id", msg.sender_id).maybeSingle();
        notifyIfHidden(`Message de ${sender?.name || "un match"}`, msg.text);
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [profile, activeChatId, tab, refreshUnreadCount]);

  useEffect(() => {
    if (!profile) return;
    const channel = supabase.channel("online-presence", { config: { presence: { key: profile.id } } });
    channel
      .on("presence", { event: "sync" }, () => {
        setOnlineIds(new Set(Object.keys(channel.presenceState())));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });
    return () => supabase.removeChannel(channel);
  }, [profile]);

  const handleLogin = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (/confirm/i.test(error.message)) {
        return { ok: false, error: "Votre email n'est pas encore confirmé. Vérifiez votre boîte de réception (et vos spams)." };
      }
      return { ok: false, error: "Email ou mot de passe incorrect." };
    }
    fireToast("Bon retour 🥂");
    return { ok: true };
  };

  const handleRegister = async (data) => {
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          name: data.name,
          age: data.age,
          birthdate: data.birthdate,
          gender: data.gender,
          looking_for: data.lookingFor,
          bio: data.bio,
          aperitif: data.aperitif,
          accepted_terms: data.acceptTerms === true,
          referral_code: data.referralCode || "",
        },
      },
    });
    if (signUpError) return { ok: false, error: signUpError.message };
    if (!signUpData.session) {
      return {
        ok: true,
        needsConfirmation: true,
        message: "Compte créé ! Vérifiez votre boîte mail pour confirmer votre adresse, puis connectez-vous.",
      };
    }
    fireToast(`Bienvenue à table, ${data.name} !`);
    return { ok: true };
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setTab("profils");
    setActiveOpponentMatch(null);
    setActiveChatId(null);
    setMatchModal(null);
  };

  const handleDeleteAccount = async () => {
    await supabase.rpc("delete_own_account");
    await supabase.auth.signOut();
    fireToast("Compte et données supprimés.");
  };

  const handleSaveProfile = async (updates) => {
    const { error } = await supabase.from("profiles").update(updates).eq("id", profile.id);
    if (error) {
      fireToast("Enregistrement impossible : " + error.message);
      return false;
    }
    setProfile((p) => ({ ...p, ...updates }));
    fireToast("Profil mis à jour");
    return true;
  };

  const handleMatch = (match, other) => setMatchModal({ match, other });

  const handlePlay = (match, other) => {
    setActiveOpponentMatch({ match, other });
    setTab("echiquier");
  };

  if (authUser === undefined) return <SplashScreen text="Connexion en cours…" />;

  return (
    <div data-theme={theme} style={{ minHeight: "100vh", width: "100%", position: "relative", overflow: "hidden", background: THEME_BG[theme], fontFamily: "'Outfit', sans-serif" }}>
      <link rel="stylesheet" href={FONTS_HREF} />
      <style>{GLOBAL_STYLES}</style>
      <OfflineBanner online={online} />
      <Toast text={toast} />

      <Bokeh top="-60px" left="-40px" size={260} color="rgba(205,164,94,0.35)" dur="14s" />
      <Bokeh top="30%" left="70%" size={200} color="rgba(109,36,56,0.45)" dur="18s" />
      <Bokeh top="70%" left="5%" size={180} color="rgba(79,93,67,0.35)" dur="16s" />

      <div style={{ position: "relative", zIndex: 1, maxWidth: 420, margin: "0 auto", padding: "28px 18px 90px" }}>
        <header style={{ textAlign: "center", marginBottom: 24, position: "relative" }}>
          <button
            onClick={toggleTheme}
            aria-label="Changer de thème"
            style={{ position: "absolute", left: 0, top: 0, cursor: "pointer", background: "rgba(var(--text-rgb),0.08)", border: "1px solid var(--panel-border)", borderRadius: "50%", width: 34, height: 34, fontSize: 15 }}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 30, margin: 0, color: "rgb(var(--text-rgb))" }}>Échec &amp; Match</h1>
          <p style={{ fontSize: 12.5, color: "rgba(var(--text-rgb),0.6)", marginTop: 6 }}>Un verre, un plateau, une rencontre</p>
          {profile && (
            <button onClick={() => setTab("profil")} style={{ position: "absolute", right: 0, top: 0, cursor: "pointer", background: "none", border: "none", padding: 0 }} aria-label="Mon profil">
              <Avatar initials={profile.initials} hue={profile.hue} photoUrl={profile.photo_url} size={38} />
            </button>
          )}
        </header>

        <main>
          {!authUser ? (
            showAuthForm ? (
              <AuthScreen onLogin={handleLogin} onRegister={handleRegister} initialMode={authInitialMode} onBackToLanding={() => setShowAuthForm(false)} />
            ) : (
              <LandingScreen
                onStart={(mode) => { setAuthInitialMode(mode); setShowAuthForm(true); }}
              />
            )
          ) : !profile ? (
            <GlassPanel style={{ padding: 28, textAlign: "center" }}>
              <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: "rgba(var(--text-rgb),0.65)", margin: "0 0 14px" }}>
                Votre inscription est en attente de confirmation par email, ou votre profil n'a pas pu être chargé.
              </p>
              <button className="em-btn" onClick={handleLogout} style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12.5, fontWeight: 600, color: "rgb(var(--text-rgb))", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999, padding: "9px 16px", cursor: "pointer" }}>
                Retour à la connexion
              </button>
            </GlassPanel>
          ) : !profile.photo_url ? (
            <MandatoryPhotoScreen
              profile={profile}
              onLogout={handleLogout}
              onUploaded={(url) => handleSaveProfile({ photo_url: url })}
            />
          ) : (
            <>
              {tab === "profils" && <ProfilesScreen profile={profile} onMatch={handleMatch} fireToast={fireToast} onlineIds={onlineIds} />}
              {tab === "matchs" && (
                <MatchesScreen profile={profile} onPlay={handlePlay} activeChatId={activeChatId} setActiveChatId={setActiveChatId} fireToast={fireToast} onlineIds={onlineIds} onUnreadChange={setUnreadCount} />
              )}
              {tab === "echiquier" &&
                (activeOpponentMatch ? (
                  <ChessScreen match={activeOpponentMatch.match} me={profile} opponent={activeOpponentMatch.other} fireToast={fireToast} />
                ) : (
                  <GlassPanel style={{ padding: 26, textAlign: "center" }}>
                    <p style={{ fontFamily: "'Fraunces', serif", fontSize: 17, color: "rgb(var(--text-rgb))", margin: 0 }}>Choisissez un match pour ouvrir la table</p>
                  </GlassPanel>
                ))}
              {tab === "profil" && <ProfileScreen profile={profile} onSave={handleSaveProfile} onLogout={handleLogout} onDeleteAccount={handleDeleteAccount} onRefreshProfile={refreshProfile} fireToast={fireToast} />}
              {tab === "admin" && profile.is_admin && <AdminScreen />}
            </>
          )}
        </main>
      </div>

      {matchModal && (
        <MatchModal
          profile={matchModal.other}
          onClose={() => setMatchModal(null)}
          onChat={() => { setActiveChatId(matchModal.match.id); setTab("matchs"); setMatchModal(null); }}
        />
      )}

      {showOnboarding && profile && (
        <OnboardingModal name={profile.name} onClose={() => setShowOnboarding(false)} />
      )}

      {!showOnboarding && showPremiumPromo && profile && profile.photo_url && (
        <PremiumPromoModal
          onClose={() => setShowPremiumPromo(false)}
          onSeeProfile={() => { setShowPremiumPromo(false); setTab("profil"); }}
        />
      )}

      {authUser && profile && profile.photo_url && (
        <nav style={{ position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", zIndex: 2, width: "calc(100% - 36px)", maxWidth: 380 }}>
          <GlassPanel style={{ padding: 8, display: "flex", justifyContent: "space-around" }}>
            <NavButton active={tab === "profils"} onClick={() => setTab("profils")} icon="🥂" label="Profils" />
            <NavButton active={tab === "matchs"} onClick={() => { setTab("matchs"); setActiveChatId(null); }} icon="💌" label="Matchs" badge={unreadCount} />
            <NavButton active={tab === "echiquier"} onClick={() => setTab("echiquier")} icon="♟" label="Échiquier" />
            <NavButton active={tab === "profil"} onClick={() => setTab("profil")} icon="👤" label="Profil" />
            {profile.is_admin && <NavButton active={tab === "admin"} onClick={() => setTab("admin")} icon="🛡️" label="Admin" />}
          </GlassPanel>
        </nav>
      )}
    </div>
  );
}
