import { Injectable } from '@nestjs/common';
import { CategoriesByValue } from '@waha/core/services/channels.categories';
import { CountriesByCode } from '@waha/core/services/channels.countries';
import { ViewsByValue } from '@waha/core/services/channels.views';
import {
  ChannelCategory,
  ChannelCountry,
  ChannelView,
} from '@waha/structures/channels.dto';

const COUNTRIES: ChannelCountry[] = Object.entries(CountriesByCode).map(
  ([key, value]) => ({ code: key, name: value }),
);

const CATEGORIES: ChannelCategory[] = Object.entries(CategoriesByValue).map(
  ([key, value]) => ({ value: key, name: value }),
);

const VIEWS: ChannelView[] = Object.entries(ViewsByValue).map(
  ([key, value]) => ({ value: key, name: value }),
);

@Injectable()
export class ChannelsInfoServiceCore {
  async getCountries(): Promise<ChannelCountry[]> {
    return COUNTRIES;
  }

  async getCategories(): Promise<ChannelCategory[]> {
    return CATEGORIES;
  }

  async getViews(): Promise<ChannelView[]> {
    return VIEWS;
  }
}
