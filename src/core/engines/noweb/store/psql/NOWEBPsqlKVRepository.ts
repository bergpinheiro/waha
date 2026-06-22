import {
  convertProtobufToPlainObject,
  replaceLongsWithNumber,
} from '@waha/core/engines/noweb/utils';
import { PsqlKVRepository } from '@waha/core/storage/psql/PsqlKVRepository';
import esm from '@waha/vendor/esm';

// PostgreSQL TEXT or JSONB columns do not allow null bytes (c-style strings)
// oxlint-disable-next-line no-control-regex
const invalidCharsRegex = /\u0000/g;

export function sanitizeJsonUnicode(str: string): string {
  return str.replace(invalidCharsRegex, '');
}

/**
 * Key value repository with extra metadata
 * Add support for converting protobuf to plain object
 */
export class NOWEBPsqlKVRepository<Entity> extends PsqlKVRepository<Entity> {
  protected stringify(data: any): string {
    let value = JSON.stringify(data, esm.b.BufferJSON.replacer);
    value = sanitizeJsonUnicode(value);
    return value;
  }

  public parse(row: any): any {
    return JSON.parse(row.data, esm.b.BufferJSON.reviver);
  }

  protected dump(entity: Entity) {
    const raw = convertProtobufToPlainObject(entity);
    replaceLongsWithNumber(raw);
    return super.dump(raw);
  }
}
