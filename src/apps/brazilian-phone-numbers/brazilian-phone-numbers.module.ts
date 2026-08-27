import { BrazilianPhoneNumbersController } from '@waha/apps/brazilian-phone-numbers/api/brazilian-phone-numbers.controller';
import { BrazilianPhoneNumbersAppService } from '@waha/apps/brazilian-phone-numbers/services/BrazilianPhoneNumbersAppService';

export const BrazilianPhoneNumbersAppExports = {
  providers: [BrazilianPhoneNumbersAppService],
  imports: [],
  controllers: [BrazilianPhoneNumbersController],
};
