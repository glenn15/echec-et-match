// ============================================================
// Moteur d'échecs — règles officielles.
// Doit rester STRICTEMENT aligné avec les fonctions SQL chess_*()
// du schéma : c'est le serveur qui fait foi, ce fichier sert à
// afficher les coups possibles, l'échec, le mat et le pat.
//
// Plateau : board[ligne][colonne], ligne 0 = rangée 8 (côté noir),
// ligne 7 = rangée 1 (côté blanc). Pièce = couleur + type ("wk", "bp"…).
// État annexe : { castling: "KQkq", ep: [ligne, colonne] | null }.
// ============================================================

export const START_BOARD = [
  ["br", "bn", "bb", "bq", "bk", "bb", "bn", "br"],
  ["bp", "bp", "bp", "bp", "bp", "bp", "bp", "bp"],
  ["", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["wp", "wp", "wp", "wp", "wp", "wp", "wp", "wp"],
  ["wr", "wn", "wb", "wq", "wk", "wb", "wn", "wr"],
];

export const GLYPHS = {
  wk: "♔", wq: "♕", wr: "♖", wb: "♗", wn: "♘", wp: "♙",
  bk: "♚", bq: "♛", br: "♜", bb: "♝", bn: "♞", bp: "♟",
};

export const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

export function inBounds(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function at(board, r, c) {
  return inBounds(r, c) ? board[r][c] || "" : null;
}

// La case (r, c) est-elle attaquée par une pièce de couleur byColor ?
export function isAttacked(board, r, c, byColor) {
  const pawnRow = byColor === "w" ? r + 1 : r - 1; // un pion blanc attaque vers le haut
  if (at(board, pawnRow, c - 1) === byColor + "p" || at(board, pawnRow, c + 1) === byColor + "p") return true;
  for (const [dr, dc] of KNIGHT) if (at(board, r + dr, c + dc) === byColor + "n") return true;
  for (const [dr, dc] of KING) if (at(board, r + dr, c + dc) === byColor + "k") return true;
  const rays = (dirs, types) => {
    for (const [dr, dc] of dirs) {
      for (let i = 1; ; i++) {
        const p = at(board, r + dr * i, c + dc * i);
        if (p === null) break;
        if (p) {
          if (p[0] === byColor && types.includes(p[1])) return true;
          break;
        }
      }
    }
    return false;
  };
  return rays(ORTHO, "rq") || rays(DIAG, "bq");
}

export function findKing(board, color) {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) if (board[r][c] === color + "k") return [r, c];
  return null;
}

// Joue un coup (déjà validé) et renvoie le nouveau plateau :
// gère la prise en passant, le roque et la promotion.
export function applyMove(board, fr, fc, tr, tc, promo = "q") {
  const nb = board.map((row) => [...row]);
  let piece = nb[fr][fc];
  const target = nb[tr][tc];
  nb[fr][fc] = "";
  if (piece[1] === "p" && fc !== tc && !target) nb[fr][tc] = ""; // en passant
  if (piece[1] === "k" && Math.abs(tc - fc) === 2) {
    if (tc > fc) { nb[fr][5] = piece[0] + "r"; nb[fr][7] = ""; }
    else { nb[fr][3] = piece[0] + "r"; nb[fr][0] = ""; }
  }
  if (piece[1] === "p" && (tr === 0 || tr === 7)) piece = piece[0] + ("qrbn".includes(promo) ? promo : "q");
  nb[tr][tc] = piece;
  return nb;
}

function pseudoMoves(board, r, c, state) {
  const piece = board[r][c];
  if (!piece) return [];
  const color = piece[0];
  const type = piece[1];
  const enemy = color === "w" ? "b" : "w";
  const moves = [];
  const add = (tr, tc) => moves.push([tr, tc]);

  if (type === "p") {
    const dir = color === "w" ? -1 : 1;
    const start = color === "w" ? 6 : 1;
    if (at(board, r + dir, c) === "") {
      add(r + dir, c);
      if (r === start && at(board, r + 2 * dir, c) === "") add(r + 2 * dir, c);
    }
    for (const dc of [-1, 1]) {
      const t = at(board, r + dir, c + dc);
      if (t && t[0] === enemy) add(r + dir, c + dc);
      else if (t === "" && state?.ep && state.ep[0] === r + dir && state.ep[1] === c + dc) add(r + dir, c + dc);
    }
  } else if (type === "n" || type === "k") {
    for (const [dr, dc] of type === "n" ? KNIGHT : KING) {
      const t = at(board, r + dr, c + dc);
      if (t !== null && (t === "" || t[0] === enemy)) add(r + dr, c + dc);
    }
    if (type === "k") {
      const home = color === "w" ? 7 : 0;
      const rights = state?.castling ?? "";
      if (r === home && c === 4 && !isAttacked(board, home, 4, enemy)) {
        if (rights.includes(color === "w" ? "K" : "k") && board[home][7] === color + "r" &&
            !board[home][5] && !board[home][6] &&
            !isAttacked(board, home, 5, enemy) && !isAttacked(board, home, 6, enemy)) add(home, 6);
        if (rights.includes(color === "w" ? "Q" : "q") && board[home][0] === color + "r" &&
            !board[home][1] && !board[home][2] && !board[home][3] &&
            !isAttacked(board, home, 3, enemy) && !isAttacked(board, home, 2, enemy)) add(home, 2);
      }
    }
  } else {
    const dirs = type === "b" ? DIAG : type === "r" ? ORTHO : [...DIAG, ...ORTHO];
    for (const [dr, dc] of dirs) {
      for (let i = 1; ; i++) {
        const t = at(board, r + dr * i, c + dc * i);
        if (t === null) break;
        if (t === "") { add(r + dr * i, c + dc * i); continue; }
        if (t[0] === enemy) add(r + dr * i, c + dc * i);
        break;
      }
    }
  }
  return moves;
}

// Coups réellement jouables pour la pièce en (r, c) : on retire ceux
// qui laisseraient son propre roi en échec.
export function legalMoves(board, r, c, state) {
  const piece = board[r][c];
  if (!piece) return [];
  const color = piece[0];
  const enemy = color === "w" ? "b" : "w";
  return pseudoMoves(board, r, c, state).filter(([tr, tc]) => {
    const nb = applyMove(board, r, c, tr, tc);
    const king = piece[1] === "k" ? [tr, tc] : findKing(nb, color);
    return king && !isAttacked(nb, king[0], king[1], enemy);
  });
}

export function squareName(r, c) {
  return "abcdefgh"[c] + (8 - r);
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}
