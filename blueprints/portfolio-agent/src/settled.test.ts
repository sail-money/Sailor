/**
 * Registers scripts/settled.test.mjs with `npm test` (whose glob is src/**\/*.test.ts). The
 * settle decision lives next to the script it guards; this file only pulls its tests in.
 */
import "../scripts/settled.test.mjs";
