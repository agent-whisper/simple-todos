import { z } from 'zod';
import { IsoDateTime } from './primitives.js';

export const WEBHOOK_KINDS = ['discord', 'slack'] as const;
export const WebhookKind = z.enum(WEBHOOK_KINDS);
export type WebhookKindValue = (typeof WEBHOOK_KINDS)[number];

/**
 * 'HH:MM', 24-hour, zero-padded.
 *
 * The scheduler compares these against the current local time with a plain
 * string comparison, which is only chronological because both sides are padded.
 */
export const TimeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM in 24-hour form');

export const Settings = z.object({
  timezone: z.string().min(1),
  sweepTime: TimeOfDay,
  reminderEnabled: z.boolean(),
  reminderTime: TimeOfDay,
  webhookKind: WebhookKind.nullable(),
  webhookUrl: z.string().url().nullable(),
  updatedAt: IsoDateTime,
});
export type SettingsValue = z.infer<typeof Settings>;

export const UpdateSettingsRequest = z
  .object({
    timezone: z.string().min(1),
    sweepTime: TimeOfDay,
    reminderEnabled: z.boolean(),
    reminderTime: TimeOfDay,
    webhookKind: WebhookKind.nullable(),
    webhookUrl: z.string().url().nullable(),
  })
  .partial();
export type UpdateSettingsRequestValue = z.infer<typeof UpdateSettingsRequest>;
