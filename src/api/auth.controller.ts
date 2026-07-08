import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiFileAcceptHeader } from '@waha/nestjs/ApiFileAcceptHeader';
import {
  QRCodeSessionParam,
  SessionApiParam,
  SessionParam,
} from '@waha/nestjs/params/SessionApiParam';

import { SessionManager } from '../core/abc/manager.abc';
import { WhatsappSession } from '../core/abc/session.abc';
import { BufferResponseInterceptor } from '../nestjs/BufferResponseInterceptor';
import {
  PasskeyAssertionRequest,
  QRCodeFormat,
  QRCodeQuery,
  QRCodeValue,
  RequestCodeRequest,
} from '../structures/auth.dto';
import { Base64File } from '../structures/files.dto';
import { PoliciesGuard } from '@waha/core/auth/policies.guard';
import { CheckPolicies } from '@waha/core/auth/policies.decorator';
import { CanSession, FromParam } from '@waha/core/auth/policies';

import { Action } from '@waha/core/auth/casl.types';

@ApiSecurity('api_key')
@Controller('api/:session/auth')
@ApiTags('📱 Pairing')
@UseGuards(PoliciesGuard)
@CheckPolicies(CanSession(Action.Control, FromParam('session')))
class AuthController {
  constructor(private manager: SessionManager) {}

  @Get('qr')
  @ApiOperation({
    summary: 'Get QR code for pairing WhatsApp API.',
  })
  @SessionApiParam
  @ApiFileAcceptHeader('image/png', Base64File, QRCodeValue)
  @UseInterceptors(new BufferResponseInterceptor('image/png'))
  async getQR(
    @QRCodeSessionParam session: WhatsappSession,
    @Query() query: QRCodeQuery,
  ): Promise<Buffer | QRCodeValue> {
    const qr = session.getQR();
    if (query.format == QRCodeFormat.RAW) {
      return { value: qr.raw };
    }
    return qr.get();
  }

  @Post('request-code')
  @SessionApiParam
  @ApiOperation({
    summary: 'Request authentication code.',
  })
  requestCode(
    @SessionParam session: WhatsappSession,
    @Body() request: RequestCodeRequest,
  ) {
    return session.requestCode(request.phoneNumber, request.method, request);
  }

  @Get('passkey')
  @SessionApiParam
  @ApiOperation({
    summary: 'Get the pending passkey (WebAuthn) challenge, if any.',
  })
  getPasskey(@SessionParam session: WhatsappSession) {
    return session.getPasskeyChallenge();
  }

  @Post('passkey')
  @SessionApiParam
  @ApiOperation({
    summary: 'Submit a WebAuthn passkey assertion to finish pairing.',
  })
  submitPasskey(
    @SessionParam session: WhatsappSession,
    @Body() request: PasskeyAssertionRequest,
  ) {
    return session.sendPasskeyResponse(JSON.stringify(request));
  }

  @Get('passkey/confirmation')
  @SessionApiParam
  @ApiOperation({
    summary:
      'Get the pending passkey confirmation code, if any (manual confirmation-code case only).',
  })
  getPasskeyConfirmation(@SessionParam session: WhatsappSession) {
    return session.getPasskeyConfirmation();
  }

  @Post('passkey/confirm')
  @SessionApiParam
  @ApiOperation({
    summary: 'Confirm passkey pairing (only needed for the manual code case).',
  })
  confirmPasskey(@SessionParam session: WhatsappSession) {
    return session.confirmPasskey();
  }
}

export { AuthController };
