import { STEAL } from '../data/construct.js';

// A building down (docs/specs/33-production.md § Stealing): at STEAL.down of
// its full health or less it stops working, until it's mended above that.
// Here, apart, so base.js and production.js can both ask without importing
// each other.
export const isDown = e => Number.isFinite(e.hp) && e.max > 0 && e.hp <= e.max * STEAL.down + 1e-9;
// Up (built, standing), not down, and not riding on haulers: it works.
export const works = e => e.alive && !e.site && (e.prog ?? 1) >= 1 && !isDown(e) && !e.carry?.lifted;
