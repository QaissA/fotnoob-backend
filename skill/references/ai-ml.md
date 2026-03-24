# AI & ML Layer Reference

Generative AI match summaries via Amazon Bedrock (Claude), xG modelling, player ratings, and momentum graphs.

---

## Table of Contents
1. [Bedrock Setup](#1-bedrock-setup)
2. [Match Summary Generation](#2-match-summary-generation)
3. [Team Summary Feature](#3-team-summary-feature)
4. [Multi-Language Support](#4-multi-language-support)
5. [xG Model](#5-xg-model)
6. [Player Rating System](#6-player-rating-system)
7. [Momentum Graph](#7-momentum-graph)
8. [AI Job Queue](#8-ai-job-queue)
9. [Cost Management](#9-cost-management)

---

## 1. Bedrock Setup

FotMob uses **Amazon Bedrock with Anthropic Claude** for all generative AI. Claude is the most cost-efficient model for match report generation.

```bash
npm install @aws-sdk/client-bedrock-runtime
```

```typescript
// services/news/src/ai/bedrock.ts
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

// Model IDs — always use the latest available
const CLAUDE_MODEL = 'anthropic.claude-sonnet-4-5';

export async function invokeClaudeModel(
  prompt: string,
  systemPrompt?: string,
  maxTokens = 1024
): Promise<string> {
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    system: systemPrompt ?? undefined,
    messages: [{ role: 'user', content: prompt }],
  };

  const command = new InvokeModelCommand({
    modelId: CLAUDE_MODEL,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  });

  const response = await bedrock.send(command);
  const result = JSON.parse(new TextDecoder().decode(response.body));
  return result.content[0].text as string;
}
```

---

## 2. Match Summary Generation

Called asynchronously after the final whistle.

```typescript
// services/news/src/ai/match-summary.ts

interface MatchSummaryInput {
  match: Match;
  events: MatchEvent[];
  stats: MatchStats;
  homePlayerRatings: PlayerMatchRating[];
  awayPlayerRatings: PlayerMatchRating[];
}

const SYSTEM_PROMPT = `You are a football journalist writing match reports for a sports app.
Write concise, engaging reports in 2-3 paragraphs. Use an informative but exciting tone.
Focus on key moments, standout performances, and the story of the match.
Avoid clichés. Don't repeat statistics the user can already see.
Output plain text only — no markdown, no headers.`;

export async function generateMatchSummary(input: MatchSummaryInput): Promise<string> {
  const { match, events, stats, homePlayerRatings, awayPlayerRatings } = input;

  // Build structured prompt from match data
  const goals = events.filter(e => e.type === 'GOAL' || e.type === 'OWN_GOAL');
  const redCards = events.filter(e => e.type === 'RED_CARD' || e.type === 'SECOND_YELLOW');
  const bestHome = homePlayerRatings.sort((a, b) => b.rating - a.rating)[0];
  const bestAway = awayPlayerRatings.sort((a, b) => b.rating - a.rating)[0];

  const prompt = `
Write a match report for this football match:

MATCH: ${match.homeTeam.name} ${match.homeScore}–${match.awayScore} ${match.awayTeam.name}
COMPETITION: ${match.leagueName}, ${match.round}
DATE: ${new Date(match.kickoffTime).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

GOALS:
${goals.map(g => `${g.minute}' ${g.playerName} (${g.teamId === match.homeTeamId ? match.homeTeam.name : match.awayTeam.name})${g.assistPlayerName ? ` assisted by ${g.assistPlayerName}` : ''}`).join('\n') || 'No goals scored'}

${redCards.length ? `RED CARDS:\n${redCards.map(r => `${r.minute}' ${r.playerName} (${r.teamId === match.homeTeamId ? match.homeTeam.name : match.awayTeam.name})`).join('\n')}` : ''}

STATS:
- Possession: ${match.homeTeam.shortName} ${stats.possessionHome}% vs ${match.awayTeam.shortName} ${stats.possessionAway}%
- Shots: ${stats.shotsHome} vs ${stats.shotsAway} (on target: ${stats.shotsOnTargetHome} vs ${stats.shotsOnTargetAway})
- xG: ${stats.xGHome?.toFixed(2)} vs ${stats.xGAway?.toFixed(2)}

TOP PERFORMERS:
- ${match.homeTeam.name}: ${bestHome?.player.name ?? 'N/A'} (${bestHome?.rating.toFixed(1) ?? 'N/A'}/10, ${bestHome?.goals ?? 0} goals, ${bestHome?.assists ?? 0} assists)
- ${match.awayTeam.name}: ${bestAway?.player.name ?? 'N/A'} (${bestAway?.rating.toFixed(1) ?? 'N/A'}/10, ${bestAway?.goals ?? 0} goals, ${bestAway?.assists ?? 0} assists)

Write a 2-3 paragraph report covering the flow of the match, key moments, and standout individual performances.
  `.trim();

  return invokeClaudeModel(prompt, SYSTEM_PROMPT, 512);
}
```

---

## 3. Team Summary Feature

FotMob's first live AI feature: an ongoing narrative about a team's season form.

```typescript
interface TeamSummaryInput {
  team: Team;
  recentMatches: Match[];           // last 5 matches
  standings: Standing;
  topScorer: { player: Player; goals: number };
  season: Season;
}

const TEAM_SUMMARY_SYSTEM = `You are a football analyst writing concise team form summaries.
Write 1-2 short paragraphs (max 100 words total). Be direct and factual.
Focus on recent form, key players, and standing context.
Do not use first person. Output plain text only.`;

export async function generateTeamSummary(input: TeamSummaryInput): Promise<string> {
  const { team, recentMatches, standings, topScorer, season } = input;

  const form = recentMatches.map(m => {
    const isHome = m.homeTeamId === team.id;
    const teamScore = isHome ? m.homeScore : m.awayScore;
    const oppScore = isHome ? m.awayScore : m.homeScore;
    const opp = isHome ? m.awayTeam.name : m.homeTeam.name;
    const result = teamScore > oppScore ? 'W' : teamScore < oppScore ? 'L' : 'D';
    return `${result} ${teamScore}–${oppScore} vs ${opp}`;
  }).join(', ');

  const prompt = `
Team: ${team.name}
League: ${season.name} — Position: ${standings.position} (${standings.points} pts, ${standings.won}W ${standings.drawn}D ${standings.lost}L)
Recent form: ${form}
Top scorer: ${topScorer.player.name} — ${topScorer.goals} goals

Write a brief current season summary.
  `.trim();

  return invokeClaudeModel(prompt, TEAM_SUMMARY_SYSTEM, 200);
}
```

---

## 4. Multi-Language Support

Claude handles translation natively. Add a `language` parameter and append an instruction.

```typescript
const SUPPORTED_LANGUAGES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  de: 'German',
  fr: 'French',
  pt: 'Portuguese',
  it: 'Italian',
  ar: 'Arabic',
  tr: 'Turkish',
};

export async function generateMatchSummaryInLanguage(
  input: MatchSummaryInput,
  languageCode: string
): Promise<string> {
  const language = SUPPORTED_LANGUAGES[languageCode] ?? 'English';
  const englishPrompt = buildMatchSummaryPrompt(input);

  const prompt = languageCode === 'en'
    ? englishPrompt
    : `${englishPrompt}\n\nWrite the report in ${language}.`;

  return invokeClaudeModel(prompt, SYSTEM_PROMPT, 700);  // more tokens for non-Latin scripts
}

// Cache summaries per match per language to avoid redundant API calls
export async function getCachedOrGenerateSummary(
  matchId: string,
  language: string,
  generator: () => Promise<string>
): Promise<string> {
  const cacheKey = `summary:${matchId}:${language}`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  const summary = await generator();
  await redis.setex(cacheKey, 86400, summary);  // cache 24h
  return summary;
}
```

---

## 5. xG Model

Expected Goals (xG) — probability that a shot results in a goal.

```typescript
// services/stats/src/ml/xg.ts

interface ShotFeatures {
  distanceFromGoal: number;   // metres
  angleFromCentre: number;    // degrees (0 = straight on, 90 = side of box)
  bodyPart: 'foot' | 'head' | 'other';
  shotType: 'open_play' | 'set_piece' | 'corner' | 'penalty';
  isAssisted: boolean;
  isCounterAttack: boolean;
  minute: number;
}

// Logistic regression model trained on ~500k historical shots
// Coefficients from training (placeholder values — train on real data)
const INTERCEPT = -2.1;
const COEFFICIENTS = {
  distanceClose: 1.8,      // distance < 6m
  distanceMid: 0.9,        // 6–11m
  distanceFar: 0.1,        // 11–16m
  distanceVeryFar: -0.4,   // > 16m
  angleWide: 0.5,          // angle > 30°
  angleNarrow: -0.3,       // angle < 10°
  head: -0.6,
  isAssisted: 0.5,
  isCounterAttack: 0.3,
  setPiece: 0.2,
  corner: -0.1,
  penalty: 3.8,
};

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function computeXG(shot: ShotFeatures): number {
  let logit = INTERCEPT;

  // Distance
  if (shot.distanceFromGoal < 6)        logit += COEFFICIENTS.distanceClose;
  else if (shot.distanceFromGoal < 11)  logit += COEFFICIENTS.distanceMid;
  else if (shot.distanceFromGoal < 16)  logit += COEFFICIENTS.distanceFar;
  else                                   logit += COEFFICIENTS.distanceVeryFar;

  // Angle
  if (shot.angleFromCentre > 30)        logit += COEFFICIENTS.angleWide;
  else if (shot.angleFromCentre < 10)   logit += COEFFICIENTS.angleNarrow;

  // Body part
  if (shot.bodyPart === 'head')         logit += COEFFICIENTS.head;

  // Context
  if (shot.isAssisted)                  logit += COEFFICIENTS.isAssisted;
  if (shot.isCounterAttack)             logit += COEFFICIENTS.isCounterAttack;
  if (shot.shotType === 'set_piece')    logit += COEFFICIENTS.setPiece;
  if (shot.shotType === 'corner')       logit += COEFFICIENTS.corner;
  if (shot.shotType === 'penalty')      logit += COEFFICIENTS.penalty;

  return Math.max(0.01, Math.min(0.99, sigmoid(logit)));
}

// Compute cumulative match xG from shot events
export function computeMatchXG(shots: ShotEvent[]): { home: number; away: number } {
  return shots.reduce((acc, shot) => {
    const xg = computeXG(extractFeatures(shot));
    if (shot.teamSide === 'home') acc.home += xg;
    else acc.away += xg;
    return acc;
  }, { home: 0, away: 0 });
}
```

---

## 6. Player Rating System

```typescript
// services/stats/src/ml/player-rating.ts

// Contribution weights per action type
// Positive = beneficial, negative = harmful
const ACTION_WEIGHTS: Record<string, number> = {
  // Attacking
  GOAL: 2.0,
  ASSIST: 1.2,
  SHOT_ON_TARGET: 0.3,
  SHOT_OFF_TARGET: 0.05,
  KEY_PASS: 0.5,
  CHANCE_CREATED: 0.35,
  DRIBBLE_SUCCESS: 0.2,
  DRIBBLE_FAIL: -0.05,

  // Defensive
  TACKLE_WON: 0.3,
  TACKLE_LOST: -0.1,
  INTERCEPTION: 0.2,
  CLEARANCE: 0.15,
  BLOCK: 0.2,
  AERIAL_WON: 0.1,
  AERIAL_LOST: -0.05,
  FOUL: -0.1,
  DISPOSSESSED: -0.1,

  // Goalkeeping
  SAVE: 0.6,
  SAVE_PENALTY: 1.5,
  GOAL_CONCEDED: -0.4,

  // Discipline
  YELLOW_CARD: -0.5,
  RED_CARD: -1.5,
};

// Position-specific baseline
const POSITION_BASELINE: Record<string, number> = {
  GK: 6.0,
  DEF: 6.2,
  MID: 6.0,
  FWD: 5.8,
};

export function computePlayerRating(
  player: Player,
  actions: PlayerAction[],
  minutesPlayed: number
): number {
  const baseline = POSITION_BASELINE[player.position ?? 'MID'];
  const minutesFactor = Math.min(1, minutesPlayed / 70);  // partial credit < 70 min

  const contribution = actions.reduce(
    (sum, action) => sum + (ACTION_WEIGHTS[action.type] ?? 0),
    0
  );

  const raw = baseline + (contribution * minutesFactor);
  return Math.round(Math.max(1, Math.min(10, raw)) * 10) / 10;  // 1dp, 1–10
}
```

---

## 7. Momentum Graph

Rolling xG differential over time — shows which team dominated each period.

```typescript
// Compute momentum data for a match
export function computeMomentum(
  shots: ShotEvent[],
  windowMinutes = 5
): MomentumPoint[] {
  const points: MomentumPoint[] = [];

  for (let minute = 0; minute <= 90; minute += 1) {
    const windowShots = shots.filter(s =>
      s.minute >= Math.max(0, minute - windowMinutes) &&
      s.minute <= minute
    );

    const homeXG = windowShots
      .filter(s => s.teamSide === 'home')
      .reduce((sum, s) => sum + computeXG(extractFeatures(s)), 0);

    const awayXG = windowShots
      .filter(s => s.teamSide === 'away')
      .reduce((sum, s) => sum + computeXG(extractFeatures(s)), 0);

    points.push({
      minute,
      delta: homeXG - awayXG,   // positive = home dominating, negative = away
      homeXG,
      awayXG,
    });
  }

  return points;
}

interface MomentumPoint {
  minute: number;
  delta: number;
  homeXG: number;
  awayXG: number;
}
```

---

## 8. AI Job Queue

All generative AI calls are async — never block an API response waiting for Claude.

```typescript
// services/news/src/jobs/summary-worker.ts
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: process.env.AWS_REGION });

// Long-polling worker — runs continuously in EKS pod
export async function startSummaryWorker(): Promise<never> {
  console.log('Summary worker started');
  while (true) {
    const result = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: process.env.SUMMARY_QUEUE_URL!,
      WaitTimeSeconds: 20,    // long polling
      MaxNumberOfMessages: 5,
    }));

    for (const message of result.Messages ?? []) {
      try {
        const { type, id, language } = JSON.parse(message.Body!);

        if (type === 'match') {
          const summary = await generateMatchSummaryForId(id, language ?? 'en');
          await prisma.article.update({
            where: { matchId: id },
            data: { aiSummary: summary, status: 'SUMMARISED' }
          });
        }

        if (type === 'team') {
          const summary = await generateTeamSummaryForId(id, language ?? 'en');
          await prisma.team.update({
            where: { id },
            data: { aiSummary: summary, aiSummaryUpdatedAt: new Date() }
          });
        }

        await sqs.send(new DeleteMessageCommand({
          QueueUrl: process.env.SUMMARY_QUEUE_URL!,
          ReceiptHandle: message.ReceiptHandle!,
        }));

      } catch (err) {
        console.error('Summary job failed:', err);
        // Message will become visible again after visibility timeout → retry
      }
    }
  }
}
```

---

## 9. Cost Management

Bedrock Claude pricing is per token. At scale this adds up fast.

### Optimisations
```typescript
// 1. Cap input tokens — truncate long match event lists
function truncatePrompt(prompt: string, maxInputTokens = 2000): string {
  const words = prompt.split(' ');
  if (words.length <= maxInputTokens * 0.75) return prompt;  // rough word→token estimate
  return words.slice(0, maxInputTokens * 0.75).join(' ') + '\n[...truncated]';
}

// 2. Cache aggressively — never regenerate a summary that exists
// 3. Only generate for matches users actually view (on-demand, not batch all matches)
// 4. Use claude-haiku-4 for team summaries (cheaper), claude-sonnet for match reports

// 5. Track spend per day
export async function trackAISpend(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  const pricing: Record<string, { input: number; output: number }> = {
    'anthropic.claude-sonnet-4-5': { input: 0.003, output: 0.015 },   // per 1k tokens
    'anthropic.claude-haiku-4-5-20251001': { input: 0.00025, output: 0.00125 },
  };
  const p = pricing[modelId];
  if (!p) return;
  const cost = (inputTokens * p.input + outputTokens * p.output) / 1000;

  const today = new Date().toISOString().split('T')[0];
  await redis.incrbyfloat(`ai:spend:${today}`, cost);
}

// Alert if daily AI spend exceeds threshold
export async function checkAISpendAlert(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const spend = parseFloat(await redis.get(`ai:spend:${today}`) ?? '0');
  if (spend > 50) {  // alert at $50/day
    await alertOncall(`AI spend today: $${spend.toFixed(2)}`);
  }
}
```
