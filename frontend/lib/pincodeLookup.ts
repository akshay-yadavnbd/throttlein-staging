import { getIndianCities, normalizeIndianState } from './indiaLocations';

export async function lookupIndianPincode(
  pincode: string,
  signal: AbortSignal,
): Promise<{ city: string; state: string } | null> {
  if (!/^[1-9][0-9]{5}$/.test(pincode)) return null;

  const response = await fetch(`https://api.postalpincode.in/pincode/${pincode}`, { signal });
  if (!response.ok) throw new Error('Pincode lookup failed');
  const data = await response.json();
  const entry = Array.isArray(data) ? data[0] : null;
  const office = entry?.Status === 'Success' ? entry.PostOffice?.[0] : null;
  if (!office) return null;

  const state = typeof office.State === 'string' ? normalizeIndianState(office.State) : '';
  const city = [office.District, office.Division, office.Block]
    .find((value): value is string => typeof value === 'string' && !!value.trim())?.trim() || '';
  if (!city || !state) return null;

  const cityName = getIndianCities(state).find(name => name.toLowerCase() === city.toLowerCase());
  return { city: cityName || city, state };
}
