import type { BackgroundGradient, ShadowStyle } from "../video/types";

/** Only structured, schema-validated paint reaches CSS; no URLs or raw CSS. */
export function gradientToCss(
  gradient?: BackgroundGradient | null,
): string | undefined {
  if (!gradient) return undefined;
  const stops = gradient.stops
    .map((stop) => `${stop.color} ${stop.at * 100}%`)
    .join(", ");
  return gradient.type === "linear"
    ? `linear-gradient(${gradient.angle ?? 180}deg, ${stops})`
    : `radial-gradient(ellipse farthest-side at ${(gradient.center?.x ?? 0.5) * 100}% ${(gradient.center?.y ?? 0.5) * 100}%, ${stops})`;
}

export function shadowToCss(shadow?: ShadowStyle | null): string | undefined {
  return shadow
    ? `${shadow.x ?? 0}px ${shadow.y ?? 8}px ${shadow.blur ?? 24}px ${shadow.spread ?? 0}px ${shadow.color}`
    : undefined;
}
