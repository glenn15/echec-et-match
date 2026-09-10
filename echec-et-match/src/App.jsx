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

const BOARD_THEMES = {
  sauge: { label: "Sauge", dark: ["#4a5d43", "#3a4a35"], light: ["#d9d3b8", "#c9c2a4"] },
  ivoire: { label: "Ivoire", dark: ["#9c8f70", "#867a5f"], light: ["#f3ecd9", "#e6dcc2"] },
  nuit: { label: "Nuit", dark: ["#2b3a52", "#212c3f"], light: ["#8fa3bf", "#7891ad"] },
  bordeaux: { label: "Bordeaux", dark: ["#6d2438", "#54192a"], light: ["#e3c3b5", "#d3ac9c"] },
};

const GLOBAL_STYLES = `
@keyframes fadeSlideUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
@keyframes popIn { 0% { opacity: 0; transform: scale(0.85); } 60% { transform: scale(1.04); } 100% { opacity: 1; transform: scale(1); } }
@keyframes splashFade { 0% { opacity: 1; } 85% { opacity: 1; } 100% { opacity: 0; visibility: hidden; } }
* { box-sizing: border-box; }
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

// ---------- Glass primitives ----------
function GlassPanel({ children, style = {}, className = "" }) {
  return (
    <div
      className={className}
      style={{
        background: "linear-gradient(160deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04))",
        backdropFilter: "blur(22px) saturate(160%)",
        WebkitBackdropFilter: "blur(22px) saturate(160%)",
        border: "1px solid rgba(255,255,255,0.16)",
        borderRadius: 24,
        boxShadow: "0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.15)",
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
        color: "#f0dcae",
        background: "rgba(205,164,94,0.18)",
        border: "1px solid rgba(205,164,94,0.4)",
        borderRadius: 999,
        padding: "4px 10px",
      }}
    >
      ♟ {elo} Elo
    </span>
  );
}

function Chip({ label }) {
  return (
    <span
      style={{
        fontFamily: "'Outfit', sans-serif",
        fontSize: 12.5,
        color: "#f4ecdb",
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

function RoundButton({ onClick, label, symbol, tint, big, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        width: big ? 64 : 54,
        height: big ? 64 : 54,
        borderRadius: "50%",
        border: "1px solid rgba(255,255,255,0.22)",
        background: `radial-gradient(circle at 35% 30%, ${tint}, rgba(255,255,255,0.05))`,
        backdropFilter: "blur(14px)",
        color: "#f4ecdb",
        fontSize: big ? 24 : 20,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
        transition: "transform 0.15s ease",
      }}
      onMouseDown={(e) => !disabled && (e.currentTarget.style.transform = "scale(0.92)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
    >
      {symbol}
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
        color: "#f4ecdb",
        background: `radial-gradient(circle at 30% 25%, ${hue}dd, #170f1a)`,
        border: "1px solid rgba(255,255,255,0.16)",
      }}
    >
      {initials}
    </div>
  );
}

async function uploadAvatar(userId, file) {
  const ext = file.name.split(".").pop();
  const path = `${userId}/avatar.${ext}`;
  const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true, cacheControl: "3600" });
  if (error) return { ok: false, error: error.message };
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return { ok: true, url: `${data.publicUrl}?t=${Date.now()}` };
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
      <GlassPanel style={{ padding: 24, maxWidth: 380, maxHeight: "80vh", overflowY: "auto" }} className="em-fade-in">
        <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: "#f4ecdb", marginTop: 0 }}>CGU &amp; Confidentialité</h3>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12.5, lineHeight: 1.6, color: "rgba(244,236,219,0.75)" }}>
          Échec &amp; Match est réservé aux personnes de 18 ans ou plus. En créant un compte, vous acceptez que vos
          données (profil, messages, parties) soient stockées afin de faire fonctionner le service, et que d'autres
          utilisateurs puissent voir votre profil public. Vous pouvez demander la suppression de votre compte et de
          vos données à tout moment depuis votre profil. Les messages et signalements peuvent être examinés en cas
          de comportement abusif. Nous ne partageons pas vos données avec des tiers à des fins publicitaires.
        </p>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "rgba(244,236,219,0.5)" }}>
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
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 24, color: "#f4ecdb" }}>Échec &amp; Match</div>
      <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: "rgba(244,236,219,0.5)" }}>{text}</div>
    </div>
  );
}

function Toast({ text }) {
  if (!text) return null;
  return (
    <div style={{ position: "fixed", top: 18, left: "50%", transform: "translateX(-50%)", zIndex: 40, animation: "fadeSlideUp 0.3s ease both" }}>
      <GlassPanel style={{ padding: "10px 18px" }}>
        <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12.5, color: "#f4ecdb" }}>{text}</span>
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

const labelStyle = { display: "block", fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "rgba(244,236,219,0.6)", marginBottom: 5 };
const inputStyle = {
  width: "100%", boxSizing: "border-box", fontFamily: "'Outfit', sans-serif", fontSize: 13.5, color: "#f4ecdb",
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

// ---------- Auth ----------
function AuthScreen({ onLogin, onRegister }) {
  const [mode, setMode] = useState("login");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [showLegal, setShowLegal] = useState(false);
  const [fields, setFields] = useState({ email: "", password: "", name: "", birthdate: "", bio: "", aperitif: "", acceptTerms: false });

  const update = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));

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
        bio: fields.bio.trim() || "Nouveau·elle à la table, prêt·e pour un apéro et une partie.",
        aperitif: fields.aperitif.trim() || "À définir",
        acceptTerms: fields.acceptTerms === true,
      });
      setLoading(false);
      if (!res.ok) setError(res.error);
      else if (res.needsConfirmation) setInfo(res.message);
    }
  };

  const handleKeyDown = (e) => { if (e.key === "Enter") submit(); };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, paddingTop: 8 }}>
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
                color: mode === m ? "#170f1a" : "rgba(244,236,219,0.7)",
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
            </>
          )}
          <Field label="Email" value={fields.email} onChange={update("email")} placeholder="vous@exemple.fr" />
          <Field label="Mot de passe" value={fields.password} onChange={update("password")} placeholder="••••••••" type="password" />
          {mode === "register" && (
            <>
              <Field label="Apéro préféré" value={fields.aperitif} onChange={update("aperitif")} placeholder="Spritz maison" />
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
                <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "rgba(244,236,219,0.7)" }}>
                  Je certifie avoir 18 ans ou plus et j'accepte les{" "}
                  <span onClick={(e) => { e.preventDefault(); setShowLegal(true); }} style={{ color: "#f0dcae", textDecoration: "underline", cursor: "pointer" }}>
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
function ProfileScreen({ profile, onSave, onLogout, onDeleteAccount }) {
  const [form, setForm] = useState({ name: profile.name, age: profile.age, bio: profile.bio, aperitif: profile.aperitif });
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
  const update = (key) => (e) => { setForm((f) => ({ ...f, [key]: e.target.value })); setSaved(false); };

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("game_history")
        .select("*")
        .or(`winner_id.eq.${profile.id},loser_id.eq.${profile.id}`)
        .order("created_at", { ascending: false })
        .limit(20);
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
  }, [profile.id]);

  const setBoardTheme = (key) => onSave({ board_theme: key });

  const save = async () => {
    await onSave({ ...form, age: parseInt(form.age, 10) || profile.age });
    setSaved(true);
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

  const onPhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setPhotoError("Choisissez une image."); return; }
    if (file.size > 5 * 1024 * 1024) { setPhotoError("Image trop lourde (5 Mo max)."); return; }
    setPhotoError("");
    setUploading(true);
    const res = await uploadAvatar(profile.id, file);
    setUploading(false);
    if (!res.ok) { setPhotoError(res.error); return; }
    await onSave({ photo_url: res.url });
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
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: "#f4ecdb" }}>{profile.name}</div>
            <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: "rgba(244,236,219,0.6)" }}>{profile.email}</div>
            <div style={{ marginTop: 4 }}><EloBadge elo={profile.elo} /></div>
          </div>
        </div>
        {uploading && <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "rgba(244,236,219,0.6)" }}>Envoi de la photo…</p>}
        {photoError && <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "#e08a8a" }}>{photoError}</p>}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            onClick={shareLocation}
            disabled={locating}
            style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "#f4ecdb", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 999, padding: "6px 12px", cursor: locating ? "default" : "pointer" }}
          >
            {locating ? "Localisation…" : profile.lat ? "📍 Position partagée ✓" : "📍 Partager ma position"}
          </button>
          {notifStatus !== "unsupported" && notifStatus !== "granted" && (
            <button
              type="button"
              onClick={enableNotifications}
              style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "#f4ecdb", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 999, padding: "6px 12px", cursor: "pointer" }}
            >
              🔔 Activer les notifications
            </button>
          )}
          {notifStatus === "granted" && (
            <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "rgba(244,236,219,0.5)", alignSelf: "center" }}>🔔 Notifications activées</span>
          )}
        </div>
        {locationError && <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "#e08a8a", marginTop: -8 }}>{locationError}</p>}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Prénom" value={form.name} onChange={update("name")} />
          <Field label="Âge" value={form.age} onChange={update("age")} />
          <Field label="Apéro préféré" value={form.aperitif} onChange={update("aperitif")} />
          <div>
            <label style={labelStyle}>Bio</label>
            <textarea value={form.bio} onChange={update("bio")} rows={3} style={{ ...inputStyle, resize: "none", fontFamily: "'Outfit', sans-serif" }} />
          </div>
          <button
            type="button"
            className="em-btn"
            onClick={save}
            style={{
              fontFamily: "'Outfit', sans-serif", fontSize: 13, fontWeight: 600, color: "#170f1a",
              background: "linear-gradient(160deg, #f0dcae, #cda45e)", border: "none", borderRadius: 999,
              padding: "10px 0", cursor: "pointer",
            }}
          >
            {saved ? "Enregistré ✓" : "Enregistrer les modifications"}
          </button>
        </div>
      </GlassPanel>

      <GlassPanel style={{ padding: 20 }}>
        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "rgba(244,236,219,0.5)", marginBottom: 10 }}>THÈME DU PLATEAU</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {Object.entries(BOARD_THEMES).map(([key, t]) => (
            <button
              key={key}
              onClick={() => setBoardTheme(key)}
              style={{
                display: "flex", alignItems: "center", gap: 6, fontFamily: "'Outfit', sans-serif", fontSize: 11.5,
                color: "#f4ecdb", background: profile.board_theme === key ? "rgba(205,164,94,0.2)" : "rgba(255,255,255,0.06)",
                border: profile.board_theme === key ? "1px solid rgba(205,164,94,0.5)" : "1px solid rgba(255,255,255,0.14)",
                borderRadius: 999, padding: "6px 12px", cursor: "pointer",
              }}
            >
              <span style={{ display: "inline-grid", gridTemplateColumns: "1fr 1fr", width: 16, height: 16, borderRadius: 4, overflow: "hidden" }}>
                <span style={{ background: t.dark[0] }} />
                <span style={{ background: t.light[0] }} />
                <span style={{ background: t.light[0] }} />
                <span style={{ background: t.dark[0] }} />
              </span>
              {t.label}
            </button>
          ))}
        </div>
      </GlassPanel>

      {history && history.length > 0 && (
        <GlassPanel style={{ padding: 20 }}>
          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "rgba(244,236,219,0.5)", marginBottom: 10 }}>HISTORIQUE DES PARTIES</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {history.map((h) => {
              const won = h.winner_id === profile.id;
              const opponentName = historyNames[won ? h.loser_id : h.winner_id] || "un match";
              return (
                <div key={h.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "'Outfit', sans-serif", fontSize: 12.5 }}>
                  <span style={{ color: "rgba(244,236,219,0.8)" }}>
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
          fontFamily: "'Outfit', sans-serif", fontSize: 12, color: "rgba(244,236,219,0.6)", background: "none",
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
          <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: "rgba(244,236,219,0.75)", margin: "0 0 10px" }}>
            Cette action supprime définitivement votre profil, vos matchs, messages et parties. Confirmer ?
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setConfirmDelete(false)} style={{ flex: 1, fontFamily: "'Outfit', sans-serif", fontSize: 12, color: "#f4ecdb", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999, padding: "8px 0", cursor: "pointer" }}>
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
function ProfilesScreen({ profile, onMatch, fireToast, onlineIds = new Set() }) {
  const [candidates, setCandidates] = useState(null); // null = loading
  const [index, setIndex] = useState(0);
  const [exit, setExit] = useState(null);
  const [drag, setDrag] = useState({ active: false, x: 0, startX: 0 });
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ ageMin: 18, ageMax: 99, eloMin: 0, maxDistance: 0 });
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
    return data || [];
  }, []);

  const loadCandidates = useCallback(async () => {
    setIndex(0);
    setPage(0);
    setHasMore(true);
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
      if (p.elo < filters.eloMin) return false;
      if (filters.maxDistance > 0) {
        if (p.distance_km == null || p.distance_km > filters.maxDistance) return false;
      }
      return true;
    });
  }, [candidates, filters]);

  const current = filtered && filtered[index % Math.max(filtered.length, 1)];
  const currentDistance = current ? current.distance_km : null;

  useEffect(() => {
    if (candidates && hasMore && !loadingMore && candidates.length - index <= 5) {
      loadMore();
    }
  }, [candidates, index, hasMore, loadingMore, loadMore]);

  const advance = async (dir) => {
    if (!current) return;
    setExit(dir);
    setDrag({ active: false, x: 0, startX: 0 });
    const { error } = await supabase.from("swipes").insert({
      swiper_id: profile.id,
      swiped_id: current.id,
      direction: dir === "right" ? "right" : "left",
    });
    if (error) {
      fireToast("Trop rapide — patientez un instant avant de continuer à swiper.");
    } else if (dir === "right") {
      const a = profile.id < current.id ? profile.id : current.id;
      const b = profile.id < current.id ? current.id : profile.id;
      const { data: match } = await supabase.from("matches").select("*").eq("user_a", a).eq("user_b", b).maybeSingle();
      if (match) onMatch(match, current);
      else fireToast(`Swipe envoyé à ${current.name}`);
    }
    setTimeout(() => {
      setExit(null);
      setIndex((i) => i + 1);
    }, 260);
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
      <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "rgba(244,236,219,0.5)", marginBottom: 10 }}>FILTRES</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <Field label="Âge min" value={filters.ageMin} onChange={(e) => { setFilters((f) => ({ ...f, ageMin: parseInt(e.target.value, 10) || 18 })); setIndex(0); }} />
          <Field label="Âge max" value={filters.ageMax} onChange={(e) => { setFilters((f) => ({ ...f, ageMax: parseInt(e.target.value, 10) || 99 })); setIndex(0); }} />
        </div>
        <Field label="Elo minimum" value={filters.eloMin} onChange={(e) => { setFilters((f) => ({ ...f, eloMin: parseInt(e.target.value, 10) || 0 })); setIndex(0); }} />
        <Field
          label={profile.lat ? "Distance max (km, 0 = illimité)" : "Distance (activez votre position dans Profil)"}
          value={filters.maxDistance}
          onChange={(e) => { setFilters((f) => ({ ...f, maxDistance: parseInt(e.target.value, 10) || 0 })); setIndex(0); }}
        />
      </div>
    </GlassPanel>
  );

  const FilterToggle = () => (
    <button
      className="em-btn"
      onClick={() => setShowFilters((v) => !v)}
      style={{
        fontFamily: "'Outfit', sans-serif", fontSize: 11.5, color: "#f4ecdb", background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.16)", borderRadius: 999, padding: "6px 14px", cursor: "pointer", marginBottom: 4,
      }}
    >
      {showFilters ? "Masquer les filtres ▲" : "Filtres ▼"}
    </button>
  );

  if (filtered === null) {
    return (
      <GlassPanel className="em-fade-in" style={{ padding: 30, textAlign: "center" }}>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: "rgba(244,236,219,0.65)", margin: 0 }}>Chargement des profils…</p>
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
          <p style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: "#f4ecdb", margin: 0 }}>
            {candidates.length === 0 ? "Vous avez fait le tour de la salle" : "Aucun profil ne correspond à vos filtres"}
          </p>
          <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: "rgba(244,236,219,0.65)", margin: "8px 0 18px" }}>
            {candidates.length === 0 ? "Revenez plus tard pour de nouveaux profils." : "Essayez d'élargir vos critères."}
          </p>
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
        </GlassPanel>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
      <FilterToggle />
      {showFilters && <FilterPanel />}
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
              background: current.photo_url ? "#170f1a" : `radial-gradient(circle at 30% 20%, ${current.hue}dd, ${current.hue}55 60%, #170f1a)`,
              border: "1px solid rgba(255,255,255,0.14)",
            }}
          >
            {current.photo_url ? (
              <img src={current.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              current.initials
            )}
            {onlineIds.has(current.id) && (
              <span style={{ position: "absolute", top: 12, left: 12, display: "flex", alignItems: "center", gap: 5, fontFamily: "'Outfit', sans-serif", fontSize: 10.5, fontWeight: 600, color: "#f4ecdb", background: "rgba(0,0,0,0.4)", borderRadius: 999, padding: "4px 9px" }}>
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
          </div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
            <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 26, margin: 0, color: "#f4ecdb" }}>
              {current.name}, {current.age}
            </h2>
            <EloBadge elo={current.elo} />
          </div>
          <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 14.5, lineHeight: 1.55, color: "rgba(244,236,219,0.82)", margin: "8px 0 14px" }}>
            {current.bio}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Chip label={`🥂 ${current.aperitif}`} />
            {currentDistance !== null && <Chip label={`📍 ${currentDistance} km`} />}
          </div>
        </GlassPanel>
      </div>

      <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "rgba(244,236,219,0.4)", margin: 0 }}>
        Glissez la carte, ou utilisez les boutons
      </p>

      <div style={{ display: "flex", gap: 20 }}>
        <RoundButton onClick={() => advance("left")} label="Passer" symbol="✕" tint="rgba(220,90,90,0.28)" />
        <RoundButton onClick={() => advance("right")} label="Trinquer" symbol="🥂" tint="rgba(205,164,94,0.32)" big />
      </div>
    </div>
  );
}

// ---------- Matches / chat ----------
function MatchesScreen({ profile, onPlay, activeChatId, setActiveChatId, fireToast, onlineIds = new Set() }) {
  const [matches, setMatches] = useState(null);

  const loadMatches = useCallback(async () => {
    const { data: rows } = await supabase
      .from("matches")
      .select("*")
      .or(`user_a.eq.${profile.id},user_b.eq.${profile.id}`)
      .order("created_at", { ascending: false });
    if (!rows) { setMatches([]); return; }
    const { data: blocked } = await supabase.from("blocked_users").select("blocked_id").eq("blocker_id", profile.id);
    const blockedIds = new Set((blocked || []).map((b) => b.blocked_id));
    const otherIds = rows.map((m) => (m.user_a === profile.id ? m.user_b : m.user_a)).filter((id) => !blockedIds.has(id));
    const { data: otherProfiles } = otherIds.length
      ? await supabase.from("public_profiles").select("*").in("id", otherIds)
      : { data: [] };
    const merged = rows.map((m) => {
      const otherId = m.user_a === profile.id ? m.user_b : m.user_a;
      const other = (otherProfiles || []).find((p) => p.id === otherId);
      return { match: m, profile: other };
    }).filter((m) => m.profile);
    setMatches(merged);
  }, [profile.id]);

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
        fireToast={fireToast}
      />
    );
  }

  if (matches === null) {
    return (
      <GlassPanel style={{ padding: 28, textAlign: "center" }}>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: "rgba(244,236,219,0.65)", margin: 0 }}>Chargement…</p>
      </GlassPanel>
    );
  }

  if (matches.length === 0) {
    return (
      <GlassPanel style={{ padding: 28, textAlign: "center" }}>
        <p style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: "#f4ecdb", margin: 0 }}>Aucun match pour l'instant</p>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13.5, color: "rgba(244,236,219,0.7)", marginTop: 8 }}>
          Trinquez avec un profil pour ouvrir une table et lancer une partie.
        </p>
      </GlassPanel>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {matches.map(({ match, profile: other }) => (
        <GlassPanel key={match.id} className="em-list-row" style={{ padding: 16, display: "flex", alignItems: "center", gap: 14 }}>
          <div onClick={() => setActiveChatId(match.id)} style={{ cursor: "pointer", position: "relative" }}>
            <Avatar initials={other.initials} hue={other.hue} photoUrl={other.photo_url} />
            {onlineIds.has(other.id) && (
              <span style={{ position: "absolute", bottom: 0, right: 0, width: 11, height: 11, borderRadius: "50%", background: "#7fd88f", border: "2px solid #170f1a", boxShadow: "0 0 6px #7fd88f" }} />
            )}
          </div>
          <div style={{ flex: 1, cursor: "pointer" }} onClick={() => setActiveChatId(match.id)}>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, color: "#f4ecdb" }}>{other.name}</div>
            <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12.5, color: "rgba(244,236,219,0.65)" }}>
              🥂 {other.aperitif} · ♟ {other.elo} Elo
            </div>
          </div>
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
        color: danger ? "#e08a8a" : "#f4ecdb", background: "none", border: "none", borderRadius: 10,
        padding: "8px 10px", cursor: "pointer",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
    >
      {label}
    </button>
  );
}

function ChatScreen({ matchId, me, other, onBack, onBlocked, onUnmatched, fireToast }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const bottomRef = useRef(null);

  const reloadMessages = useCallback(async () => {
    const { data } = await supabase.from("messages").select("*").eq("match_id", matchId).order("created_at", { ascending: true });
    setMessages(data || []);
  }, [matchId]);

  useEffect(() => {
    reloadMessages();
    const channel = supabase
      .channel(`messages-${matchId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `match_id=eq.${matchId}` }, (payload) => {
        setMessages((prev) => (prev.some((m) => m.id === payload.new.id) ? prev : [...prev, payload.new]));
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
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
      <div style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
        <button onClick={onBack} aria-label="Retour" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: "50%", width: 34, height: 34, color: "#f4ecdb", cursor: "pointer" }}>
          ←
        </button>
        <span style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: "#f4ecdb", flex: 1 }}>{other.name}</span>
        <button onClick={() => setMenuOpen((v) => !v)} aria-label="Options" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: "50%", width: 34, height: 34, color: "#f4ecdb", cursor: "pointer" }}>
          ⋯
        </button>
        {menuOpen && (
          <div style={{ position: "absolute", top: 40, right: 0, zIndex: 5 }}>
            <GlassPanel style={{ padding: 8, minWidth: 160 }}>
              {!reportOpen ? (
                <>
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
          <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: "rgba(244,236,219,0.6)", margin: "auto" }}>
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
              color: msg.sender_id === me.id ? "#170f1a" : "#f4ecdb",
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
          <button key={quick} onClick={() => send(quick)} style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: "#f4ecdb", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 999, padding: "6px 12px", cursor: "pointer" }}>
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
          style={{ flex: 1, fontFamily: "'Outfit', sans-serif", fontSize: 13.5, color: "#f4ecdb", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999, padding: "10px 16px", outline: "none" }}
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
      <GlassPanel style={{ padding: 28, textAlign: "center", maxWidth: 320 }} className="em-fade-in">
        <div style={{ fontSize: 36, marginBottom: 6 }}>🥂</div>
        <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 24, color: "#f4ecdb", margin: "0 0 6px" }}>Nouveau match !</h2>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13.5, color: "rgba(244,236,219,0.75)", margin: "0 0 20px" }}>
          Vous et {profile.name} avez trinqué. La table vous attend.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button className="em-btn" onClick={onClose} style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12.5, fontWeight: 600, color: "#f4ecdb", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999, padding: "9px 16px", cursor: "pointer" }}>
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
function ChessScreen({ match, me, opponent, fireToast }) {
  const [game, setGame] = useState(null);
  const [selected, setSelected] = useState(null);
  const myColor = match.user_a === me.id ? "w" : "b";
  const theme = BOARD_THEMES[me.board_theme] || BOARD_THEMES.sauge;

  const loadOrCreateGame = useCallback(async () => {
    const { data: existing } = await supabase.from("games").select("*").eq("match_id", match.id).maybeSingle();
    if (existing) { setGame(existing); return; }
    const fresh = { match_id: match.id, board: START_BOARD, turn: "w", captured_w: [], captured_b: [], log: [] };
    const { data: created } = await supabase.from("games").insert(fresh).select().maybeSingle();
    setGame(created || fresh);
  }, [match.id]);

  useEffect(() => {
    loadOrCreateGame();
    const channel = supabase
      .channel(`game-${match.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games", filter: `match_id=eq.${match.id}` }, (payload) => {
        setGame(payload.new);
        setSelected(null);
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [match.id, loadOrCreateGame]);

  useReconnect(loadOrCreateGame);

  const board = game?.board || START_BOARD;
  const turn = game?.turn || "w";
  const captured = { w: game?.captured_w || [], b: game?.captured_b || [] };
  const log = game?.log || [];
  const winner = game?.winner_id ? (game.winner_id === me.id ? "Vous" : opponent.name) : null;
  const myTurn = turn === myColor && !winner;

  const moves = useMemo(() => (selected && myTurn ? legalMoves(board, selected[0], selected[1]) : []), [board, selected, myTurn]);

  const enemyColor = turn === "w" ? "b" : "w";
  const kingPos = findKing(board, turn);
  const inCheck = !winner && kingPos && isAttacked(board, kingPos[0], kingPos[1], enemyColor);

  const handleSquare = async (r, c) => {
    if (!game || winner || !myTurn) return;
    const piece = board[r][c];
    if (selected) {
      const isMove = moves.some(([mr, mc]) => mr === r && mc === c);
      if (isMove) {
        const capturedPiece = board[r][c];
        const { data, error } = await supabase.rpc("make_chess_move", {
          p_game_id: game.id,
          p_from_r: selected[0],
          p_from_c: selected[1],
          p_to_r: r,
          p_to_c: c,
        });

        if (error) {
          // Le serveur a rejeté le coup (hors tour ou illégal) — on recharge
          // l'état réel de la partie plutôt que de laisser l'UI désynchronisée.
          fireToast?.("Coup refusé par le serveur, partie resynchronisée.");
          loadOrCreateGame();
        } else if (data?.winner_id) {
          fireToast?.(capturedPiece ? "Échec et mat ! Votre Elo vient d'évoluer 📈" : "Échec et mat ! 📈");
        }
        setSelected(null);
        return;
      }
      if (piece && piece[0] === myColor) setSelected([r, c]);
      else setSelected(null);
    } else if (piece && piece[0] === myColor) {
      setSelected([r, c]);
    }
  };

  const reset = async () => {
    await supabase
      .from("games")
      .update({ board: START_BOARD, turn: "w", turn_user_id: match.user_a, captured_w: [], captured_b: [], log: [], winner_id: null, updated_at: new Date().toISOString() })
      .eq("id", game.id);
    setSelected(null);
  };

  const score = (color) => captured[color].reduce((sum, p) => sum + PIECE_VALUE[p[1]], 0);

  if (!game) {
    return (
      <GlassPanel style={{ padding: 28, textAlign: "center" }}>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: "rgba(244,236,219,0.65)", margin: 0 }}>Installation de la table…</p>
      </GlassPanel>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <GlassPanel style={{ padding: "10px 18px", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: "rgba(244,236,219,0.85)" }}>
          Table avec <b style={{ color: "#f0dcae" }}>{opponent.name}</b> · vous jouez les {myColor === "w" ? "blancs" : "noirs"}
        </span>
      </GlassPanel>

      <CapturedTray pieces={captured.b} label={`${opponent.name} a pris (+${score("b")})`} />

      <GlassPanel style={{ padding: "14px 12px 6px" }}>
        <div style={{ display: "flex" }}>
          <div style={{ display: "grid", gridTemplateRows: "repeat(8, 1fr)", width: 16, height: 304, marginRight: 3 }}>
            {[8, 7, 6, 5, 4, 3, 2, 1].map((n) => (
              <span key={n} style={{ fontFamily: "'Outfit', sans-serif", fontSize: 9, color: "rgba(244,236,219,0.4)", display: "flex", alignItems: "center" }}>{n}</span>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", width: 304, height: 304, borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.18)", boxShadow: "inset 0 2px 12px rgba(0,0,0,0.4)" }}>
            {board.map((row, r) =>
              row.map((piece, c) => {
                const dark = (r + c) % 2 === 1;
                const isSelected = selected && selected[0] === r && selected[1] === c;
                const isMoveTarget = moves.some(([mr, mc]) => mr === r && mc === c);
                return (
                  <div
                    key={`${r}-${c}`}
                    className="em-square"
                    onClick={() => handleSquare(r, c)}
                    style={{
                      width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24,
                      cursor: myTurn ? "pointer" : "default", position: "relative",
                      background: dark ? `linear-gradient(160deg, ${theme.dark[0]}, ${theme.dark[1]})` : `linear-gradient(160deg, ${theme.light[0]}, ${theme.light[1]})`,
                      color: piece[0] === "w" ? "#f4ecdb" : "#1a1210",
                      textShadow: piece[0] === "w" ? "0 1px 2px rgba(0,0,0,0.5)" : "none",
                      outline: isSelected ? "2px solid #cda45e" : "none",
                      outlineOffset: -2,
                    }}
                  >
                    {piece && GLYPHS[piece]}
                    {isMoveTarget && (
                      <span style={{ position: "absolute", width: piece ? 34 : 10, height: piece ? 34 : 10, borderRadius: "50%", border: piece ? "2px solid rgba(205,164,94,0.8)" : "none", background: piece ? "transparent" : "rgba(205,164,94,0.7)" }} />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
        <div style={{ display: "flex", paddingLeft: 19, marginTop: 4 }}>
          {["a", "b", "c", "d", "e", "f", "g", "h"].map((f) => (
            <span key={f} style={{ width: 38, textAlign: "center", fontFamily: "'Outfit', sans-serif", fontSize: 9, color: "rgba(244,236,219,0.4)" }}>{f}</span>
          ))}
        </div>
      </GlassPanel>

      <CapturedTray pieces={captured.w} label={`Vous avez pris (+${score("w")})`} />

      <GlassPanel style={{ padding: "8px 16px" }}>
        <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: winner ? "#f0dcae" : inCheck ? "#e08a8a" : "#f0dcae" }}>
          {winner ? `Échec et mat — ${winner} gagne 🥂` : inCheck ? `Échec au roi ${turn === "w" ? "blanc" : "noir"} !` : myTurn ? "À vous de jouer" : `${opponent.name} réfléchit…`}
        </span>
      </GlassPanel>

      {log.length > 0 && (
        <GlassPanel style={{ padding: "12px 16px", width: "100%", maxWidth: 304, maxHeight: 120, overflowY: "auto" }}>
          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 10.5, color: "rgba(244,236,219,0.5)", marginBottom: 6 }}>HISTORIQUE</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px" }}>
            {log.map((entry, i) => (
              <span key={i} style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: "rgba(244,236,219,0.8)" }}>{i + 1}. {entry}</span>
            ))}
          </div>
        </GlassPanel>
      )}

      <button className="em-btn" onClick={reset} style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12.5, fontWeight: 600, color: "#170f1a", background: "linear-gradient(160deg, #f0dcae, #cda45e)", border: "none", borderRadius: 999, padding: "8px 16px", cursor: "pointer" }}>
        Nouvelle partie
      </button>
    </div>
  );
}

function CapturedTray({ pieces, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 20 }}>
      <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "rgba(244,236,219,0.55)" }}>{label}:</span>
      <div style={{ display: "flex", gap: 2 }}>
        {pieces.map((p, i) => (
          <span key={i} style={{ fontSize: 16, color: p[0] === "w" ? "#f4ecdb" : "#a99b7f" }}>{GLYPHS[p]}</span>
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
        padding: "8px 18px", cursor: "pointer", color: active ? "#f0dcae" : "rgba(244,236,219,0.6)",
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

function OnboardingModal({ name, onClose }) {
  const [step, setStep] = useState(0);
  const steps = [
    { icon: "🥂", title: `Bienvenue, ${name} !`, text: "Échec & Match combine rencontre, apéro et échecs. Petit tour du propriétaire en 4 étapes." },
    { icon: "👉", title: "Swipez", text: "Glissez une carte à droite pour trinquer, à gauche pour passer. Vous pouvez aussi filtrer par âge, Elo ou distance." },
    { icon: "💌", title: "Discutez", text: "En cas de match mutuel, une table s'ouvre : discutez dans l'onglet Matchs." },
    { icon: "♟️", title: "Jouez", text: "Lancez une vraie partie d'échecs avec votre match, en temps réel. Votre Elo évolue selon les résultats." },
  ];
  const s = steps[step];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,6,10,0.7)", backdropFilter: "blur(6px)", padding: 24 }}>
      <GlassPanel className="em-fade-in" style={{ padding: 30, maxWidth: 340, textAlign: "center" }}>
        <div style={{ fontSize: 38, marginBottom: 10 }}>{s.icon}</div>
        <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: 20, color: "#f4ecdb", margin: "0 0 8px" }}>{s.title}</h3>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, lineHeight: 1.6, color: "rgba(244,236,219,0.75)", margin: "0 0 20px" }}>{s.text}</p>
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

// ---------- Root ----------
export default function App() {
  const [authUser, setAuthUser] = useState(undefined); // undefined = loading, null = logged out
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState("profils");
  const [activeOpponentMatch, setActiveOpponentMatch] = useState(null); // { match, other }
  const [activeChatId, setActiveChatId] = useState(null);
  const [matchModal, setMatchModal] = useState(null);
  const [toast, setToast] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [onlineIds, setOnlineIds] = useState(new Set());
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

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
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (data) {
      setProfile(data);
      const key = `em_onboarded_${data.id}`;
      if (typeof localStorage !== "undefined" && !localStorage.getItem(key)) {
        setShowOnboarding(true);
        localStorage.setItem(key, "1");
      }
    } else setProfile(null);
  }, []);

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

  useEffect(() => {
    if (!profile) return;
    const refreshCount = async () => {
      const { count } = await supabase
        .from("matches")
        .select("*", { count: "exact", head: true })
        .or(`user_a.eq.${profile.id},user_b.eq.${profile.id}`);
      setMatchCount(count || 0);
    };
    refreshCount();
    const channel = supabase
      .channel("match-count")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "matches" }, (payload) => {
        refreshCount();
        const row = payload.new;
        if (row.user_a === profile.id || row.user_b === profile.id) {
          notifyIfHidden("Nouveau match ! 🥂", "Quelqu'un a trinqué avec vous sur Échec & Match.");
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [profile]);

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
        const { data: sender } = await supabase.from("public_profiles").select("name").eq("id", msg.sender_id).maybeSingle();
        notifyIfHidden(`Message de ${sender?.name || "un match"}`, msg.text);
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [profile, activeChatId, tab]);

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
          bio: data.bio,
          aperitif: data.aperitif,
          accepted_terms: data.acceptTerms === true,
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
    await supabase.from("profiles").update(updates).eq("id", profile.id);
    setProfile((p) => ({ ...p, ...updates }));
    fireToast("Profil mis à jour");
  };

  const handleMatch = (match, other) => setMatchModal({ match, other });

  const handlePlay = (match, other) => {
    setActiveOpponentMatch({ match, other });
    setTab("echiquier");
  };

  if (authUser === undefined) return <SplashScreen text="Connexion en cours…" />;

  return (
    <div style={{ minHeight: "100vh", width: "100%", position: "relative", overflow: "hidden", background: "radial-gradient(circle at 20% 0%, #2a1520 0%, #170f1a 45%, #0e0810 100%)", fontFamily: "'Outfit', sans-serif" }}>
      <link rel="stylesheet" href={FONTS_HREF} />
      <style>{GLOBAL_STYLES}</style>
      <OfflineBanner online={online} />
      <Toast text={toast} />

      <Bokeh top="-60px" left="-40px" size={260} color="rgba(205,164,94,0.35)" dur="14s" />
      <Bokeh top="30%" left="70%" size={200} color="rgba(109,36,56,0.45)" dur="18s" />
      <Bokeh top="70%" left="5%" size={180} color="rgba(79,93,67,0.35)" dur="16s" />

      <div style={{ position: "relative", zIndex: 1, maxWidth: 420, margin: "0 auto", padding: "28px 18px 90px" }}>
        <header style={{ textAlign: "center", marginBottom: 24, position: "relative" }}>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 30, margin: 0, color: "#f4ecdb" }}>Échec &amp; Match</h1>
          <p style={{ fontSize: 12.5, color: "rgba(244,236,219,0.6)", marginTop: 6 }}>Un verre, un plateau, une rencontre</p>
          {profile && (
            <button onClick={() => setTab("profil")} style={{ position: "absolute", right: 0, top: 0, cursor: "pointer", background: "none", border: "none", padding: 0 }} aria-label="Mon profil">
              <Avatar initials={profile.initials} hue={profile.hue} photoUrl={profile.photo_url} size={38} />
            </button>
          )}
        </header>

        <main>
          {!authUser ? (
            <AuthScreen onLogin={handleLogin} onRegister={handleRegister} />
          ) : !profile ? (
            <GlassPanel style={{ padding: 28, textAlign: "center" }}>
              <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: "rgba(244,236,219,0.65)", margin: "0 0 14px" }}>
                Votre inscription est en attente de confirmation par email, ou votre profil n'a pas pu être chargé.
              </p>
              <button className="em-btn" onClick={handleLogout} style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12.5, fontWeight: 600, color: "#f4ecdb", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999, padding: "9px 16px", cursor: "pointer" }}>
                Retour à la connexion
              </button>
            </GlassPanel>
          ) : (
            <>
              {tab === "profils" && <ProfilesScreen profile={profile} onMatch={handleMatch} fireToast={fireToast} onlineIds={onlineIds} />}
              {tab === "matchs" && (
                <MatchesScreen profile={profile} onPlay={handlePlay} activeChatId={activeChatId} setActiveChatId={setActiveChatId} fireToast={fireToast} onlineIds={onlineIds} />
              )}
              {tab === "echiquier" &&
                (activeOpponentMatch ? (
                  <ChessScreen match={activeOpponentMatch.match} me={profile} opponent={activeOpponentMatch.other} fireToast={fireToast} />
                ) : (
                  <GlassPanel style={{ padding: 26, textAlign: "center" }}>
                    <p style={{ fontFamily: "'Fraunces', serif", fontSize: 17, color: "#f4ecdb", margin: 0 }}>Choisissez un match pour ouvrir la table</p>
                  </GlassPanel>
                ))}
              {tab === "profil" && <ProfileScreen profile={profile} onSave={handleSaveProfile} onLogout={handleLogout} onDeleteAccount={handleDeleteAccount} />}
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

      {authUser && profile && (
        <nav style={{ position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", zIndex: 2, width: "calc(100% - 36px)", maxWidth: 380 }}>
          <GlassPanel style={{ padding: 8, display: "flex", justifyContent: "space-around" }}>
            <NavButton active={tab === "profils"} onClick={() => setTab("profils")} icon="🥂" label="Profils" />
            <NavButton active={tab === "matchs"} onClick={() => { setTab("matchs"); setActiveChatId(null); }} icon="💌" label="Matchs" badge={matchCount} />
            <NavButton active={tab === "echiquier"} onClick={() => setTab("echiquier")} icon="♟" label="Échiquier" />
            <NavButton active={tab === "profil"} onClick={() => setTab("profil")} icon="👤" label="Profil" />
          </GlassPanel>
        </nav>
      )}
    </div>
  );
}
