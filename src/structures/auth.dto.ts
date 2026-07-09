import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';

export enum QRCodeFormat {
  IMAGE = 'image',
  RAW = 'raw',
}

export class QRCodeQuery {
  format: QRCodeFormat = QRCodeFormat.IMAGE;
}

export class QRCodeValue {
  value: string;
}

export class RequestCodeRequest {
  @ApiProperty({
    description: 'Mobile phone number in international format',
    example: '12132132130',
  })
  phoneNumber: string;

  @ApiProperty({
    description:
      'How would you like to receive the one time code for registration? |sms|voice. Leave empty for Web pairing.',
    example: null,
    required: false,
  })
  method: string;

  @ApiHideProperty()
  localeLanguage: string;

  @ApiHideProperty()
  localeCountry: string;
}

export class PairingCodeResponse {
  code: string;
}

export class PasskeyAssertionResponseData {
  @ApiProperty({
    description: 'Base64url-encoded clientDataJSON from the authenticator.',
  })
  clientDataJSON: string;

  @ApiProperty({
    description: 'Base64url-encoded authenticatorData from the authenticator.',
  })
  authenticatorData: string;

  @ApiProperty({
    description: 'Base64url-encoded signature from the authenticator.',
  })
  signature: string;

  @ApiProperty({
    description:
      'Base64url-encoded user handle, if returned by the authenticator.',
    required: false,
  })
  userHandle?: string;
}

export class PasskeyAssertionRequest {
  @ApiProperty({
    description:
      'Credential ID, as returned by navigator.credentials.get().toJSON().',
  })
  id: string;

  @ApiProperty({
    description: 'Base64url-encoded raw credential ID.',
  })
  rawId: string;

  @ApiProperty({
    description: 'Always "public-key".',
    example: 'public-key',
  })
  type: string;

  @ApiProperty({ type: PasskeyAssertionResponseData })
  response: PasskeyAssertionResponseData;
}

export class PasskeyAllowedCredential {
  @ApiProperty({
    description: 'Base64url-encoded credential ID.',
  })
  id: string;

  @ApiProperty({
    description: 'Always "public-key".',
    example: 'public-key',
  })
  type: string;

  @ApiProperty({
    description: 'Authenticator transports the credential supports.',
    example: ['internal', 'hybrid'],
    required: false,
  })
  transports?: string[];
}

/**
 * WebAuthn request options - pass it to navigator.credentials.get({ publicKey })
 * on the https://web.whatsapp.com origin.
 */
export class PasskeyChallenge {
  @ApiProperty({
    description: 'Base64url-encoded challenge to sign.',
  })
  challenge: string;

  @ApiProperty({
    description: 'How long the challenge is valid for, in milliseconds.',
    example: 60000,
  })
  timeout: number;

  @ApiProperty({
    description: 'Relying party ID.',
    example: 'web.whatsapp.com',
  })
  rpId: string;

  @ApiProperty({ type: [PasskeyAllowedCredential] })
  allowCredentials: PasskeyAllowedCredential[];

  @ApiProperty({
    example: 'required',
  })
  userVerification: string;

  @ApiProperty({
    description: 'WebAuthn extensions requested by WhatsApp.',
    required: false,
  })
  extensions?: Record<string, any>;
}

export class PasskeyConfirmationResponse {
  @ApiProperty({
    description:
      'The code the user must verify against the one shown on their phone.',
    example: '1234',
  })
  code: string;
}
