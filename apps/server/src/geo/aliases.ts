/** Extra country names / abbreviations (case-sensitive keys are matched as written). */
export const COUNTRY_ALIASES: Record<string, string> = {
  'United States': 'US', USA: 'US', US: 'US', 'U.S.': 'US', America: 'US', 'United States of America': 'US',
  UK: 'GB', 'U.K.': 'GB', Britain: 'GB', 'Great Britain': 'GB', England: 'GB', Scotland: 'GB', Wales: 'GB', 'Northern Ireland': 'GB',
  Russia: 'RU', 'Russian Federation': 'RU', 'South Korea': 'KR', 'North Korea': 'KP', Korea: 'KR',
  Iran: 'IR', Syria: 'SY', Vietnam: 'VN', Laos: 'LA', Taiwan: 'TW', 'Czech Republic': 'CZ', Czechia: 'CZ',
  'Ivory Coast': 'CI', "Côte d'Ivoire": 'CI', DRC: 'CD', 'DR Congo': 'CD', 'Democratic Republic of Congo': 'CD',
  'Democratic Republic of the Congo': 'CD', 'Republic of Congo': 'CG', Holland: 'NL', 'The Netherlands': 'NL',
  UAE: 'AE', 'United Arab Emirates': 'AE', Emirates: 'AE', Palestine: 'PS', 'Palestinian territories': 'PS',
  'Gaza Strip': 'PS', Gaza: 'PS', 'West Bank': 'PS', Burma: 'MM', Myanmar: 'MM', Türkiye: 'TR', Turkiye: 'TR',
  Bosnia: 'BA', 'North Macedonia': 'MK', Macedonia: 'MK', Moldova: 'MD', Kosovo: 'XK', Vatican: 'VA',
  'East Timor': 'TL', 'Timor-Leste': 'TL', Eswatini: 'SZ', Swaziland: 'SZ', 'Cape Verde': 'CV', Bolivia: 'BO',
  Venezuela: 'VE', Tanzania: 'TZ', Brunei: 'BN', 'Hong Kong': 'HK', Macau: 'MO', 'South Sudan': 'SS',
  'Saudi Arabia': 'SA', 'New Zealand': 'NZ', 'Sri Lanka': 'LK', 'South Africa': 'ZA', 'Central African Republic': 'CF',
  Crimea: 'UA', Donbas: 'UA', Donbass: 'UA', Kashmir: 'IN', Kurdistan: 'IQ', Darfur: 'SD', Tigray: 'ET', Sahel: 'ML',
  // Greek / Russian / Ukrainian names for frequent countries
  Ελλάδα: 'GR', Ελλάδας: 'GR', Κύπρος: 'CY', Κύπρο: 'CY', Τουρκία: 'TR', Τουρκίας: 'TR', Ουκρανία: 'UA', Ρωσία: 'RU', ΗΠΑ: 'US', Ισραήλ: 'IL',
  Россия: 'RU', России: 'RU', Британия: 'GB', Британии: 'GB', Великобритания: 'GB', Великобритании: 'GB', Германии: 'DE', Франции: 'FR', Китае: 'CN', Китай: 'CN', Ирана: 'IR', Иран: 'IR', Турции: 'TR', Израиле: 'IL', Украина: 'UA', Украины: 'UA', США: 'US', Израиль: 'IL', Беларусь: 'BY',
  Україна: 'UA', України: 'UA', Росія: 'RU', Росії: 'RU', Білорусь: 'BY',
};

/** Demonyms are weaker evidence than place names. */
export const DEMONYMS: Record<string, string> = {
  American: 'US', Americans: 'US', British: 'GB', Russian: 'RU', Russians: 'RU', Ukrainian: 'UA', Ukrainians: 'UA',
  Israeli: 'IL', Israelis: 'IL', Palestinian: 'PS', Palestinians: 'PS', Iranian: 'IR', Iranians: 'IR', Chinese: 'CN',
  Japanese: 'JP', 'South Korean': 'KR', 'North Korean': 'KP', Indian: 'IN', Pakistani: 'PK', Afghan: 'AF',
  French: 'FR', German: 'DE', Italian: 'IT', Spanish: 'ES', Greek: 'GR', Greeks: 'GR', Turkish: 'TR', Syrian: 'SY',
  Lebanese: 'LB', Iraqi: 'IQ', Saudi: 'SA', Egyptian: 'EG', Yemeni: 'YE', Houthi: 'YE', Houthis: 'YE', Hezbollah: 'LB',
  Hamas: 'PS', Sudanese: 'SD', Ethiopian: 'ET', Kenyan: 'KE', Nigerian: 'NG', 'South African': 'ZA', Brazilian: 'BR',
  Argentine: 'AR', Argentinian: 'AR', Mexican: 'MX', Canadian: 'CA', Australian: 'AU', Polish: 'PL', Hungarian: 'HU',
  Serbian: 'RS', Romanian: 'RO', Bulgarian: 'BG', Cypriot: 'CY', Venezuelan: 'VE', Colombian: 'CO', Chilean: 'CL',
  Peruvian: 'PE', Taiwanese: 'TW', Filipino: 'PH', Indonesian: 'ID', Vietnamese: 'VN', Thai: 'TH', Burmese: 'MM',
  Bangladeshi: 'BD', Nepali: 'NP', Dutch: 'NL', Belgian: 'BE', Swiss: 'CH', Swedish: 'SE', Norwegian: 'NO', Danish: 'DK',
  Finnish: 'FI', Irish: 'IE', Portuguese: 'PT', Austrian: 'AT', Czech: 'CZ', Slovak: 'SK', Georgian: 'GE', Armenian: 'AM',
  Azerbaijani: 'AZ', Kazakh: 'KZ', Belarusian: 'BY', Moldovan: 'MD', Libyan: 'LY', Tunisian: 'TN', Algerian: 'DZ',
  Moroccan: 'MA', Somali: 'SO', Congolese: 'CD', Ghanaian: 'GH', Ugandan: 'UG', Rwandan: 'RW', Zimbabwean: 'ZW',
  Kremlin: 'RU', Pentagon: 'US', 'White House': 'US', 'Capitol Hill': 'US', Downing: 'GB', Westminster: 'GB',
  Knesset: 'IL', Bundestag: 'DE', Élysée: 'FR', Elysee: 'FR', Zelensky: 'UA', Zelenskyy: 'UA', Putin: 'RU', Netanyahu: 'IL',
  Erdogan: 'TR', Erdoğan: 'TR', Mitsotakis: 'GR', Modi: 'IN', Xi: 'CN',
};

/** Single words that are also city names but usually mean something else. */
export const AMBIGUOUS_WORDS = new Set(
  (
    'Mobile Reading Bath Nice Split Of Police Mission Orange Hope March May Most Bar Sale Commerce Independence Union ' +
    'Progress Victory Unity Concord Temple Victoria Florence Austin Jackson Charlotte Phoenix Aurora Eugene Irving Tyler ' +
    'Henderson Lincoln Darwin Logan Madison Hamilton Kent Marion Clinton Trump Bush Carter Kennedy Harris Vance Price ' +
    'Chester Mesa Plano Columbia Troy Sparta Florida Georgia Jordan Chad Turkey China Guinea Niger ' +
    'Of Ur Ad As Bo Da Ha He La Lo Ma Me Mo Na No Ob Oz Pa Po Sa So Ta To Wa Ya Ye Yu Zi Man Van Can Win Ali ' +
    'Gap Nancy Laval Ede Mons Spa Ford Jena Gela Ota Wels Tours Metz Brest Dover Gary Maple Surrey Normal Hull ' +
    'Deal Live Mail Nation Herald Gold Wells Street Price Rich Young Story Early Little Best Mount Bay Grand Union Liberty Paradise Glory Truth Ruth Golden Angel Venus Mars Eagle Lion ' +
    'Chatham Salem Pueblo Delta Alpha Omega Beta Gamma Ocean Ocala Rio Sur Norte Este Centro Alta'
  ).split(/\s+/),
);


/** Multi-word phrases that contain a place name but are not about that place. */
export const NON_PLACE_PHRASES = [
  'Washington Post', 'New York Times', 'Wall Street', 'Los Angeles Times', 'Hong Kong Free Press', 'Times of India',
  'Times of Israel', 'Jerusalem Post', 'Kyiv Independent', 'Moscow Times', 'Japan Times', 'China Daily', 'Real Madrid',
  'Manchester United', 'Manchester City', 'Paris Saint-Germain', 'Paris Hilton', 'Inter Milan', 'AC Milan', 'Boston Globe',
  'Chicago Tribune', 'Kansas City Chiefs', 'New York Post', 'Sydney Morning Herald', 'Buenos Aires Times', 'Toronto Star',
  'Dallas Cowboys', 'Michael Jordan', 'Jordan Peterson', 'Georgia Meloni', 'Giorgia Meloni', 'Turkey Day',
  'South China Morning Post', 'Al Jazeera', 'Middle East Eye', 'Mail & Guardian', 'Atlanta Fed', 'New York Fed',
];
