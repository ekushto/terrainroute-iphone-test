// Route difficulty colours by effort per metre (x flat-trail effort): Easy < 1.5, Moderate < 2.5, Hard < 4, then
// Very hard; unknown (impassable) counts as Very hard. Light yellow to dark brown, so the steps differ in lightness.
export const SHADE_STEPS = [["#F2C14E", 0], ["#E8833A", 1.5], ["#C2410C", 2.5], ["#7C2D12", 4]];
export const shadeOf = i => (i === null || !Number.isFinite(i) ? SHADE_STEPS[3][0] : SHADE_STEPS.filter(([, t]) => i >= t).at(-1)[0]);
