import { WAHASelf } from '@waha/apps/app_sdk/waha/WAHASelf';
import { AxiosRequestConfig } from 'axios';
import { ImageMcpResponse, TextMcpResponse } from '@waha/apps/mcp/responses';

export class McpController {
  constructor(protected readonly api: WAHASelf) {}

  protected async request(config: AxiosRequestConfig<any>) {
    const requestConfig = { ...config };
    requestConfig.validateStatus = () => true;
    const response = await this.api.request(requestConfig);
    return response;
  }

  protected async textRequest(config: AxiosRequestConfig) {
    const response = await this.request(config);
    const responseText =
      typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data);
    return TextMcpResponse(
      JSON.stringify({ status: response.status, response: responseText }),
    );
  }

  protected async imageRequest(url: string) {
    const response = await this.api.request({
      method: 'GET',
      url: url,
      responseType: 'arraybuffer',
    });
    return ImageMcpResponse(Buffer.from(response.data));
  }

  protected async scopedApiKey(
    url: string,
    session: string,
  ): Promise<string | null> {
    const response = await this.request({
      method: 'POST',
      url: url,
      data: { session: session },
    });
    if (response.status >= 200 && response.status < 300) {
      return response.data?.key ?? null;
    }
    // e.g. 403 (caller lacks the scope) or 422 (session missing) → fall back
    return null;
  }

  protected async mediaApiKey(session: string): Promise<string | null> {
    return this.scopedApiKey('/api/keys/media', session);
  }

  protected async controlApiKey(session: string): Promise<string | null> {
    return this.scopedApiKey('/api/keys/control', session);
  }
}
