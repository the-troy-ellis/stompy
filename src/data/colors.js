// Multiplayer paint jobs: pilots are told apart by colour.
export const MP_COLORS = [
  { name: 'STEEL', col: [0.58, 0.6, 0.64], acc: [0.85, 0.6, 0.15], css: '#9aa0a8' },
  { name: 'RED', col: [0.72, 0.2, 0.17], acc: [0.2, 0.2, 0.22], css: '#e04a3a' },
  { name: 'BLUE', col: [0.2, 0.38, 0.78], acc: [0.85, 0.85, 0.9], css: '#4a7ae0' },
  { name: 'GREEN', col: [0.24, 0.55, 0.28], acc: [0.85, 0.75, 0.2], css: '#44b058' },
  { name: 'GOLD', col: [0.82, 0.64, 0.16], acc: [0.2, 0.2, 0.22], css: '#f0c030' },
  { name: 'VIOLET', col: [0.52, 0.28, 0.68], acc: [0.85, 0.85, 0.9], css: '#a868e0' },
  { name: 'ORANGE', col: [0.85, 0.42, 0.14], acc: [0.2, 0.2, 0.22], css: '#f08030' },
  { name: 'TEAL', col: [0.18, 0.6, 0.6], acc: [0.9, 0.9, 0.9], css: '#38c0c0' },
];

// The HUD's colours (docs/specs/11-release.md § Accessibility): what reads as
// fine, warning and bad (heat, armour, the radar), the dim line work, armour
// from whole to gone, and the melt glow on a mech under a beam. Each mode is a
// set that stays apart under that kind of colour blindness; test/hudColours
// simulates it. Picked in SETTINGS as COLOURS.
const RED_GREEN = { good: '#56b4e9', warn: '#f0e442', bad: '#d55e00', dim: '#2f6f8f', hp: ['#56b4e9', '#f0e442', '#d55e00', '#222'], melt: [2.2, 1.5, 0.3] };
export const HUD_PALETTES = [
  { key: 'normal', label: 'NORMAL', good: '#5f5', warn: '#fc3', bad: '#f44', dim: '#2a7a2a', hp: ['#3c3', '#dd3', '#e33', '#222'], melt: [2.2, 0.8, 0.25] },
  { key: 'deutan', label: 'DEUTAN', ...RED_GREEN },
  { key: 'protan', label: 'PROTAN', ...RED_GREEN },
  { key: 'tritan', label: 'TRITAN', good: '#3fe0d0', warn: '#ff9ad5', bad: '#e8102e', dim: '#2a7a72', hp: ['#3fe0d0', '#ff9ad5', '#e8102e', '#222'], melt: [2.2, 0.5, 0.6] },
];
export const hudPalette = i => HUD_PALETTES[i] || HUD_PALETTES[0];
