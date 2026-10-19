import type { IconName } from './Icon';

export type NodeKind = 'source' | 'transform' | 'join' | 'append' | 'query' | 'sql' | 'table' | 'check' | 'output';

export const NODE_KIND: Record<NodeKind, { icon: IconName; label: string; inputs: number; noOut?: boolean }> = {
  source: { icon: 'source', label: 'Source', inputs: 0 },
  transform: { icon: 'transform', label: 'Transform', inputs: 1 },
  join: { icon: 'join', label: 'Join', inputs: 2 },
  append: { icon: 'append', label: 'Append', inputs: 1 },
  query: { icon: 'query', label: 'Query', inputs: 1 },
  sql: { icon: 'code', label: 'SQL', inputs: 1 },
  table: { icon: 'schema', label: 'Schema table', inputs: 1 },
  check: { icon: 'check', label: 'Check', inputs: 1 },
  output: { icon: 'output', label: 'Output', inputs: 1, noOut: true },
};
