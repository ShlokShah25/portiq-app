/**
 * Detect Zoom or Microsoft Teams from a pasted meeting URL.
 * @returns {'zoom' | 'teams' | null}
 */
export function detectConferenceProvider(url) {
  if (!url || typeof url !== 'string') return null;
  const u = url.trim().toLowerCase();
  if (!u) return null;
  try {
    const host = new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '');
    if (
      host.includes('zoom.us') ||
      host.includes('zoom.com') ||
      u.includes('zoom.us/') ||
      u.includes('zoom.com/')
    ) {
      return 'zoom';
    }
    if (
      host === 'teams.microsoft.com' ||
      host === 'teams.live.com' ||
      host.endsWith('.teams.microsoft.com') ||
      u.includes('teams.microsoft.com') ||
      u.includes('teams.live.com')
    ) {
      return 'teams';
    }
  } catch {
    if (u.includes('zoom.us') || u.includes('zoom.com')) return 'zoom';
    if (u.includes('teams.microsoft.com') || u.includes('teams.live.com')) return 'teams';
  }
  return null;
}

export function conferenceProviderLabel(provider) {
  if (provider === 'zoom') return 'Zoom Meeting';
  if (provider === 'teams') return 'Teams Meeting';
  return null;
}
