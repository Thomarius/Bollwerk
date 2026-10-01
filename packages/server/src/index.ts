// Authoritative match server: rooms, tick loop, input validation, bot slots.
// See docs/PLAN.md section 6. Started from the command line by `main.ts`, and by the
// desktop app through `startServer` (PLAN 11.17).

export { repoRoot } from './paths.js';
export { startServer, type RunningServer, type ServerOptions, type StartResult } from './server.js';
