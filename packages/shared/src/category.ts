import { z } from 'zod';
import { IsoDateTime, Uuid } from './primitives.js';

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected a hex colour like #4488ff');

export const Category = z.object({
  id: Uuid,
  name: z.string().min(1).max(60),
  color: HexColor,
  position: z.number().int(),
  createdAt: IsoDateTime,
});
export type CategoryValue = z.infer<typeof Category>;

export const CreateCategoryRequest = z.object({
  name: z.string().min(1).max(60),
  color: HexColor,
});
export type CreateCategoryRequestValue = z.infer<typeof CreateCategoryRequest>;

export const UpdateCategoryRequest = z
  .object({
    name: z.string().min(1).max(60),
    color: HexColor,
    position: z.number().int().min(0),
  })
  .partial();
export type UpdateCategoryRequestValue = z.infer<typeof UpdateCategoryRequest>;
