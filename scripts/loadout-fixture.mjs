// Writes server/loadout_tables.json: the mechlab tables the arena server
// validates loadouts against, plus a set of cases with the answers the JS
// gives, so the Python copy (server/data.py) can be checked against both.
//   npm run fixture:loadout
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadoutFixture } from '../src/sim/loadout.js';

const out = fileURLToPath(new URL('../server/loadout_tables.json', import.meta.url));
writeFileSync(out, JSON.stringify(loadoutFixture(), null, 1) + '\n');
console.log(`wrote ${out}`);
