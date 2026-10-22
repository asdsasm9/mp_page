/**
 * Zod 4 probes dynamic code compilation when a schema is built, to decide whether it may compile fast parsers. The strict CSP
 * (no 'unsafe-eval') refuses that probe and reports a violation on every page load, so switch the compiler off before any
 * schema exists. This module must be the first import of main.tsx.
 */
import { config } from 'zod';

config({ jitless: true });
