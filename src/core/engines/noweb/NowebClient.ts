import type makeWASocket from '@adiwajshing/baileys';
import type { QueryIds } from '@adiwajshing/baileys';
import type { NewsletterMetadata } from '@adiwajshing/baileys/lib/Types';
import { toNewsletterMetadata } from '@waha/core/engines/noweb/noweb.newsletter';
import {
  ChannelPagination,
  ChannelSearchByText,
  ChannelSearchByView,
} from '@waha/structures/channels.dto';

enum NewsletterMexQueryIds {
  NEWSLETTERS_DIRECTORY_LIST = '6190824427689257',
  NEWSLETTERS_DIRECTORY_SEARCH = '6802402206520139',
}

enum NewsletterXWAPaths {
  NEWSLETTERS_DIRECTORY_LIST = 'xwa2_newsletters_directory_list',
  NEWSLETTERS_DIRECTORY_SEARCH = 'xwa2_newsletters_directory_search',
}

/**
 * NowebClient - wrapper around baileys to have more methods
 */

export interface NewsletterSearchResponse {
  page: ChannelPagination;
  newsletters: NewsletterMetadata[];
}

export class NowebClient {
  constructor(private sock: ReturnType<typeof makeWASocket>) {}

  async searchChannelsByView(
    query: ChannelSearchByView,
  ): Promise<NewsletterSearchResponse> {
    const variables = {
      input: {
        view: query.view,
        filters: {
          country_codes: query.countries,
          categories: query.categories,
        },
        limit: query.limit,
        start_cursor: query.startCursor,
      },
    };
    const queryId =
      NewsletterMexQueryIds.NEWSLETTERS_DIRECTORY_LIST as unknown as QueryIds;
    const path = NewsletterXWAPaths.NEWSLETTERS_DIRECTORY_LIST;
    const response = await this.sock.executeWMexQuery(variables, queryId, path);
    return parseNewsletterSearchNode(response);
  }

  async searchChannelsByText(
    query: ChannelSearchByText,
  ): Promise<NewsletterSearchResponse> {
    const variables = {
      input: {
        search_text: query.text,
        categories: query.categories,
        limit: query.limit,
        start_cursor: query.startCursor,
      },
    };
    const queryId =
      NewsletterMexQueryIds.NEWSLETTERS_DIRECTORY_SEARCH as unknown as QueryIds;
    const path = NewsletterXWAPaths.NEWSLETTERS_DIRECTORY_SEARCH;
    const response = await this.sock.executeWMexQuery(variables, queryId, path);
    return parseNewsletterSearchNode(response);
  }
}

function parseNewsletterSearchNode(response: any): NewsletterSearchResponse {
  const pageInfo = response.page_info;
  const page: ChannelPagination = {
    startCursor: pageInfo.startCursor,
    endCursor: pageInfo.endCursor,
    hasNextPage: pageInfo.hasNextPage,
    hasPreviousPage: pageInfo.hasPreviousPage,
  };
  const newsletterResult: any[] = response.result;
  const newsletters = newsletterResult.map(toNewsletterMetadata);

  return {
    page: page,
    newsletters: newsletters as any,
  };
}
