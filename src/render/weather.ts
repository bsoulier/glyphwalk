export const WEATHERS = ['clear', 'rain', 'snow', 'fog'] as const;
export type Weather = (typeof WEATHERS)[number];
export const WEATHER_LABELS: Record<Weather, string> = { clear: 'Clear', rain: 'Rain', snow: 'Snow', fog: 'Fog' };

/** Snow cover colour at night; daylight brightens it like every other surface. */
export const SNOW: readonly [number, number, number] = [150, 158, 178];
/** Fog thickness per metre: about 40% visibility at 30 m, nearly nothing past 100 m. */
export const FOG_DENSITY = 0.034;
/** View distance in fog; nothing beyond it would show anyway, so it is also a free speed-up. */
export const FOG_FAR = 130;
