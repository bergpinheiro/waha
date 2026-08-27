import { ApiProperty } from '@nestjs/swagger';
import { IsDuration } from '@waha/nestjs/validation/IsDuration';
import { IsOptional, IsString } from 'class-validator';

export class BrazilianPhoneCachePurgeQuery {
  @ApiProperty({
    description:
      'Only purge entries older than this duration (e.g. "7d", "24h"). ' +
      'When omitted, the whole cache is purged.',
    required: false,
    example: '7d',
  })
  @IsOptional()
  @IsString()
  @IsDuration()
  olderThan?: string;
}

export class BrazilianPhoneCachePurgeResponse {
  @ApiProperty({
    description: 'Number of entries removed from the persistent cache',
  })
  deleted: number;
}

export class BrazilianPhoneCacheStatsResponse {
  @ApiProperty({
    description: 'Total number of entries in the persistent cache',
  })
  total: number;

  @ApiProperty({
    description: 'Number of entries verified against WhatsApp',
  })
  verified: number;
}
