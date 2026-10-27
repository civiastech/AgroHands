// Skill catalogue. Labels live in the i18n files under skill.<key>.
// icon = pictogram for low-literacy users. level = typical worker level.
export const SKILLS = [
  { key: 'farmhand', icon: '🧑‍🌾', level: 'unskilled' },
  { key: 'land_clearing', icon: '🌳', level: 'unskilled' },
  { key: 'planting', icon: '🌱', level: 'unskilled' },
  { key: 'weeding', icon: '🌿', level: 'unskilled' },
  { key: 'harvesting', icon: '🧺', level: 'unskilled' },
  { key: 'spraying', icon: '💨', level: 'semi' },
  { key: 'nursery', icon: '🌿', level: 'semi' },
  { key: 'drip_irrigation', icon: '💧', level: 'skilled' },
  { key: 'greenhouse', icon: '🏠', level: 'skilled' },
  { key: 'palm_harvest', icon: '🌴', level: 'semi' },
  { key: 'poultry', icon: '🐔', level: 'semi' },
  { key: 'piggery', icon: '🐖', level: 'semi' },
  { key: 'ruminants', icon: '🐐', level: 'semi' },
  { key: 'fish_farming', icon: '🐟', level: 'semi' },
  { key: 'processing', icon: '🏭', level: 'semi' },
  { key: 'tractor', icon: '🚜', level: 'skilled' },
  { key: 'maintenance', icon: '🔧', level: 'skilled' },
  { key: 'driver', icon: '🚚', level: 'skilled' },
  { key: 'security', icon: '🛡️', level: 'unskilled' },
  { key: 'supervisor', icon: '📋', level: 'skilled' },
  { key: 'farm_manager', icon: '🧭', level: 'skilled' },
];

export const SKILL_KEYS = SKILLS.map((s) => s.key);
export const skillIcon = (key) => SKILLS.find((s) => s.key === key)?.icon || '•';
