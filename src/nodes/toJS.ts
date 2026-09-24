import type { Document } from '../doc/Document.ts'
import type { ToJSOptions } from '../options.ts'
import { getAliasCount } from './Alias.ts'
import type { Alias } from './Alias.ts'
import type { Node } from './types.ts'

/** A context used in `node.toJS()` implementations */
export class ToJSContext {
  anchors: Map<Node, { aliasCount: number; count: number; res: unknown }> =
    new Map()
  /** Cached anchor and alias nodes in the order they occur in the document */
  aliasResolveCache?: Node[]
  mapAsMap: boolean
  mapKeyWarned = false
  maxAliasCount: number

  constructor(opt?: ToJSOptions) {
    this.mapAsMap = opt?.mapAsMap === true
    this.maxAliasCount = opt?.maxAliasCount ?? 100
  }

  setAnchor(node: Node, res: unknown): void {
    // Keep the first registration, including for anchors whose value is still
    // being resolved (circular references and merge keys). Re-registering the
    // same node, e.g. when a merge source is converted to JS again, must not
    // reset its accumulated alias count.
    if (this.anchors.has(node)) return
    this.anchors.set(node, { aliasCount: 0, count: 1, res })
  }
}

/**
 * Resolve an alias to its source node, applying the same reference and
 * alias-expansion count limits as a regular alias reference. Used by both
 * `Alias#toJS()` and merge-key (`<<`) value resolution, so that alias
 * references in merge values are counted together with regular aliases.
 */
export function resolveAlias(
  doc: Document,
  ctx: ToJSContext,
  alias: Alias
): Node {
  const { anchors, maxAliasCount } = ctx

  const source = alias.resolve(doc, ctx)
  if (!source) {
    const msg = `Unresolved alias (the anchor must be set before the alias): ${alias.source}`
    throw new ReferenceError(msg)
  }

  let data = anchors.get(source)
  if (!data) {
    // Resolve anchors for Node.prototype.toJS()
    source.toJS(doc, ctx)
    data = anchors.get(source)
  }
  /* istanbul ignore if */
  if (data?.res === undefined) {
    const msg = 'This should not happen: Alias anchor was not resolved?'
    throw new ReferenceError(msg)
  }
  if (maxAliasCount >= 0) {
    data.count += 1
    data.aliasCount ||= getAliasCount(doc, ctx, source, anchors)
    if (data.count * data.aliasCount > maxAliasCount) {
      const msg = 'Excessive alias count indicates a resource exhaustion attack'
      throw new ReferenceError(msg)
    }
  }

  return source
}

/** A general-purpose JSON reviver function */
export function toJSON(key: unknown, value: any): any {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  if (typeof value?.toJSON === 'function') value = value.toJSON(key)
  else if (typeof value === 'bigint') value = Number(value)
  return value
}
