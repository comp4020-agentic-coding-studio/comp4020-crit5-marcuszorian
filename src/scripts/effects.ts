// Particles, screen shake and floating text: the effects that exist only to
// make a frame feel like it happened. Nothing here is game state — no rule
// reads it, no test covers it, and deleting the whole file would change nothing
// but the feel.
//
// It lives outside `main.ts` for that reason: it is the one part of the render
// path that is allowed to be non-deterministic (`Math.random` is fine here and
// forbidden in `rules.ts`), and keeping the boundary a file boundary makes that
// obvious. See plan/04-presentation.md.

/**
 * Particles are squares, in world units, because everything else is too — but
 * unlike the simulation they live in *canvas* space, where y grows downward.
 * They are spawned from already-projected screen positions and never consulted
 * again, so converting once at the call site beats flipping an axis per frame.
 */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds remaining, counting down to zero. */
  life: number;
  ttl: number;
  size: number;
  colour: string;
}

export interface BurstSpec {
  readonly x: number;
  readonly y: number;
  readonly colour: string;
  readonly count: number;
  /** World units per second, before the per-particle jitter. */
  readonly speed: number;
  readonly life: number;
  readonly size: number;
  /**
   * Bias, in radians, of the cone the particles leave in. Default is a full
   * circle; the death burst uses a narrow upward-and-back cone so the impact
   * reads as the runner losing against something coming from the right.
   */
  readonly angle?: number;
  readonly spread?: number;
}

/**
 * A word thrown off a pickup: what it did, in the pickup's own colour, for
 * about half a second. Positioned in canvas space like a particle, and for the
 * same reason — the caller has already projected the thing it came from.
 */
export interface FloatSpec {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly colour: string;
  /** Type size in world units, already multiplied by the HUD scale. */
  readonly size: number;
  /** CSS font family list. Kept out of this file's business. */
  readonly family: string;
  readonly life: number;
  /** World units the text drifts upward over its life. */
  readonly rise: number;
  /**
   * Drop the overshoot and halve the travel, for `prefers-reduced-motion`. The
   * word still appears — removing the feedback entirely is a worse answer than
   * showing it calmly.
   */
  readonly calm?: boolean;
}

export interface Effects {
  burst(spec: BurstSpec): void;
  /** A short-lived line of text rising from a point. See `FloatSpec`. */
  float(spec: FloatSpec): void;
  /** `magnitude` is world units of displacement, decaying to nothing over `seconds`. */
  shake(magnitude: number, seconds: number): void;
  update(dt: number): void;
  /** Draws the particles. The caller applies `shakeX`/`shakeY` itself. */
  draw(paint: CanvasRenderingContext2D): void;
  shakeX(): number;
  shakeY(): number;
}

/** A live `FloatSpec`, with the mutable bits a frame needs. */
interface Floater extends FloatSpec {
  y: number;
  life: number;
  ttl: number;
}

/**
 * Particle gravity, world units per second squared. Positive is down, because
 * these live in canvas space. Gentler than the runner's, so debris hangs a
 * beat longer than the thing that threw it.
 */
const FALL = 1400;

/** Hard ceiling on live particles: a long run must not cost frames. */
const MAX_PARTICLES = 260;

/** Hard ceiling on live floating words. A run of coins can only stack so far. */
const MAX_FLOATERS = 10;

/** Fraction of a floater's life spent popping up to full size. */
const FLOAT_POP = 0.22;
/** Fraction spent at full opacity before the fade-out begins. */
const FLOAT_HOLD = 0.5;
/** Size the word starts at, as a fraction of its final one. */
const FLOAT_FROM = 0.4;

/**
 * Two floaters born this close together — seconds apart, and world units apart
 * horizontally — are the same moment, so the later one is stacked above the
 * earlier instead of printed over it. A run of ground tokens is collected about
 * 0.14s apart, so without this the whole run is one illegible smear.
 */
const FLOAT_STACK_MS = 0.3;
const FLOAT_STACK_X = 90;
/** Rungs of the stack, before it wraps back to the bottom. */
const FLOAT_STACK_MAX = 4;

/**
 * Overshoot-and-settle. The standard easeOutBack: past 1 at about 70% of the
 * way through and back down by the end, which is what makes the word land
 * rather than merely arrive.
 */
function easeOutBack(p: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const q = p - 1;
  return 1 + c3 * q * q * q + c1 * q * q;
}

/** Fast, then settling. The rise decelerates so the word parks before it fades. */
function easeOutCubic(p: number): number {
  const q = 1 - p;
  return 1 - q * q * q;
}

export function createEffects(): Effects {
  const particles: Particle[] = [];
  const floaters: Floater[] = [];
  let stackedAt = -Infinity;
  let stackedX = 0;
  let stackRung = 0;
  let clock = 0;
  let shakeLeft = 0;
  let shakeSpan = 0;
  let shakeMag = 0;
  let offsetX = 0;
  let offsetY = 0;

  const burst = (spec: BurstSpec): void => {
    const spread = spec.spread ?? Math.PI * 2;
    const centre = spec.angle ?? 0;
    for (let i = 0; i < spec.count; i += 1) {
      if (particles.length >= MAX_PARTICLES) break;
      // Even spacing plus jitter, rather than pure noise: a handful of purely
      // random directions clumps often enough to look like a mistake.
      const angle =
        centre + ((i + Math.random()) / spec.count - 0.5) * spread;
      const speed = spec.speed * (0.45 + Math.random() * 0.85);
      const ttl = spec.life * (0.7 + Math.random() * 0.6);
      particles.push({
        x: spec.x,
        y: spec.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: ttl,
        ttl,
        size: spec.size,
        colour: spec.colour,
      });
    }
  };

  const float = (spec: FloatSpec): void => {
    // Oldest first, so dropping the head keeps the newest word — the one the
    // player is actually looking for — whatever else is in flight.
    if (floaters.length >= MAX_FLOATERS) floaters.shift();

    const together =
      clock - stackedAt < FLOAT_STACK_MS &&
      Math.abs(spec.x - stackedX) < FLOAT_STACK_X;
    stackRung = together ? (stackRung + 1) % FLOAT_STACK_MAX : 0;
    stackedAt = clock;
    stackedX = spec.x;

    floaters.push({
      ...spec,
      y: spec.y - stackRung * spec.size * 1.15,
      life: spec.life,
      ttl: spec.life,
    });
  };

  const shake = (magnitude: number, seconds: number): void => {
    // A second shake during a first takes over only if it is bigger, so a
    // pile-up of small hits cannot out-shout the death impact.
    if (magnitude < shakeMag * (shakeLeft / Math.max(shakeSpan, 1e-6))) return;
    shakeMag = magnitude;
    shakeSpan = seconds;
    shakeLeft = seconds;
  };

  const update = (dt: number): void => {
    clock += dt;

    // In order, and spliced rather than swap-and-popped: unlike particles these
    // are drawn as overlapping text, so the paint order is the stacking order
    // and shuffling it would make a run of coins flicker.
    for (let i = floaters.length - 1; i >= 0; i -= 1) {
      const f = floaters[i];
      if (f === undefined) continue;
      f.life -= dt;
      if (f.life <= 0) floaters.splice(i, 1);
    }

    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      if (p === undefined) continue;
      p.life -= dt;
      if (p.life <= 0) {
        // Swap-and-pop: order does not matter and splice in a loop does.
        const last = particles.pop();
        if (last !== undefined && i < particles.length) particles[i] = last;
        continue;
      }
      p.vy += FALL * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    if (shakeLeft > 0) {
      shakeLeft = Math.max(0, shakeLeft - dt);
      const decay = shakeLeft / shakeSpan;
      // Squared decay: the first two frames carry the hit and the tail gets out
      // of the way, which is what stops a shake reading as a wobble.
      const amount = shakeMag * decay * decay;
      offsetX = (Math.random() * 2 - 1) * amount;
      offsetY = (Math.random() * 2 - 1) * amount;
    } else {
      offsetX = 0;
      offsetY = 0;
    }
  };

  const draw = (paint: CanvasRenderingContext2D): void => {
    for (const p of particles) {
      const fade = p.life / p.ttl;
      paint.globalAlpha = Math.min(1, fade * 1.6);
      paint.fillStyle = p.colour;
      // Particles shrink as they die: constant-size squares popping out of
      // existence read as a rendering bug.
      const size = Math.max(1, p.size * (0.4 + fade * 0.6));
      paint.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    }
    paint.globalAlpha = 1;

    drawFloaters(paint);
  };

  /**
   * Pop in, rise, fade out — over about half a second, which is short enough
   * that it never becomes something to read and long enough to be caught out of
   * the corner of an eye still watching the track.
   *
   * The three curves are deliberately out of phase: the word is at full size
   * before it has finished rising, and still rising when it starts to fade. In
   * phase they read as one linear tween, which is the difference between a
   * label appearing and a thing being thrown off the pickup.
   */
  const drawFloaters = (paint: CanvasRenderingContext2D): void => {
    if (floaters.length === 0) return;

    paint.save();
    paint.textAlign = "center";
    paint.textBaseline = "middle";

    for (const f of floaters) {
      const t = 1 - f.life / f.ttl;
      const scale = f.calm
        ? 1
        : FLOAT_FROM +
          (1 - FLOAT_FROM) * easeOutBack(Math.min(1, t / FLOAT_POP));
      const rise = f.rise * (f.calm ? 0.5 : 1) * easeOutCubic(t);
      const fade =
        t < FLOAT_HOLD ? 1 : Math.max(0, 1 - (t - FLOAT_HOLD) / (1 - FLOAT_HOLD));
      // A separate, much faster fade-in, so a word that pops in from 40% size
      // does not also flash at full opacity on its first frame.
      const arrive = Math.min(1, t / 0.08);

      paint.globalAlpha = fade * arrive;
      paint.fillStyle = f.colour;
      paint.font = `700 ${f.size * scale}px ${f.family}`;
      paint.fillText(f.text, f.x, f.y - rise);
    }

    paint.globalAlpha = 1;
    paint.restore();
  };

  return {
    burst,
    float,
    shake,
    update,
    draw,
    shakeX: () => offsetX,
    shakeY: () => offsetY,
  };
}
