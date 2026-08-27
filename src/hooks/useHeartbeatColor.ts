import { useEffect, useState } from "react";
import { RGBA } from "@opentui/core";

/**
 * Heartbeat pulse in [0,1] over one cycle (`phase` in [0,1)): two quick thumps
 * followed by a rest, so the border flickers between the base color and muted
 * (dropping to full at rest) the way a pulse monitor ticks.
 */
function heartbeatPulse(phase: number): number {
  if (phase < 0.15) return Math.sin((phase / 0.15) * Math.PI);
  if (phase < 0.3) return 0.6 * Math.sin(((phase - 0.15) / 0.15) * Math.PI);
  return 0;
}

function lerpRGBA(a: RGBA, b: RGBA, t: number): RGBA {
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  const al = Math.round(a.a + (b.a - a.a) * t);
  return RGBA.fromValues(r, g, bl, al);
}

/**
 * Returns a color that heartbeats between `base` (the theme color) and `muted`
 * (`theme.textMuted`) while `active` is true, and settles back on `base` once
 * streaming finishes. The returned color is a fresh `RGBA` each frame so the
 * border re-renders without mutating the theme palette.
 */
export function useHeartbeatColor(
  base: RGBA,
  muted: RGBA,
  active: boolean,
  beatMs = 1200
): RGBA {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    // Around the renderer's 30 FPS ceiling; fast enough for a smooth pulse.
    const id = setInterval(() => setTick((t) => t + 1), 40);
    return () => clearInterval(id);
  }, [active, base, muted, beatMs]);

  if (!active) return base;
  const phase = (performance.now() % beatMs) / beatMs;
  return lerpRGBA(base, muted, heartbeatPulse(phase));
}