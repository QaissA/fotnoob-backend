export const LEAGUE_CODES = {
  PREMIER_LEAGUE:   'PL',
  CHAMPIONS_LEAGUE: 'CL',
  LA_LIGA:          'PD',
  BUNDESLIGA:       'BL1',
  SERIE_A:          'SA',
  LIGUE_1:          'FL1',
  EREDIVISIE:       'DED',
  PRIMEIRA_LIGA:    'PPL',
  CHAMPIONSHIP:     'ELC',
  WORLD_CUP:        'WC',
  EUROS:            'EC',
  COPA_DEL_REY:     'CDR',
} as const;

export type LeagueCode = typeof LEAGUE_CODES[keyof typeof LEAGUE_CODES];
