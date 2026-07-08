import { z } from 'zod';
import { WAHASelf } from '@waha/apps/app_sdk/waha/WAHASelf';
import { McpController } from '@waha/apps/mcp/decorators/controller';
import { Tool } from '@waha/apps/mcp/decorators/tool';
import { TextMcpResponse } from '@waha/apps/mcp/responses';
import { ScopedKeyInput } from '@waha/apps/mcp/tools/keys.zod';

export class KeysTools extends McpController {
  constructor(api: WAHASelf) {
    super(api);
  }

  @Tool('keys-get-scoped-key', {
    title: 'Get a scoped API key',
    description:
      'Create or get a minimal, scoped API key for a session. ' +
      'Use "media" scope for a download-only key to fetch media files, ' +
      'or "control" scope for a control-only key to open the QR code / screenshot in a browser. ' +
      'The returned key is far weaker than your own key and is safe to hand to the user for that single purpose.',
    inputSchema: ScopedKeyInput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  })
  async getScopedKey({ session, scope }: z.infer<typeof ScopedKeyInput>) {
    let key: string | null = null;
    if (scope === 'media') {
      key = await this.mediaApiKey(session);
    } else {
      key = await this.controlApiKey(session);
    }
    if (!key) {
      return TextMcpResponse(
        JSON.stringify({
          error:
            'Could not mint a scoped API key. Check that the session exists and that your key has access to it.',
        }),
      );
    }
    return TextMcpResponse(JSON.stringify({ scope: scope, key: key }));
  }
}
