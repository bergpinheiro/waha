import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import {
  BrazilianPhoneCachePurgeQuery,
  BrazilianPhoneCachePurgeResponse,
  BrazilianPhoneCacheStatsResponse,
} from '@waha/apps/brazilian-phone-numbers/dto/cache.dto';
import {
  BrazilianPhoneNumbersAppConfig,
  DEFAULT_PERSISTENT_TTL,
} from '@waha/apps/brazilian-phone-numbers/dto/config.dto';
import { BrazilianPhoneCorePlugin } from '@waha/apps/brazilian-phone-numbers/plugins/BrazilianPhoneCorePlugin';
import { BrazilianPhoneCacheRepository } from '@waha/apps/brazilian-phone-numbers/storage/BrazilianPhoneCacheRepository';
import { AppName } from '@waha/apps/app_sdk/apps/name';
import { AppRepository } from '@waha/apps/app_sdk/storage/AppRepository';
import { AppDB } from '@waha/apps/app_sdk/storage/types';
import { SessionManager } from '@waha/core/abc/manager.abc';
import { Action, session as SessionName } from '@waha/core/auth/casl.types';
import { CanServer } from '@waha/core/auth/policies';
import { CheckPolicies } from '@waha/core/auth/policies.decorator';
import { PoliciesGuard } from '@waha/core/auth/policies.guard';
import { WAHAValidationPipe } from '@waha/nestjs/pipes/WAHAValidationPipe';
import { parseDurationMs } from '@waha/nestjs/validation/IsDuration';
import * as ms from 'ms';

@ApiSecurity('api_key')
@Controller('api/apps/brazilian-phone-numbers')
@ApiTags('🧩 Apps')
@UseGuards(PoliciesGuard)
export class BrazilianPhoneNumbersController {
  constructor(private manager: SessionManager) {}

  @Get(':id/cache')
  @ApiOperation({
    summary: 'Get persistent cache stats for the app',
    description: 'Total and verified entry counts.',
  })
  @CheckPolicies(CanServer(Action.Retrieve))
  @UsePipes(new WAHAValidationPipe())
  async stats(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<BrazilianPhoneCacheStatsResponse> {
    const app = await this.getApp(id, req);
    return await this.repository(app).stats();
  }

  @Delete(':id/cache')
  @ApiOperation({
    summary: 'Purge the resolved-numbers cache for the app',
    description:
      'Removes persistent cache entries (all, or only ones older than "olderThan") ' +
      'and clears the in-memory tier of the running session.',
  })
  @CheckPolicies(CanServer(Action.Retrieve))
  @UsePipes(new WAHAValidationPipe())
  async purge(
    @Param('id') id: string,
    @Query(new WAHAValidationPipe()) query: BrazilianPhoneCachePurgeQuery,
    @Req() req: any,
  ): Promise<BrazilianPhoneCachePurgeResponse> {
    const app = await this.getApp(id, req);
    let olderThan: Date | undefined = undefined;
    const olderThanMs = parseDurationMs(query.olderThan);
    if (olderThanMs !== null) {
      olderThan = new Date(Date.now() - olderThanMs);
    }
    const deleted = await this.repository(app).purge(olderThan);
    this.clearMemoryTier(app);
    return { deleted: deleted };
  }

  private async getApp(id: string, req: any): Promise<AppDB> {
    const knex = this.manager.store.getWAHADatabase();
    const repo = new AppRepository(knex);
    const app = await repo.getById(id);
    if (!app || app.app !== AppName.brazilianPhoneNumbers) {
      throw new NotFoundException(`App '${id}' not found`);
    }
    if (!req.ability?.can(Action.App, new SessionName(app.session))) {
      throw new ForbiddenException();
    }
    return app;
  }

  private repository(app: AppDB): BrazilianPhoneCacheRepository {
    const knex = this.manager.store.getWAHADatabase();
    const config = app.config as BrazilianPhoneNumbersAppConfig;
    const ttlMs =
      parseDurationMs(config?.cache?.persistentTtl) ??
      ms(DEFAULT_PERSISTENT_TTL);
    return new BrazilianPhoneCacheRepository(knex, app.pk, ttlMs);
  }

  private clearMemoryTier(app: AppDB): void {
    if (!this.manager.isRunning(app.session)) {
      return;
    }
    let session;
    try {
      session = this.manager.getSession(app.session);
    } catch {
      return;
    }
    const plugin = session.plugins.get(BrazilianPhoneCorePlugin, app.id);
    plugin?.clearMemoryCache();
  }
}
