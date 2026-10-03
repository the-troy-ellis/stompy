// Settings and progress live in localStorage under `stompy.*`. Storage can
// throw (private mode, blocked site data); the game runs without it.
export const store = {
  get(k, d) { try { const v = localStorage.getItem('stompy.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('stompy.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};
