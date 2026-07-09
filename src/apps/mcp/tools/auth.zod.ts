import { z } from 'zod';
import { DtoToZod } from '@waha/apps/mcp/schemas/DtoToZod';
import {
  PasskeyAssertionRequest,
  RequestCodeRequest,
} from '@waha/structures/auth.dto';

export const AuthQRInput = z.object({
  session: z.string(),
});

export const ScreenshotInput = z.object({
  session: z.string(),
});

export const AuthRequestCodeInput = DtoToZod(RequestCodeRequest).extend({
  session: z.string(),
});

export const AuthPasskeyChallengeInput = z.object({
  session: z.string(),
});

export const AuthPasskeyConfirmationInput = z.object({
  session: z.string(),
});

export const AuthPasskeySubmitInput = DtoToZod(PasskeyAssertionRequest).extend({
  session: z.string(),
});

export const AuthPasskeyConfirmInput = z.object({
  session: z.string(),
});
