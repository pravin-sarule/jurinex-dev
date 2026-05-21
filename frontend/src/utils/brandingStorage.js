import { DEFAULT_BRANDING_PROFILE } from './brandingProfileDefaults';

const KEY = 'jurinex_branding_profiles';

export function getProfiles() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
  catch { return []; }
}

export function getProfile(id) {
  return getProfiles().find(p => p.id === id) || null;
}

export function getDefaultProfile() {
  return getProfiles().find(p => p.isDefault) || null;
}

export function saveProfile(profile) {
  const profiles = getProfiles();
  const idx = profiles.findIndex(p => p.id === profile.id);
  const now = new Date().toISOString();
  const updated = { ...profile, updatedAt: now };
  if (idx >= 0) {
    profiles[idx] = updated;
  } else {
    profiles.push({ ...updated, createdAt: now });
  }
  if (profile.isDefault) {
    profiles.forEach(p => { if (p.id !== profile.id) p.isDefault = false; });
  }
  localStorage.setItem(KEY, JSON.stringify(profiles));
  return updated;
}

export function deleteProfile(id) {
  localStorage.setItem(KEY, JSON.stringify(getProfiles().filter(p => p.id !== id)));
}

export function newProfile() {
  return {
    ...DEFAULT_BRANDING_PROFILE,
    id: crypto.randomUUID(),
    name: '',
    isDefault: false,
    createdAt: null,
    updatedAt: null,
    logo: '',
  };
}
