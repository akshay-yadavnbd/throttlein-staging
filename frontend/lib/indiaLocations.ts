import citiesByState from './data/india-cities.json';

/*!
Indian state and city dropdown data

Sources:
- https://github.com/kalyangupta12/indian-cities-data
  data/generated/states.json, urban_local_bodies.json and the Lakshadweep
  entries from subdistricts.json, retrieved 2026-10-24.
  Canonical state names and municipal suffixes normalized for address entry.
- https://github.com/nshntarora/Indian-Cities-JSON
  cities.json, retrieved 2026-10-24. Supplemental city names; malformed urban
  agglomeration entries omitted, state aliases normalized.

MIT License

Copyright (c) 2026 Kalyan Gupta

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


The MIT License (MIT)

Copyright (c) 2016 Nishant Arora

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
const locations: Record<string, string[]> = citiesByState;
export const INDIAN_STATES = Object.keys(locations);

const stateAliases: Record<string, string> = {
  'dadra and nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu',
  'daman and diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'the dadra and nagar haveli and daman and diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'orissa': 'Odisha',
  'pondicherry': 'Puducherry',
  'uttaranchal': 'Uttarakhand',
  'nct of delhi': 'Delhi',
  'new delhi': 'Delhi',
};

export function normalizeIndianState(state: string): string {
  const name = state.trim().replace(/\s+/g, ' ').toLowerCase();
  if (Object.hasOwn(stateAliases, name)) return stateAliases[name];
  return INDIAN_STATES.find(option => option.toLowerCase() === name) || state.trim();
}

export function getIndianCities(state: string): readonly string[] {
  const name = normalizeIndianState(state);
  return Object.hasOwn(locations, name) ? locations[name] : [];
}
