/* global __VERSION__ */
// Which build is running: the package version, then the commit and its date
// (`0.1.0 · 9c5c03f · OCT 20`, from scripts/build.mjs); `dev` unbuilt.
// Shown in the settings footer and on the ?debug=1 readout.
export const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';
