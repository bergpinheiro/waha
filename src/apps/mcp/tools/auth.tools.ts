import { z } from 'zod';
import { WAHASelf } from '@waha/apps/app_sdk/waha/WAHASelf';
import { McpController } from '@waha/apps/mcp/decorators/controller';
import { Tool } from '@waha/apps/mcp/decorators/tool';
import {
  AuthPasskeyChallengeInput,
  AuthPasskeyConfirmationInput,
  AuthPasskeyConfirmInput,
  AuthPasskeySubmitInput,
  AuthQRInput,
  AuthRequestCodeInput,
  ScreenshotInput,
} from '@waha/apps/mcp/tools/auth.zod';

function AuthContent(key: string | null): any {
  const open = key
    ? `add "?x-api-key=${key}" to the query params (this is a control-only key scoped to this session)`
    : `append "?x-api-key=YOUR_API_KEY" to the query params, using the key you already have`;
  return {
    type: 'text' as const,
    text: `
You can either ask the user to scan a QR code or provide a phone number and call auth-request-code. auth-request-code is preferable, so ask for the phone number and pass it in international format without +.
If the user wants to open the QR code or screenshot in a browser, ${open}.
`,
  };
}

export class AuthTools extends McpController {
  constructor(api: WAHASelf) {
    super(api);
  }

  @Tool('auth-qr', {
    title: 'Get QR code',
    description:
      'Get QR code to pair WhatsApp Session. ' +
      'The first QR code is valid for 60 seconds; each subsequent code is valid for 20 seconds. ' +
      'If the code expires before scanning, call this tool again to get a fresh one. ' +
      'If you run out of codes the server closes the connection — reconnect and start over.',
    inputSchema: AuthQRInput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
    },
  })
  async authQR({ session }: z.infer<typeof AuthQRInput>) {
    const result = await this.imageRequest(`/api/${session}/auth/qr`);
    const key = await this.controlApiKey(session);
    result.content.push(AuthContent(key));
    return result;
  }

  @Tool('screenshot', {
    title: 'Get screenshot',
    description:
      'Get a screenshot of the current WhatsApp Web page (WEBJS/WPP only)',
    inputSchema: ScreenshotInput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
    },
  })
  async screenshot({ session }: z.infer<typeof ScreenshotInput>) {
    const result = await this.imageRequest(
      `/api/screenshot?session=${session}`,
    );
    const key = await this.controlApiKey(session);
    result.content.push(AuthContent(key));
    return result;
  }

  @Tool('auth-request-code', {
    title: 'Request pairing code',
    description:
      'Request a one-time pairing code for phone-number-based authentication (alternative to QR). ' +
      'Leave method empty for Web pairing.',
    inputSchema: AuthRequestCodeInput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  })
  async requestCode({
    session,
    ...body
  }: z.infer<typeof AuthRequestCodeInput>) {
    const result = await this.textRequest({
      method: 'POST',
      url: `/api/${session}/auth/request-code`,
      data: body,
    });
    result.content.push({
      type: 'text',
      text:
        'Share the pairing code with the user and ask them to complete linking:\n' +
        '1. Open WhatsApp on your phone\n' +
        '2. Tap More Options ⋮ or Settings\n' +
        '3. Tap Linked Devices → Link a device\n' +
        '4. Tap "Link with phone number instead" and enter the code',
    });
    return result;
  }

  @Tool('auth-passkey-challenge', {
    title: 'Get passkey challenge',
    description:
      'Get the pending passkey (WebAuthn) challenge for a session in PASSKEY_REQUIRED status. ' +
      'Fails with 422 when nothing is pending. ' +
      'You cannot sign the challenge yourself - the assertion has to be produced by an authenticator ' +
      'on the https://web.whatsapp.com origin (the WAHA browser extension, or the DevTools fallback). ' +
      'Hand the challenge to the user, then submit the result with auth-passkey-submit.',
    inputSchema: AuthPasskeyChallengeInput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  })
  async passkeyChallenge({
    session,
  }: z.infer<typeof AuthPasskeyChallengeInput>) {
    return this.textRequest({
      method: 'GET',
      url: `/api/${session}/auth/passkey/challenge`,
    });
  }

  @Tool('auth-passkey-submit', {
    title: 'Submit passkey assertion',
    description:
      'Submit the WebAuthn assertion produced by navigator.credentials.get() to finish passkey pairing. ' +
      'Get the challenge from auth-passkey-challenge first. ' +
      'After this the session usually goes straight to WORKING; ' +
      'if it goes to PASSKEY_CONFIRMATION_REQUIRED instead, follow up with auth-passkey-confirmation.',
    inputSchema: AuthPasskeySubmitInput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  })
  async passkeySubmit({
    session,
    ...body
  }: z.infer<typeof AuthPasskeySubmitInput>) {
    return this.textRequest({
      method: 'POST',
      url: `/api/${session}/auth/passkey`,
      data: body,
    });
  }

  @Tool('auth-passkey-confirmation', {
    title: 'Get passkey confirmation code',
    description:
      'Get the pending passkey confirmation code for a session in PASSKEY_CONFIRMATION_REQUIRED status. ' +
      'Fails with 422 when nothing is pending. ' +
      'Show the code to the user, ask them to check it matches the one on their phone, ' +
      'then call auth-passkey-confirm.',
    inputSchema: AuthPasskeyConfirmationInput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  })
  async passkeyConfirmation({
    session,
  }: z.infer<typeof AuthPasskeyConfirmationInput>) {
    return this.textRequest({
      method: 'GET',
      url: `/api/${session}/auth/passkey/confirmation`,
    });
  }

  @Tool('auth-passkey-confirm', {
    title: 'Confirm passkey pairing',
    description:
      'Finish passkey pairing after the user confirmed the code matches the one shown on their phone. ' +
      'Only call it once the user has verified the code from auth-passkey-confirmation.',
    inputSchema: AuthPasskeyConfirmInput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  })
  async passkeyConfirm({ session }: z.infer<typeof AuthPasskeyConfirmInput>) {
    return this.textRequest({
      method: 'POST',
      url: `/api/${session}/auth/passkey/confirm`,
    });
  }
}
