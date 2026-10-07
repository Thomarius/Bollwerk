import type { ConfigBundle } from '@bollwerk/config';
import { Rng } from '@bollwerk/sim';

import type { RecordingLine, RoomListing } from '@bollwerk/protocol';

import { Room } from './room.js';

/**
 * Owns the live rooms and hands out their codes.
 *
 * Codes are drawn from an alphabet with no ambiguous glyphs, because the entire
 * onboarding story is one player reading a code to another.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly rng: Rng;

  constructor(
    private readonly config: ConfigBundle,
    seed = Date.now() >>> 0,
    /** A fresh writer for each room's match recording, or nothing to record. */
    private readonly recorder?: () => (line: RecordingLine) => void,
    /** The server's public address while its port is open to the internet, or null. */
    private readonly publicUrl: () => string | null = () => null,
  ) {
    this.rng = new Rng(seed);
  }

  get size(): number {
    return this.rooms.size;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  /** Open rooms anyone may join from the games browser, oldest first. */
  listOpen(): RoomListing[] {
    return [...this.rooms.values()].flatMap((room) => room.listing() ?? []);
  }

  create(playerCount: number, isPublic = true): Room | null {
    if (this.rooms.size >= this.config.server.rooms.maxConcurrent) return null;
    const room = new Room({
      code: this.newCode(),
      playerCount,
      public: isPublic,
      ruleset: this.config.ruleset,
      terrain: this.config.terrain,
      server: this.config.server,
      ai: this.config.ai,
      seed: this.rng.nextU32(),
      publicUrl: this.publicUrl,
      ...(this.recorder === undefined ? {} : { record: this.recorder() }),
    });
    this.rooms.set(room.code, room);
    return room;
  }

  /** Tells every lobby again, when what they show from outside the room has changed. */
  refreshLobbies(): void {
    for (const room of this.rooms.values()) room.refreshLobby();
  }

  /** Advances every room and retires the ones nobody is left in. */
  update(elapsedMs: number): void {
    for (const [code, room] of this.rooms) {
      room.update(elapsedMs);
      const ttl = room.started
        ? this.config.server.rooms.abandonedMatchTtlMs
        : this.config.server.rooms.emptyRoomTtlMs;
      if (room.empty && room.idleMs > ttl) this.rooms.delete(code);
    }
  }

  private newCode(): string {
    const { codeLength, codeAlphabet } = this.config.server.rooms;
    for (let attempt = 0; attempt < 64; attempt++) {
      let code = '';
      for (let i = 0; i < codeLength; i++) {
        code += codeAlphabet[this.rng.nextInt(codeAlphabet.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('could not find an unused room code');
  }
}
