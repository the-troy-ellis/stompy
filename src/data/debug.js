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
// BIG DIGS: every dig at `scale` times its radius, through the rock band as if
// it were soft. 4, so a few AUTOCANNON shells (2.5 m, 10 m here) cut an arch's
// leg through: at 3 they did on the 8 m grid, but on the 4 m one only chipped
// it (docs/specs/29-ground-4m.md); at 2 its holes stalled on rock.
export const BIG_DIG = { scale: 4 };
