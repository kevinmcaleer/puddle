// What a connection source asks its driver to read, built the same way in the browser and on the runner.
import type { ConnectionSource } from '../model';
import type { ReadRequest } from './types';

/** The table or query, the row limit and, where the driver takes them, the filter and the shape. */
export const readRequestOf = (c: ConnectionSource): ReadRequest => ({
  table: c.table,
  query: c.query,
  limit: c.limit,
  ...(c.filter?.trim() ? { filter: c.filter.trim() } : {}),
  ...(c.allowFiltering ? { allowFiltering: true } : {}),
  ...(c.shape && (c.shape.depth !== undefined || c.shape.arrays !== undefined) ? { shape: c.shape } : {}),
});
