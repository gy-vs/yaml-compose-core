import type { Document, DocValue } from '../../doc/Document.ts'
import { Alias } from '../../nodes/Alias.ts'
import { Scalar } from '../../nodes/Scalar.ts'
import { resolveAlias, type ToJSContext } from '../../nodes/toJS.ts'
import type { Node } from '../../nodes/types.ts'
import { type MapLike, YAMLMap } from '../../nodes/YAMLMap.ts'
import type { ScalarTag } from '../types.ts'

// If the value associated with a merge key is a single mapping node, each of
// its key/value pairs is inserted into the current mapping, unless the key
// already exists in it. If the value associated with the merge key is a
// sequence, then this sequence is expected to contain mapping nodes and each
// of these nodes is merged in turn according to its order in the sequence.
// Keys in mapping nodes earlier in the sequence override keys specified in
// later mapping nodes. -- http://yaml.org/type/merge.html

const MERGE_KEY = '<<'

export const merge: ScalarTag & {
  identify(value: unknown): boolean
  test: (value: string) => boolean
} = {
  identify: value =>
    value === MERGE_KEY ||
    (typeof value === 'symbol' && value.description === MERGE_KEY),
  default: 'key',
  tag: 'tag:yaml.org,2002:merge',
  test: str => str === MERGE_KEY,
  resolve: () =>
    Object.assign(new Scalar(Symbol(MERGE_KEY)), {
      addToJSMap: addMergeToJSMap
    }),
  stringify: () => MERGE_KEY
}

export const isMergeKey = (
  doc: Document<DocValue, boolean>,
  key: unknown
): boolean =>
  (merge.identify(key) ||
    (key instanceof Scalar &&
      (!key.type || key.type === Scalar.PLAIN) &&
      merge.identify(key.value))) &&
  Boolean(doc.schema.tags.some(tag => tag.tag === merge.tag && tag.default))

export function addMergeToJSMap(
  doc: Document<DocValue, boolean>,
  ctx: ToJSContext,
  map: MapLike,
  value: unknown,
  isPlainObject: boolean
): void {
  value = resolveMergeValue(doc, ctx, value)
  if (Array.isArray(value) && !(value instanceof YAMLMap)) {
    for (const it of value) mergeValue(doc, ctx, map, it, isPlainObject)
  } else {
    mergeValue(doc, ctx, map, value, isPlainObject)
  }
}

/**
 * Resolve the alias references in a merge-key value, counting them together
 * with regular alias references against `maxAliasCount`. Non-alias values are
 * returned as-is. An alias may resolve directly to a mapping or to a sequence
 * of mappings and/or aliases.
 */
function resolveMergeValue(
  doc: Document<DocValue, boolean>,
  ctx: ToJSContext,
  value: unknown
): unknown {
  if (value instanceof Alias) {
    const source = resolveAlias(doc, ctx, value)
    if (Array.isArray(source) && !(source instanceof YAMLMap))
      return resolveMergeSeq(doc, ctx, source as Node[])
    // For mappings, the source node itself is merged; for non-map values the
    // source is passed on unchanged so that a "must be maps" error is thrown.
    return source
  }
  if (Array.isArray(value) && !(value instanceof YAMLMap))
    return resolveMergeSeq(doc, ctx, value as Node[])
  return value
}

function resolveMergeSeq(
  doc: Document<DocValue, boolean>,
  ctx: ToJSContext,
  seq: Node[]
): Node[] {
  return seq.map(item =>
    item instanceof Alias ? resolveAlias(doc, ctx, item) : item
  )
}

function mergeValue(
  doc: Document<DocValue, boolean>,
  ctx: ToJSContext,
  map: MapLike,
  value: unknown,
  isPlainObject: boolean
) {
  const source = value
  const srcMap = (source as YAMLMap).toJS(doc, ctx, Map<any, any>)
  if (!(srcMap instanceof Map))
    throw new Error('Merge sources must be maps or map aliases')
  for (const [key, value] of srcMap) {
    if (map instanceof Map) {
      if (!map.has(key)) map.set(key, value)
    } else if (map instanceof Set) {
      map.add(key)
    } else if (!Object.prototype.hasOwnProperty.call(map, key)) {
      if (!isPlainObject || key === '__proto__' || key === 'constructor') {
        Object.defineProperty(map, key, {
          value,
          writable: true,
          enumerable: true,
          configurable: true
        })
      } else {
        map[key] = value
      }
    }
  }
  return map
}
