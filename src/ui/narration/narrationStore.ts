import type { NarrativeEntry } from '../../game/types';

/**
 * The narration channel: one queue, shared by the office and the dashboard.
 *
 * A store outside React, for the same reason `cameraRig` is one. Two surfaces
 * present the same line — the office dialogue panel and the dashboard rail —
 * and a line must be spoken exactly once no matter how many of them are
 * mounted. Putting the queue in component state would have made "speak once"
 * depend on which view happened to be rendered, which is precisely the class of
 * bug the audit found: `present_guidance` was accepted and logged, and no
 * player ever saw it.
 *
 * The store is presentation only. It never writes to the game: the append-only
 * `narrativeLog` in `GameContext` is the source of truth, and this reads from
 * it. Generated narration cannot move score, actions, findings, route or
 * `stateVersion`, and nothing here is capable of trying.
 */

export interface NarrationState {
  /** The line on screen now, or null when the fallback copy should show. */
  active: NarrativeEntry | null;
  /** Lines accepted but not yet shown. Reported to the agent as `queueDepth`. */
  pending: NarrativeEntry[];
  /** Highest sequence a player has actually been shown. */
  deliveredSequence: number;
  /**
   * Whether narration is spoken aloud. Captions are never affected — "Stop
   * Voice" silences the speaker and leaves every word on screen, because
   * browser TTS is an enhancement and can be absent, muted or simply bad.
   *
   * A mirror of the speech engine's own mute, not a second preference. The
   * engine already gates `speak()` and already persists the choice, so storing
   * it again here produced two switches for one thing: pressing "Stop Voice" on
   * the caption left the settings toggle still reading "Narration on".
   */
  voiceEnabled: boolean;
  /** True while a line is being read aloud. Drives the agent-status copy. */
  speaking: boolean;
}

type Listener = (state: NarrationState) => void;

/** How long a line holds the channel before the next one takes over. */
const MIN_HOLD_MS = 2600;
/** Roughly a comfortable reading pace, so a long line is not cut short. */
const MS_PER_CHARACTER = 38;

class NarrationChannel {
  private state: NarrationState = {
    active: null,
    pending: [],
    deliveredSequence: 0,
    voiceEnabled: true,
    speaking: false,
  };

  /** The domain state the case is in now. Anything written before it is stale. */
  private stateVersion = 0;

  private listeners = new Set<Listener>();
  private holdTimer = 0;
  /**
   * Whether the active line's hold has run out.
   *
   * Held and releasable are two different things, and conflating them is what
   * deadlocked this channel. The old code released by setting `active` to null
   * when the hold expired, but only bothered to do so if something was already
   * waiting — with an empty queue the timer returned early and left `active`
   * set with no timer left to clear it. `advance()` refuses to start a line
   * while one is active, so every line written after that quiet moment was
   * appended to `pending` and never shown again for the rest of the run. It was
   * invisible to the browser suite because that test queues its three lines
   * inside the first line's hold, where `pending` is never empty and the
   * release path always ran.
   *
   * Splitting the two states keeps all three behaviours the contract wants: a
   * line inside its hold cannot be overwritten, a line past its hold stays on
   * screen for as long as there is nothing better to show, and the channel is
   * always able to accept the next line.
   */
  private holdExpired = false;
  /** Every sequence that has been handed to the speech layer, ever. */
  private spoken = new Set<number>();

  getState(): NarrationState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  /**
   * Offer the whole log. Entries at or below `deliveredSequence` are already
   * done; anything newer is queued in sequence order, and duplicates are
   * ignored — a replayed idempotency key must not re-queue or re-speak.
   */
  ingest(log: readonly NarrativeEntry[]): void {
    const known = new Set([
      ...this.state.pending.map((entry) => entry.narrativeSequence),
      ...(this.state.active ? [this.state.active.narrativeSequence] : []),
    ]);

    const fresh = log
      .filter(
        (entry) =>
          entry.narrativeSequence > this.state.deliveredSequence &&
          !known.has(entry.narrativeSequence) &&
          // Already overtaken before it was ever shown — the log is replayed on
          // every append, so an old line must not surface late.
          entry.basedOnStateVersion >= this.stateVersion,
      )
      .sort((a, b) => a.narrativeSequence - b.narrativeSequence);

    if (fresh.length === 0) return;

    this.state = { ...this.state, pending: [...this.state.pending, ...fresh] };
    this.emit();
    this.advance();
  }

  /** Dismiss the active line early and show the next one. */
  skip(): void {
    if (!this.state.active) return;
    this.clearHold();
    this.state = { ...this.state, active: null, speaking: false };
    this.emit();
    this.advance();
  }

  /** Mirrors the speech engine's mute. The engine owns and persists the choice. */
  setVoiceEnabled(enabled: boolean): void {
    if (this.state.voiceEnabled === enabled) return;
    this.state = { ...this.state, voiceEnabled: enabled, speaking: enabled && this.state.speaking };
    this.emit();
  }

  /**
   * Tell the channel where the case actually is.
   *
   * A generated line carries `basedOnStateVersion`: the domain state it was
   * written about. Once the player acts, that state is gone, and a line written
   * about it must not sit on top of the instruction for the state they are in
   * now — the contract is explicit that stale narration may not replace a newer
   * state's instruction. So the line is retired, not queued behind the new one:
   * showing it late would be showing something false.
   *
   * Narration is presentation, so this only ever reads the version. Nothing here
   * can move it.
   */
  setStateVersion(version: number): void {
    if (version === this.stateVersion) return;
    this.stateVersion = version;
    this.retireStale();
  }

  setSpeaking(speaking: boolean): void {
    if (this.state.speaking === speaking) return;
    this.state = { ...this.state, speaking };
    this.emit();
  }

  /**
   * Where a given line currently sits in the channel.
   *
   * The `present_guidance` receipt has to tell the agent whether the line it
   * just wrote is being read now or waiting behind another, and it cannot get
   * that from `speaking`: at the moment the tool returns, the speech engine has
   * not started yet, so `speaking` describes the *previous* line. Asking where
   * the sequence actually landed is the question that has a true answer.
   */
  placementOf(sequence: number): 'active' | 'pending' | 'delivered' | 'unknown' {
    if (this.state.active?.narrativeSequence === sequence) return 'active';
    if (this.state.pending.some((entry) => entry.narrativeSequence === sequence)) return 'pending';
    if (sequence <= this.state.deliveredSequence) return 'delivered';
    return 'unknown';
  }

  /**
   * True the first time a sequence is offered to the speech layer. The caller
   * uses it to guarantee one `speak()` per line: a re-render, a second mounted
   * view or a duplicated tool call must not produce a second utterance.
   */
  claimSpeech(sequence: number): boolean {
    if (this.spoken.has(sequence)) return false;
    this.spoken.add(sequence);
    return true;
  }

  /** Drops everything. Used when a run restarts. */
  reset(): void {
    this.clearHold();
    this.spoken.clear();
    this.stateVersion = 0;
    this.state = {
      ...this.state,
      active: null,
      pending: [],
      deliveredSequence: 0,
      speaking: false,
    };
    this.emit();
  }

  /** Drop everything written about a state the case has already left. */
  private retireStale(): void {
    const isStale = (entry: NarrativeEntry) => entry.basedOnStateVersion < this.stateVersion;

    const pending = this.state.pending.filter((entry) => !isStale(entry));
    const activeStale = this.state.active !== null && isStale(this.state.active);
    if (pending.length === this.state.pending.length && !activeStale) return;

    if (activeStale) this.clearHold();
    this.state = {
      ...this.state,
      active: activeStale ? null : this.state.active,
      pending,
      speaking: activeStale ? false : this.state.speaking,
    };
    this.emit();
    if (activeStale) this.advance();
  }

  private advance(): void {
    if (this.state.pending.length === 0) return;
    // Still being read. A queued line waits its turn rather than overwriting
    // the sentence in front of the player.
    if (this.state.active && !this.holdExpired) return;

    const [next, ...rest] = this.state.pending;
    // The line it displaces stopped being read the moment it left the screen.
    // The driver mirrors the speech engine again a tick later; saying it here
    // keeps the caption from claiming the old line is still being spoken in
    // between, which is what the old release step did before it advanced.
    const replacing = this.state.active !== null;
    this.state = {
      ...this.state,
      active: next!,
      pending: rest,
      deliveredSequence: Math.max(this.state.deliveredSequence, next!.narrativeSequence),
      speaking: replacing ? false : this.state.speaking,
    };
    this.emit();

    // Hold long enough to be read, then mark the channel releasable — the line
    // stays on screen, and the next one is free to take it whenever it arrives.
    const hold = Math.max(MIN_HOLD_MS, next!.message.length * MS_PER_CHARACTER);
    this.clearHold();
    this.holdTimer = window.setTimeout(() => {
      this.holdTimer = 0;
      this.holdExpired = true;
      this.advance();
    }, hold);
  }

  /**
   * No hold is in force from here on: no timer pending, and nothing releasable.
   *
   * `holdExpired` is cleared outside the `holdTimer` test on purpose. After a
   * hold runs out naturally the callback has already zeroed `holdTimer`, so a
   * reset guarded by it would be skipped — and the line that `advance()` then
   * puts on screen would inherit a channel already marked releasable and could
   * be displaced by the very next line to arrive, a sentence gone in a frame.
   * The two facts have to be dropped together or not at all.
   */
  private clearHold(): void {
    if (this.holdTimer) {
      window.clearTimeout(this.holdTimer);
      this.holdTimer = 0;
    }
    this.holdExpired = false;
  }

  private emit(): void {
    const snapshot = this.state;
    for (const listener of this.listeners) listener(snapshot);
  }
}

export const narrationChannel = new NarrationChannel();
