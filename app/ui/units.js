// Display units. The engine works in metres; the app shows miles/feet by default (US hunting apps) or km/metres.

const M_PER_MI = 1609.344, FT_PER_M = 3.28084;
let system = "imperial";

export const setUnits = u => { system = u === "metric" ? "metric" : "imperial"; };
export const unitsSystem = () => system;

const group = n => Math.round(n).toLocaleString("en-US");

// Distance (m) as "3.20" with its unit label ("mi" / "km").
export const dist = m => (system === "metric" ? (m / 1000).toFixed(2) : (m / M_PER_MI).toFixed(2));
export const distUnit = () => (system === "metric" ? "km" : "mi");
// Height (m) as "1,736" with its unit label ("ft" / "m").
export const height = m => group(system === "metric" ? m : m * FT_PER_M);
export const heightUnit = () => (system === "metric" ? "m" : "ft");
// Effort (flat-trail-equivalent km) in the distance unit, one decimal; "impassable" when null.
export const effort = km => (km === null || km === undefined ? "impassable" : (system === "metric" ? km : km * 1000 / M_PER_MI).toFixed(1));
