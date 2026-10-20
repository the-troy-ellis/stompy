// The DEBUG tab's cheats (data/debug.js), read in one place. They live in
// G.cheats ({ god, heat, ammo, weight, digs, freeze }, set by ui/debugMenu.js)
// and hold only in single player: the arena and co-op trust each client's numbers.
export const cheat = (G, k) => G.mode === 'sp' && !!G.cheats?.[k];
// The ones switched on, in CHEATS order, for the HUD's line.
export const cheatsOn = (G, list) => list.filter(([k]) => G.cheats?.[k]);
