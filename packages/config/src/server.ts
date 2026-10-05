import { z } from 'zod';

import { LevelSchema } from './ai.js';
import { SettingBoundsSchema } from './settings.js';

export const ServerConfigSchema = z.strictObject({
  port: z.number().int().min(1).max(65535),
  host: z.string().min(1),

  /**
   * Asking the host's router to open the port (UPnP, PLAN 11.21). Whether to ask at all is
   * not here: the desktop app's switch and `npm start -- --upnp` decide, and the image never
   * asks. The lease lapses on its own if the server dies; the library renews it while it runs.
   */
  upnp: z.strictObject({
    leaseSeconds: z.number().int().min(120),
    /** How long to look for a router before saying there is none. */
    searchMs: z.number().int().positive(),
  }),

  rooms: z.strictObject({
    codeLength: z.number().int().min(4).max(12),
    /** Ambiguous glyphs (0/O, 1/I) are excluded so codes can be read aloud. */
    codeAlphabet: z.string().min(16),
    maxConcurrent: z.number().int().positive(),
    emptyRoomTtlMs: z.number().int().positive(),
    abandonedMatchTtlMs: z.number().int().positive(),
  }),

  limits: z.strictObject({
    maxMessagesPerSecond: z.number().int().positive(),
    maxMessageBytes: z.number().int().positive(),
    maxNameLength: z.number().int().positive(),
  }),

  reconnect: z.strictObject({
    graceMs: z.number().int().nonnegative(),
    botTakeoverDelayMs: z.number().int().nonnegative(),
  }),

  /** Skill level of the bots that fill empty seats and cover dropped players, 1 to 10. */
  botLevel: LevelSchema,

  /** What a host may change in the lobby, and within what bounds. */
  lobbySettings: SettingBoundsSchema,

  snapshot: z.strictObject({
    onPhaseChange: z.boolean(),
    keepaliveIntervalMs: z.number().int().positive(),
  }),

  /**
   * Match recordings for tuning against human play: every match the server runs, and
   * every local one a browser sends, as a file in `dir` (relative to the repository).
   */
  recordings: z.strictObject({
    enabled: z.boolean(),
    dir: z.string().min(1),
    /** The most a browser may send in one request; it sends a little at a time. */
    maxUploadBytes: z.number().int().positive(),
  }),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;
