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

export function inBounds(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

export function legalMoves(board, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  const color = piece[0];
  const type = piece[1];
  const enemy = color === "w" ? "b" : "w";
  const moves = [];

  const tryStep = (dr, dc) => {
    const nr = r + dr, nc = c + dc;
    if (!inBounds(nr, nc)) return;
    const target = board[nr][nc];
    if (!target || target[0] === enemy) moves.push([nr, nc]);
  };

  const slide = (dirs) => {
    for (const [dr, dc] of dirs) {
      let nr = r + dr, nc = c + dc;
      while (inBounds(nr, nc)) {
        const target = board[nr][nc];
        if (!target) {
          moves.push([nr, nc]);
        } else {
          if (target[0] === enemy) moves.push([nr, nc]);
          break;
        }
        nr += dr; nc += dc;
      }
    }
  };

  if (type === "p") {
    const dir = color === "w" ? -1 : 1;
    const startRow = color === "w" ? 6 : 1;
    if (inBounds(r + dir, c) && !board[r + dir][c]) {
      moves.push([r + dir, c]);
      if (r === startRow && !board[r + 2 * dir][c]) moves.push([r + 2 * dir, c]);
    }
    for (const dc of [-1, 1]) {
      const nr = r + dir, nc = c + dc;
      if (inBounds(nr, nc) && board[nr][nc] && board[nr][nc][0] === enemy) moves.push([nr, nc]);
    }
  } else if (type === "n") {
    [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(([dr,dc]) => tryStep(dr,dc));
  } else if (type === "k") {
    for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++) if (dr||dc) tryStep(dr,dc);
  } else if (type === "b") {
    slide([[-1,-1],[-1,1],[1,-1],[1,1]]);
  } else if (type === "r") {
    slide([[-1,0],[1,0],[0,-1],[0,1]]);
  } else if (type === "q") {
    slide([[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]);
  }
  return moves;
}

export function findKing(board, color) {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) if (board[r][c] === color + "k") return [r, c];
  return null;
}

export function isAttacked(board, r, c, byColor) {
  for (let sr = 0; sr < 8; sr++) {
    for (let sc = 0; sc < 8; sc++) {
      const p = board[sr][sc];
      if (p && p[0] === byColor) {
        const ms = legalMoves(board, sr, sc);
        if (ms.some(([mr, mc]) => mr === r && mc === c)) return true;
      }
    }
  }
  return false;
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
