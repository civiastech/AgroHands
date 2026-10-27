import { findState } from '../data/states.js';

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const norm = (s) => String(s || '').trim().toLowerCase();

/**
 * Best available distance estimate between a worker and a farm.
 * GPS pins win; otherwise same LGA ≈ 8 km, same state ≈ 45 km, else state-capital distance.
 */
export function estimateDistanceKm(worker, farm) {
  if (worker.lat != null && worker.lng != null && farm.lat != null && farm.lng != null) {
    return { km: haversineKm(worker.lat, worker.lng, farm.lat, farm.lng), precise: true };
  }
  if (norm(worker.state) && norm(worker.state) === norm(farm.state)) {
    if (norm(worker.lga) && norm(worker.lga) === norm(farm.lga)) return { km: 8, precise: false };
    return { km: 45, precise: false };
  }
  const a = findState(worker.state);
  const b = findState(farm.state);
  if (a && b) return { km: haversineKm(a.lat, a.lng, b.lat, b.lng), precise: false };
  return { km: 9999, precise: false };
}
