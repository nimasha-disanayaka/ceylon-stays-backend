/**
 * Calculate distance between two GPS coordinates in Kilometers (Haversine Formula)
 */
export function calculateDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (lat1 === lat2 && lon1 === lon2) return 0;

  const R = 6371; // Earth's mean radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return Number(distance.toFixed(1)); // Return rounded to 1 decimal place (e.g. 2.4 km)
}

/**
 * Built-in Geocoding helper for popular tourist destinations in Sri Lanka
 */
export const CITY_COORDINATES: Record<string, { lat: number; lng: number }> = {
  colombo: { lat: 6.9271, lng: 79.8612 },
  galle: { lat: 6.0329, lng: 80.2168 },
  ella: { lat: 6.8667, lng: 81.0466 },
  kandy: { lat: 7.2906, lng: 80.6337 },
  nuwaraeliya: { lat: 6.9497, lng: 80.7891 },
  mirissa: { lat: 5.9483, lng: 80.4533 },
  sigiriya: { lat: 7.957, lng: 80.7603 },
  negombo: { lat: 7.2008, lng: 79.8737 },
  trincomalee: { lat: 8.5874, lng: 81.2152 },
  arugambay: { lat: 6.8415, lng: 81.8364 },
  hikkaduwa: { lat: 6.1392, lng: 80.1063 },
  bentota: { lat: 6.4256, lng: 79.9986 },
};

/**
 * Lookup coordinates for a city name
 */
export function geocodeCity(cityQuery: string): { lat: number; lng: number } | null {
  const normalized = cityQuery.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [cityName, coords] of Object.entries(CITY_COORDINATES)) {
    if (normalized.includes(cityName) || cityName.includes(normalized)) {
      return coords;
    }
  }
  return null;
}
