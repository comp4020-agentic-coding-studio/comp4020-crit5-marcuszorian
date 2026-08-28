// Sound, with no dependencies and no assets: every voice is a shaped oscillator
// built at the moment it plays and thrown away afterwards. Three files ship
// instead of three sound files, and nothing has to load before the game is
// playable.
//
// Split out of `main.ts` because it shares nothing with the renderer but the
// moment it is called — see plan/04-presentation.md.
//
// The autoplay policy is not a problem this file has to solve. A browser will
// not let a page make a sound before the user has interacted with it, and the
// first thing this game asks for is a press: the caret invites it, the hop
// confirms it, and `unlock()` runs on that same gesture. The game physically
// cannot reach a sound before the player has pressed something.

/** Every sound the game makes. One per event worth hearing. */
export type Voice = "jump" | "token" | "high" | "power" | "death";

export interface Sound {
  /** Create or resume the context. Must be called from a user gesture. */
  unlock(): void;
  play(voice: Voice): void;
  /** Silences everything without tearing the context down. */
  setMuted(muted: boolean): void;
}

/**
 * One oscillator's life: a pitch sweep and an envelope. Frequencies are ramped
 * exponentially, so neither end may be zero.
 */
interface Note {
  readonly wave: OscillatorType;
  readonly from: number;
  readonly to: number;
  readonly gain: number;
  /** Seconds. Attack is short enough everywhere to read as an onset, not a fade. */
  readonly attack: number;
  readonly release: number;
  /** Seconds after the trigger. Non-zero only for the power-up's arpeggio. */
  readonly at?: number;
}

// A square lead for the verb, triangles for reward, a detuned saw for the end.
// The pickup chimes rise and the death sweeps down, which is the whole grammar:
// nothing has to be learned, and the two token pitches are a fifth apart so
// "you got the harder one" is audible without looking.
const VOICES: Record<Voice, readonly Note[]> = {
  jump: [
    { wave: "square", from: 300, to: 660, gain: 0.1, attack: 0.004, release: 0.1 },
  ],
  token: [
    { wave: "triangle", from: 880, to: 1180, gain: 0.11, attack: 0.003, release: 0.09 },
  ],
  high: [
    { wave: "triangle", from: 1320, to: 1760, gain: 0.12, attack: 0.003, release: 0.13 },
  ],
  power: [
    { wave: "triangle", from: 660, to: 880, gain: 0.11, attack: 0.004, release: 0.1 },
    { wave: "triangle", from: 990, to: 1320, gain: 0.11, attack: 0.004, release: 0.1, at: 0.07 },
    { wave: "triangle", from: 1320, to: 1980, gain: 0.12, attack: 0.004, release: 0.26, at: 0.14 },
  ],
  death: [
    { wave: "sawtooth", from: 220, to: 42, gain: 0.16, attack: 0.005, release: 0.5 },
    { wave: "square", from: 110, to: 36, gain: 0.1, attack: 0.005, release: 0.42 },
  ],
};

export function createSound(): Sound {
  // Constructing an AudioContext before a gesture gets it created `suspended`
  // and, in some browsers, warned about. Nothing exists until `unlock`.
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let muted = false;

  const unlock = (): void => {
    try {
      if (context === null) {
        const Ctor = globalThis.AudioContext;
        // No WebAudio (old browser, hardened profile) is a silent game, not a
        // broken one: every call below no-ops from here on.
        if (Ctor === undefined) return;
        context = new Ctor();
        master = context.createGain();
        master.gain.value = muted ? 0 : 1;
        master.connect(context.destination);
      }
      // A context can be suspended again by the browser (tab hidden, audio
      // focus lost), so this runs on every gesture, not just the first.
      if (context.state === "suspended") void context.resume();
    } catch {
      context = null;
      master = null;
    }
  };

  const play = (voice: Voice): void => {
    if (context === null || master === null || muted) return;
    const now = context.currentTime;
    for (const note of VOICES[voice]) {
      sing(context, master, note, now + (note.at ?? 0));
    }
  };

  const setMuted = (next: boolean): void => {
    muted = next;
    if (master !== null) master.gain.value = next ? 0 : 1;
  };

  return { unlock, play, setMuted };
}

/** One note, scheduled. The nodes disconnect themselves when it is over. */
function sing(
  context: AudioContext,
  master: GainNode,
  note: Note,
  start: number,
): void {
  const end = start + note.attack + note.release;

  const osc = context.createOscillator();
  osc.type = note.wave;
  osc.frequency.setValueAtTime(note.from, start);
  osc.frequency.exponentialRampToValueAtTime(note.to, end);

  const envelope = context.createGain();
  // Attack from a floor rather than from zero: an exponential ramp cannot
  // touch zero, and a linear attack into an exponential decay is the shape
  // that reads as "struck" rather than "faded in".
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.linearRampToValueAtTime(note.gain, start + note.attack);
  envelope.gain.exponentialRampToValueAtTime(0.0001, end);

  osc.connect(envelope);
  envelope.connect(master);
  osc.start(start);
  osc.stop(end + 0.02);
  osc.onended = () => {
    osc.disconnect();
    envelope.disconnect();
  };
}
