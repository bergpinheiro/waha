import { AppModule } from '@waha/apps/app_sdk/apps/definition';
import { AppName } from '@waha/apps/app_sdk/apps/name';
import { BrazilianPhoneNumbersController } from '@waha/apps/brazilian-phone-numbers/api/brazilian-phone-numbers.controller';
import { BrazilianPhoneNumbersAppConfig } from '@waha/apps/brazilian-phone-numbers/dto/config.dto';
import { BrazilianPhoneNumbersAppService } from '@waha/apps/brazilian-phone-numbers/services/BrazilianPhoneNumbersAppService';

const BrazilianPhoneNumbersAppModule: AppModule = {
  name: AppName.brazilianPhoneNumbers,
  definition: {
    plainkey: false,
    queue: false,
    migrations: true,
    restartOnChange: true,
    unique: true,
  },
  nestjs: {
    imports: [],
    controllers: [BrazilianPhoneNumbersController],
    providers: [BrazilianPhoneNumbersAppService],
  },
  Service: BrazilianPhoneNumbersAppService,
  ConfigClass: BrazilianPhoneNumbersAppConfig,
};

export default BrazilianPhoneNumbersAppModule;
