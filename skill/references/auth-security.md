# Auth & Security Reference

JWT auth, OAuth social login, rate limiting, HMAC webhook verification, and general API security for the FotMob-clone platform.

---

## Table of Contents
1. [Auth Strategy Overview](#1-auth-strategy-overview)
2. [JWT — Access & Refresh Tokens](#2-jwt--access--refresh-tokens)
3. [OAuth — Social Login](#3-oauth--social-login)
4. [Fastify Auth Plugin](#4-fastify-auth-plugin)
5. [Rate Limiting](#5-rate-limiting)
6. [Webhook HMAC Verification](#6-webhook-hmac-verification)
7. [Password Hashing](#7-password-hashing)
8. [CORS Configuration](#8-cors-configuration)
9. [API Security Checklist](#9-api-security-checklist)

---

## 1. Auth Strategy Overview

| Flow | Token Type | Expiry | Used for |
|------|-----------|--------|----------|
| Email/password login | Access JWT | 15 min | API requests |
| — | Refresh JWT | 30 days | Renew access token |
| OAuth (Google/Apple) | Access JWT | 15 min | Same as above |
| Data provider webhooks | HMAC signature | Per-request | Verify event origin |
| Service-to-service | Service JWT | 1 hour | Internal API calls |

**Why short access token expiry (15 min)?**
If a token is stolen, it's only valid for 15 minutes. The refresh token is rotated on each use (rotation + reuse detection), so a stolen refresh token is also detectable.

---

## 2. JWT — Access & Refresh Tokens

```typescript
// services/user/src/auth/tokens.ts
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../db';
import bcrypt from 'bcryptjs';

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET!;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;   // different secret

export interface TokenPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

// Generate token pair
export function generateTokens(userId: string, email: string) {
  const accessToken = jwt.sign(
    { userId, email },
    ACCESS_SECRET,
    { expiresIn: '15m', algorithm: 'HS256' }
  );

  const refreshToken = jwt.sign(
    { userId, type: 'refresh', jti: crypto.randomUUID() },  // jti = unique token ID
    REFRESH_SECRET,
    { expiresIn: '30d', algorithm: 'HS256' }
  );

  return { accessToken, refreshToken };
}

// Verify access token
export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, ACCESS_SECRET) as TokenPayload;
}

// Refresh token rotation
export async function rotateRefreshToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  let payload: any;
  try {
    payload = jwt.verify(refreshToken, REFRESH_SECRET);
  } catch {
    throw new Error('Invalid refresh token');
  }

  // Check token exists and hasn't been revoked
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const stored = await prisma.refreshToken.findFirst({
    where: { userId: payload.userId, tokenHash, revokedAt: null }
  });

  if (!stored) {
    // Reuse detected! Revoke ALL tokens for this user (possible token theft)
    await prisma.refreshToken.updateMany({
      where: { userId: payload.userId },
      data: { revokedAt: new Date() }
    });
    throw new Error('Refresh token reuse detected — all sessions revoked');
  }

  // Revoke the current refresh token
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() }
  });

  // Issue new token pair
  const user = await prisma.user.findUniqueOrThrow({ where: { id: payload.userId } });
  const { accessToken, refreshToken: newRefreshToken } = generateTokens(user.id, user.email);

  // Store new refresh token hash
  const newHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: newHash,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    }
  });

  return { accessToken, refreshToken: newRefreshToken };
}
```

---

## 3. OAuth — Social Login

### Google OAuth
```typescript
// services/user/src/auth/google.ts
import { OAuth2Client } from 'google-auth-library';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export async function verifyGoogleToken(idToken: string): Promise<{
  googleId: string;
  email: string;
  name: string;
  picture: string;
}> {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload()!;
  return {
    googleId: payload.sub,
    email: payload.email!,
    name: payload.name!,
    picture: payload.picture!,
  };
}

// POST /auth/google
fastify.post('/auth/google', async (req, reply) => {
  const { idToken } = req.body as { idToken: string };

  const googleUser = await verifyGoogleToken(idToken);

  // Find or create user
  let user = await prisma.user.findFirst({
    where: { OR: [{ googleId: googleUser.googleId }, { email: googleUser.email }] }
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: googleUser.email,
        displayName: googleUser.name,
        avatarUrl: googleUser.picture,
        googleId: googleUser.googleId,
        passwordHash: '',   // no password for OAuth users
      }
    });
  } else if (!user.googleId) {
    // Link Google account to existing email account
    await prisma.user.update({
      where: { id: user.id },
      data: { googleId: googleUser.googleId }
    });
  }

  const tokens = generateTokens(user.id, user.email);
  await storeRefreshToken(user.id, tokens.refreshToken);
  return tokens;
});
```

### Apple Sign In
```typescript
import appleSignIn from 'apple-signin-auth';

// POST /auth/apple
fastify.post('/auth/apple', async (req, reply) => {
  const { identityToken, authorizationCode, fullName } = req.body as AppleLoginDTO;

  const appleUser = await appleSignIn.verifyIdToken(identityToken, {
    audience: process.env.APPLE_CLIENT_ID,
    ignoreExpiration: false,
  });

  let user = await prisma.user.findFirst({
    where: { OR: [{ appleId: appleUser.sub }, { email: appleUser.email }] }
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: appleUser.email ?? `${appleUser.sub}@privaterelay.apple.com`,
        displayName: fullName ? `${fullName.givenName} ${fullName.familyName}` : 'Apple User',
        appleId: appleUser.sub,
        passwordHash: '',
      }
    });
  }

  const tokens = generateTokens(user.id, user.email);
  await storeRefreshToken(user.id, tokens.refreshToken);
  return tokens;
});
```

---

## 4. Fastify Auth Plugin

```typescript
// services/user/src/plugins/auth.ts
import fp from 'fastify-plugin';
import { verifyAccessToken } from '../auth/tokens';

declare module 'fastify' {
  interface FastifyRequest {
    user: { userId: string; email: string };
  }
}

export const authPlugin = fp(async (fastify) => {
  fastify.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing auth token' });
    }
    const token = authHeader.split(' ')[1];
    try {
      req.user = verifyAccessToken(token);
    } catch (err: any) {
      const message = err.name === 'TokenExpiredError'
        ? 'Token expired'
        : 'Invalid token';
      return reply.code(401).send({ error: message });
    }
  });
});

// Usage on any route
fastify.get('/users/me', { onRequest: [fastify.authenticate] }, async (req) => {
  return prisma.user.findUniqueOrThrow({ where: { id: req.user.userId } });
});
```

---

## 5. Rate Limiting

```typescript
// Per-IP rate limits (unauthenticated)
fastify.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.ip,
  errorResponseBuilder: () => ({
    statusCode: 429,
    error: 'Too Many Requests',
    message: 'Rate limit exceeded. Please slow down.',
  }),
});

// Per-user rate limits (authenticated) — stricter for write endpoints
fastify.register(rateLimit, {
  max: 20,
  timeWindow: '1 minute',
  keyGenerator: (req) => (req as any).user?.userId ?? req.ip,
});

// Webhook endpoints — IP allowlist instead of rate limit
const PROVIDER_IPS = process.env.PROVIDER_IP_ALLOWLIST?.split(',') ?? [];

fastify.addHook('onRequest', async (req, reply) => {
  if (req.url.startsWith('/webhooks/') && !PROVIDER_IPS.includes(req.ip)) {
    reply.code(403).send({ error: 'Forbidden' });
  }
});
```

### Redis-backed distributed rate limiting
For rate limits that work across multiple pods:
```typescript
import { RateLimiterRedis } from 'rate-limiter-flexible';

const limiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl',
  points: 100,
  duration: 60,
});

fastify.addHook('onRequest', async (req, reply) => {
  try {
    await limiter.consume(req.ip);
  } catch {
    reply.code(429).send({ error: 'Too many requests' });
  }
});
```

---

## 6. Webhook HMAC Verification

Every data provider sends an HMAC signature so you can verify the request is genuine.

```typescript
// Generic HMAC verifier
export function verifyHmac(
  payload: string | Buffer,
  signature: string,
  secret: string,
  algorithm: 'sha256' | 'sha1' = 'sha256'
): boolean {
  const expected = crypto
    .createHmac(algorithm, secret)
    .update(payload)
    .digest('hex');

  // Use timingSafeEqual to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature.replace(`${algorithm}=`, '')),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

// Provider-specific verification
export function verifySignature(
  provider: string,
  headers: Record<string, string | undefined>,
  rawBody: string
): boolean {
  switch (provider) {
    case 'sportradar':
      return verifyHmac(rawBody, headers['x-sportradar-signature'] ?? '', process.env.SPORTRADAR_SECRET!);
    case 'statsperform':
      return verifyHmac(rawBody, headers['x-opta-signature'] ?? '', process.env.STATSPERFORM_SECRET!);
    default:
      return false;
  }
}
```

---

## 7. Password Hashing

```typescript
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;  // ~250ms on modern hardware — good balance

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Password strength validation
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain a number';
  return null;  // valid
}
```

---

## 8. CORS Configuration

```typescript
// Allow web app and mobile app origins
const ALLOWED_ORIGINS = [
  'https://fotmob.app',
  'https://www.fotmob.app',
  // Dev
  'http://localhost:4200',   // Angular dev server
];

fastify.register(cors, {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'), false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,  // 24h preflight cache
});
```

---

## 9. API Security Checklist

Before going to production, verify all of these:

**Auth**
- [ ] Access tokens expire in ≤ 15 minutes
- [ ] Refresh tokens are rotated on every use
- [ ] Refresh token reuse detection implemented (revoke all sessions on reuse)
- [ ] Passwords hashed with bcrypt (cost ≥ 12)
- [ ] OAuth ID tokens verified server-side (never trust client-supplied user ID)

**Transport**
- [ ] HTTPS enforced everywhere (CloudFront → redirect HTTP to HTTPS)
- [ ] HSTS header set: `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- [ ] No sensitive data in URLs (tokens, passwords) — use Authorization header

**Input validation**
- [ ] All request bodies validated with Zod schemas before processing
- [ ] Path parameters validated (e.g. UUID format) before DB queries
- [ ] Query parameter injection impossible (use parameterised Prisma queries only)

**Webhooks**
- [ ] HMAC signatures verified on all incoming webhooks
- [ ] Provider IP allowlist enforced
- [ ] Webhook endpoints do NOT return sensitive data in error responses

**Headers**
- [ ] `X-Content-Type-Options: nosniff`
- [ ] `X-Frame-Options: DENY`
- [ ] `Content-Security-Policy` set on web app
- [ ] `Authorization` header never logged

**Rate limiting**
- [ ] Per-IP limits on all unauthenticated endpoints
- [ ] Per-user limits on write endpoints
- [ ] Auth endpoints (login, register) have strict limits (5 req/min per IP)
- [ ] Distributed rate limiting via Redis (not per-pod memory)

**Secrets**
- [ ] No secrets in code or git history
- [ ] All secrets in AWS Secrets Manager
- [ ] Different secrets per environment (dev/staging/prod)
- [ ] JWT secrets ≥ 64 characters, randomly generated
