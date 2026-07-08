import { z } from 'zod';

const SessionField = z.string().describe('Session name');

export const ScopedKeyInput = z.object({
  session: SessionField,
  scope: z
    .enum(['media', 'control'])
    .describe(
      'Scope of the key. ' +
        '"media" — download-only key for fetching media files of the session. ' +
        '"control" — control-only key to open QR code / screenshot in a browser.',
    ),
});
