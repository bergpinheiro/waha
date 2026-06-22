import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { MediaS3StorageConfig } from '@waha/core/media/s3/MediaS3StorageConfig';
import { Readable } from 'stream';

@ApiSecurity('api_key')
@Controller('api/s3')
@ApiTags('🗄️ Storage')
export class S3ProxyController {
  private readonly enabled: boolean;

  constructor(
    private s3client: S3Client,
    s3config: MediaS3StorageConfig,
  ) {
    this.enabled = s3config.s3ProxyFiles;
  }

  @Get(':bucket/*parts')
  @ApiOperation({
    summary: 'Get files from S3',
  })
  async get(
    @Param('bucket') bucket: string,
    @Param('parts') parts: string[],
  ): Promise<StreamableFile> {
    if (!this.enabled) {
      throw new NotFoundException('S3 proxy is disabled');
    }

    const key = parts.join('/');
    const filename = this.getS3Filename(key);
    let stream: Readable;
    try {
      stream = await this.getS3Stream(bucket, key);
    } catch (error) {
      if (error.name === 'NoSuchKey') {
        throw new NotFoundException(`File not found: ${key}`);
      }
      throw error;
    }

    return new StreamableFile(stream, {
      disposition: `attachment; filename="${filename}"`,
    });
  }

  private async getS3Stream(bucket: string, key: string): Promise<Readable> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    const response = await this.s3client.send(command);
    return response.Body as Readable;
  }

  private getS3Filename(key: string) {
    return key.split('/').pop();
  }
}
