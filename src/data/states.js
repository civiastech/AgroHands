// Nigeria's 36 states + FCT, with approximate capital coordinates used when no GPS pin is given.
export const STATES = [
  ['Abia', 5.53, 7.49], ['Adamawa', 9.21, 12.48], ['Akwa Ibom', 5.04, 7.91], ['Anambra', 6.21, 7.07],
  ['Bauchi', 10.31, 9.84], ['Bayelsa', 4.92, 6.27], ['Benue', 7.73, 8.52], ['Borno', 11.83, 13.15],
  ['Cross River', 4.95, 8.32], ['Delta', 6.2, 6.73], ['Ebonyi', 6.32, 8.11], ['Edo', 6.34, 5.63],
  ['Ekiti', 7.62, 5.22], ['Enugu', 6.44, 7.5], ['FCT', 9.06, 7.49], ['Gombe', 10.29, 11.17],
  ['Imo', 5.48, 7.03], ['Jigawa', 11.76, 9.34], ['Kaduna', 10.52, 7.44], ['Kano', 12.0, 8.52],
  ['Katsina', 12.99, 7.6], ['Kebbi', 12.45, 4.2], ['Kogi', 7.8, 6.74], ['Kwara', 8.49, 4.54],
  ['Lagos', 6.6, 3.35], ['Nasarawa', 8.49, 8.52], ['Niger', 9.61, 6.56], ['Ogun', 7.16, 3.35],
  ['Ondo', 7.25, 5.19], ['Osun', 7.77, 4.56], ['Oyo', 7.38, 3.94], ['Plateau', 9.9, 8.86],
  ['Rivers', 4.82, 7.03], ['Sokoto', 13.06, 5.24], ['Taraba', 8.89, 11.36], ['Yobe', 11.75, 11.97],
  ['Zamfara', 12.17, 6.66],
].map(([name, lat, lng]) => ({ name, lat, lng }));

export const STATE_NAMES = STATES.map((s) => s.name);

export function findState(input) {
  const t = String(input || '').trim().toLowerCase().replace(/\s+state$/, '');
  if (!t) return null;
  return (
    STATES.find((s) => s.name.toLowerCase() === t) ||
    STATES.find((s) => s.name.toLowerCase().startsWith(t)) ||
    (t === 'abuja' ? STATES.find((s) => s.name === 'FCT') : null)
  );
}
