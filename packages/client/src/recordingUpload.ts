import type { RecordingLine } from '@bollwerk/protocol';

/**
 * Sends a local match's recording to the server the page came from, a few lines at a
 * time, for the same `recordings/` folder the server writes its own matches to.
 *
 * Batched every few seconds rather than per line, sent at once when the match ends,
 * and flushed with `sendBeacon` if the tab is closed mid-match — so an abandoned match
 * keeps nearly everything. Where nothing receives it (the dev server, or a server with
 * recordings off) the first send fails and it goes quiet for the rest of the match:
 * a recording is never worth an error in front of a player.
 */
export class RecordingUpload {
  private pending: string[] = [];
  private id: string | null = null;
  private dead = false;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly onHide = (): void => {
    if (document.visibilityState === 'hidden') this.beacon();
  };

  constructor(everyMs = 5000) {
    this.timer = setInterval(() => void this.flush(), everyMs);
    document.addEventListener('visibilitychange', this.onHide);
    globalThis.addEventListener('pagehide', this.onHide);
  }

  /** Hands the recorder somewhere to write. */
  readonly write = (line: RecordingLine): void => {
    if (this.dead) return;
    if (line.kind === 'header') this.id = line.id;
    this.pending.push(JSON.stringify(line));
    if (line.kind === 'end') void this.flush().then(() => this.stop());
  };

  private async flush(): Promise<void> {
    if (this.dead || this.id === null || this.pending.length === 0) return;
    const body = `${this.pending.join('\n')}\n`;
    this.pending = [];
    try {
      const response = await fetch(`/recordings/${this.id}`, { method: 'POST', body });
      if (!response.ok) this.stop();
    } catch {
      this.stop();
    }
  }

  private beacon(): void {
    if (this.dead || this.id === null || this.pending.length === 0) return;
    const body = `${this.pending.join('\n')}\n`;
    if (navigator.sendBeacon(`/recordings/${this.id}`, body)) this.pending = [];
  }

  /** Ends the upload: the match is over, the session left, or nobody is listening. */
  stop(): void {
    this.dead = true;
    this.pending = [];
    clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.onHide);
    globalThis.removeEventListener('pagehide', this.onHide);
  }
}
