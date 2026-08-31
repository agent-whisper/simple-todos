import { hash, verify as verifyHash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import type { Clock } from '../clock.js';
import type { Config } from '../config.js';
import { schema, type AppDb } from '../db/index.js';
import { UnauthenticatedError } from '../domain/errors.js';

const TOKEN_DAYS = 90;
const SINGLETON_ID = 1;

export class AuthService {
  readonly #db: AppDb;
  readonly #clock: Clock;
  readonly #config: Config;
  readonly #secret: Uint8Array;

  constructor(db: AppDb, clock: Clock, config: Config) {
    this.#db = db;
    this.#clock = clock;
    this.#config = config;
    this.#secret = new TextEncoder().encode(config.jwtSecret);
  }

  /** Seeds the user and settings from env on first boot only. */
  async seedIfMissing(): Promise<void> {
    const now = this.#clock.now().toISOString();

    const existing = this.#db.select().from(schema.users).where(eq(schema.users.id, SINGLETON_ID)).get();
    if (!existing) {
      this.#db
        .insert(schema.users)
        .values({
          id: SINGLETON_ID,
          username: this.#config.authUsername,
          passwordHash: await hash(this.#config.authPassword),
          tokenVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    const settings = this.#db.select().from(schema.settings).where(eq(schema.settings.id, SINGLETON_ID)).get();
    if (!settings) {
      this.#db
        .insert(schema.settings)
        .values({ id: SINGLETON_ID, timezone: this.#config.defaultTz, updatedAt: now })
        .run();
    }
  }

  async login(username: string, password: string): Promise<{ token: string; expiresAt: string }> {
    const user = this.#requireUser();
    const ok = username === user.username && (await verifyHash(user.passwordHash, password));
    // One message for both failures: never reveal which half was wrong.
    if (!ok) throw new UnauthenticatedError('invalid credentials');

    const issuedAt = this.#clock.now();
    const expires = new Date(issuedAt.getTime() + TOKEN_DAYS * 86_400_000);

    const token = await new SignJWT({ v: user.tokenVersion })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(user.id))
      .setIssuedAt(Math.floor(issuedAt.getTime() / 1000))
      .setExpirationTime(Math.floor(expires.getTime() / 1000))
      .sign(this.#secret);

    return { token, expiresAt: expires.toISOString() };
  }

  async verify(token: string): Promise<{ userId: number }> {
    const user = this.#requireUser();
    try {
      const { payload } = await jwtVerify(token, this.#secret, {
        currentDate: this.#clock.now(),
      });
      // A password change bumps token_version, retiring every token issued before it.
      if (payload.v !== user.tokenVersion) throw new Error('stale token version');
      return { userId: Number(payload.sub) };
    } catch {
      throw new UnauthenticatedError('invalid or expired token');
    }
  }

  me(): { username: string; timezone: string } {
    const user = this.#requireUser();
    const settings = this.#db.select().from(schema.settings).where(eq(schema.settings.id, SINGLETON_ID)).get();
    return { username: user.username, timezone: settings?.timezone ?? this.#config.defaultTz };
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const user = this.#requireUser();
    if (!(await verifyHash(user.passwordHash, currentPassword))) {
      throw new UnauthenticatedError('invalid credentials');
    }

    this.#db
      .update(schema.users)
      .set({
        passwordHash: await hash(newPassword),
        tokenVersion: user.tokenVersion + 1,
        updatedAt: this.#clock.now().toISOString(),
      })
      .where(eq(schema.users.id, SINGLETON_ID))
      .run();
  }

  #requireUser() {
    const user = this.#db.select().from(schema.users).where(eq(schema.users.id, SINGLETON_ID)).get();
    if (!user) throw new UnauthenticatedError('no user has been provisioned');
    return user;
  }
}
