import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from '../../test/helpers/testApp.js';
import { SettingsService } from './settingsService.js';

let ctx: TestApp;
let settings: SettingsService;

beforeEach(async () => {
  ctx = await makeTestApp('2026-08-31T01:00:00Z');
  settings = new SettingsService(ctx.db, ctx.clock);
});

afterEach(async () => {
  await ctx.close();
});

describe('get', () => {
  it('returns the seeded defaults', () => {
    expect(settings.get()).toMatchObject({
      timezone: 'Asia/Tokyo',
      sweepTime: '03:00',
      reminderEnabled: false,
      reminderTime: '08:00',
      webhookKind: null,
      webhookUrl: null,
    });
  });

  it('exposes reminderEnabled as a boolean, not SQLite 0/1', () => {
    expect(typeof settings.get().reminderEnabled).toBe('boolean');
  });
});

describe('update', () => {
  it('changes only the fields present in the patch', () => {
    const updated = settings.update({ timezone: 'Europe/London' });
    expect(updated.timezone).toBe('Europe/London');
    expect(updated.sweepTime).toBe('03:00');
  });

  it('stamps updatedAt from the clock', () => {
    ctx.clock.set('2026-09-05T00:00:00Z');
    expect(settings.update({ sweepTime: '04:00' }).updatedAt).toBe('2026-09-05T00:00:00.000Z');
  });

  it('rejects a timezone that is not a real IANA zone', () => {
    expect(() => settings.update({ timezone: 'Not/AZone' })).toThrow(/timezone/i);
  });

  it('accepts a half-hour and a 45-minute zone', () => {
    expect(settings.update({ timezone: 'Asia/Kolkata' }).timezone).toBe('Asia/Kolkata');
    expect(settings.update({ timezone: 'Asia/Kathmandu' }).timezone).toBe('Asia/Kathmandu');
  });

  it('refuses to enable the reminder with no webhook configured', () => {
    expect(() => settings.update({ reminderEnabled: true })).toThrow(/webhook/i);
  });

  it('enables the reminder when a webhook is supplied in the same patch', () => {
    const updated = settings.update({
      reminderEnabled: true,
      webhookKind: 'discord',
      webhookUrl: 'https://discord.com/api/webhooks/1/abc',
    });
    expect(updated.reminderEnabled).toBe(true);
  });

  it('enables the reminder when a webhook was already stored', () => {
    settings.update({ webhookKind: 'slack', webhookUrl: 'https://hooks.slack.com/services/A/B/C' });
    expect(settings.update({ reminderEnabled: true }).reminderEnabled).toBe(true);
  });

  it('refuses to clear the webhook while the reminder is still enabled', () => {
    settings.update({
      reminderEnabled: true,
      webhookKind: 'discord',
      webhookUrl: 'https://discord.com/api/webhooks/1/abc',
    });
    expect(() => settings.update({ webhookUrl: null })).toThrow(/webhook/i);
  });

  it('allows clearing the webhook once the reminder is disabled', () => {
    settings.update({
      reminderEnabled: true,
      webhookKind: 'discord',
      webhookUrl: 'https://discord.com/api/webhooks/1/abc',
    });
    const updated = settings.update({ reminderEnabled: false, webhookKind: null, webhookUrl: null });
    expect(updated.webhookUrl).toBeNull();
  });

  it('persists across service instances', () => {
    settings.update({ sweepTime: '05:15' });
    expect(new SettingsService(ctx.db, ctx.clock).get().sweepTime).toBe('05:15');
  });
});
