// Particles and screen shake: the two effects that exist only to make a frame
// feel like it happened. Nothing here is game state — no rule reads it, no test
// covers it, and deleting the whole file would change nothing but the feel.
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

export interface Effects {
  burst(spec: BurstSpec): void;
  /** `magnitude` is world units of displacement, decaying to nothing over `seconds`. */
  shake(magnitude: number, seconds: number): void;
  update(dt: number): void;
  /** Draws the particles. The caller applies `shakeX`/`shakeY` itself. */
  draw(paint: CanvasRenderingContext2D): void;
  shakeX(): number;
  shakeY(): number;
}

/**
 * Particle gravity, world units per second squared. Positive is down, because
 * these live in canvas space. Gentler than the runner's, so debris hangs a
 * beat longer than the thing that threw it.
 */
const FALL = 1400;

/** Hard ceiling on live particles: a long run must not cost frames. */
const MAX_PARTICLES = 260;

export function createEffects(): Effects {
  const particles: Particle[] = [];
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

  const shake = (magnitude: number, seconds: number): void => {
    // A second shake during a first takes over only if it is bigger, so a
    // pile-up of small hits cannot out-shout the death impact.
    if (magnitude < shakeMag * (shakeLeft / Math.max(shakeSpan, 1e-6))) return;
    shakeMag = magnitude;
    shakeSpan = seconds;
    shakeLeft = seconds;
  };

  const update = (dt: number): void => {
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
  };

  return {
    burst,
    shake,
    update,
    draw,
    shakeX: () => offsetX,
    shakeY: () => offsetY,
  };
}
