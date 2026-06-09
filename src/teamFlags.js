export const TEAM_FLAGS = {
  Mexico: 'mx',
  'South Africa': 'za',
  'Korea Republic': 'kr',
  'South Korea': 'kr',
  Czechia: 'cz',
  'Czech Republic': 'cz',

  Canada: 'ca',
  'Bosnia and Herzegovina': 'ba',
  Qatar: 'qa',
  Switzerland: 'ch',

  Brazil: 'br',
  Morocco: 'ma',
  Haiti: 'ht',
  Scotland: 'gb-sct',

  'United States': 'us',
  USA: 'us',
  Paraguay: 'py',
  Australia: 'au',
  Türkiye: 'tr',
  Turkey: 'tr',

  Germany: 'de',
  Curaçao: 'cw',
  Curacao: 'cw',
  'Ivory Coast': 'ci',
  Ecuador: 'ec',

  Netherlands: 'nl',
  Japan: 'jp',
  Sweden: 'se',
  Tunisia: 'tn',

  Belgium: 'be',
  Egypt: 'eg',
  Iran: 'ir',
  'New Zealand': 'nz',

  Spain: 'es',
  'Cape Verde': 'cv',
  'Saudi Arabia': 'sa',
  Uruguay: 'uy',

  France: 'fr',
  Senegal: 'sn',
  Iraq: 'iq',
  Norway: 'no',

  Argentina: 'ar',
  Algeria: 'dz',
  Austria: 'at',
  Jordan: 'jo',

  Portugal: 'pt',
  'Congo DR': 'cd',
  'DR Congo': 'cd',
  Uzbekistan: 'uz',
  Colombia: 'co',

  England: 'gb-eng',
  Croatia: 'hr',
  Ghana: 'gh',
  Panama: 'pa'
};

export function flagUrl(teamName) {
  const code = TEAM_FLAGS[teamName];
  return code ? `https://flagcdn.com/w40/${code}.png` : '';
}