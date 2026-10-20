// The DEBUG tab's cheats (docs/specs/19-debug-menu.md § Cheats): stable keys,
// their switch labels, and BIG DIGS's size. Test tools, not balance: none of
// this touches data/weapons.js, and none of it works outside single player.
export const CHEATS = [
  ['god', 'INVINCIBLE'],
  ['heat', 'NO HEAT'],
  ['ammo', 'ENDLESS AMMO'],
  ['weight', 'NO WEIGHT LIMIT'],
  ['digs', 'BIG DIGS'],
  ['freeze', 'FOES FROZEN'],
];
// BIG DIGS: every dig at `scale` times its radius, through the rock band as if it were soft.
export const BIG_DIG = { scale: 2 };
