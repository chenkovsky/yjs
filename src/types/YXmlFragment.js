/**
 * @module YXml
 */

import {
  YXmlEvent,
  YXmlElement,
  AbstractType,
  typeListMap,
  typeListForEach,
  typeListInsertGenerics,
  typeListDelete,
  typeListToArray,
  YXmlFragmentRefID,
  callTypeObservers,
  transact,
  Transaction, ItemType, YXmlText, YXmlHook, Snapshot // eslint-disable-line
} from '../internals.js'

import * as encoding from 'lib0/encoding.js'
import * as decoding from 'lib0/decoding.js' // eslint-disable-line

/**
 * Define the elements to which a set of CSS queries apply.
 * {@link https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors|CSS_Selectors}
 *
 * @example
 *   query = '.classSelector'
 *   query = 'nodeSelector'
 *   query = '#idSelector'
 *
 * @typedef {string} CSS_Selector
 */

/**
 * Dom filter function.
 *
 * @callback domFilter
 * @param {string} nodeName The nodeName of the element
 * @param {Map} attributes The map of attributes.
 * @return {boolean} Whether to include the Dom node in the YXmlElement.
 */

/**
 * Represents a subset of the nodes of a YXmlElement / YXmlFragment and a
 * position within them.
 *
 * Can be created with {@link YXmlFragment#createTreeWalker}
 *
 * @public
 * @implements {IterableIterator}
 */
export class YXmlTreeWalker {
  /**
   * @param {YXmlFragment | YXmlElement} root
   * @param {function(AbstractType<any>):boolean} [f]
   */
  constructor (root, f = () => true) {
    this._filter = f
    this._root = root
    /**
     * @type {ItemType | null}
     */
    // @ts-ignore
    this._currentNode = root._start
    this._firstCall = true
  }

  [Symbol.iterator] () {
    return this
  }
  /**
   * Get the next node.
   *
   * @return {IteratorResult<YXmlElement|YXmlText|YXmlHook>} The next node.
   *
   * @public
   */
  next () {
    let n = this._currentNode
    if (n !== null && (!this._firstCall || n.deleted || !this._filter(n.type))) { // if first call, we check if we can use the first item
      do {
        if (!n.deleted && (n.type.constructor === YXmlElement || n.type.constructor === YXmlFragment) && n.type._start !== null) {
          // walk down in the tree
          // @ts-ignore
          n = n.type._start
        } else {
          // walk right or up in the tree
          while (n !== null) {
            if (n.right !== null) {
              // @ts-ignore
              n = n.right
              break
            } else if (n.parent === this._root) {
              n = null
            } else {
              n = n.parent._item
            }
          }
        }
      } while (n !== null && (n.deleted || !this._filter(n.type)))
    }
    this._firstCall = false
    this._currentNode = n
    if (n === null) {
      // @ts-ignore return undefined if done=true (the expected result)
      return { value: undefined, done: true }
    }
    // @ts-ignore
    return { value: n.type, done: false }
  }
}

/**
 * Represents a list of {@link YXmlElement}.and {@link YXmlText} types.
 * A YxmlFragment is similar to a {@link YXmlElement}, but it does not have a
 * nodeName and it does not have attributes. Though it can be bound to a DOM
 * element - in this case the attributes and the nodeName are not shared.
 *
 * @public
 * @extends AbstractType<YXmlEvent>
 */
export class YXmlFragment extends AbstractType {
  constructor () {
    super()
    /**
     * @type {Array<any>|null}
     * @private
     */
    this._prelimContent = []
  }
  /**
   * Create a subtree of childNodes.
   *
   * @example
   * const walker = elem.createTreeWalker(dom => dom.nodeName === 'div')
   * for (let node in walker) {
   *   // `node` is a div node
   *   nop(node)
   * }
   *
   * @param {function(AbstractType<any>):boolean} filter Function that is called on each child element and
   *                          returns a Boolean indicating whether the child
   *                          is to be included in the subtree.
   * @return {YXmlTreeWalker} A subtree and a position within it.
   *
   * @public
   */
  createTreeWalker (filter) {
    return new YXmlTreeWalker(this, filter)
  }

  /**
   * Returns the first YXmlElement that matches the query.
   * Similar to DOM's {@link querySelector}.
   *
   * Query support:
   *   - tagname
   * TODO:
   *   - id
   *   - attribute
   *
   * @param {CSS_Selector} query The query on the children.
   * @return {YXmlElement|YXmlText|YXmlHook|null} The first element that matches the query or null.
   *
   * @public
   */
  querySelector (query) {
    query = query.toUpperCase()
    // @ts-ignore
    const iterator = new YXmlTreeWalker(this, element => element.nodeName === query)
    const next = iterator.next()
    if (next.done) {
      return null
    } else {
      return next.value
    }
  }

  /**
   * Returns all YXmlElements that match the query.
   * Similar to Dom's {@link querySelectorAll}.
   *
   * @todo Does not yet support all queries. Currently only query by tagName.
   *
   * @param {CSS_Selector} query The query on the children
   * @return {Array<YXmlElement|YXmlText|YXmlHook|null>} The elements that match this query.
   *
   * @public
   */
  querySelectorAll (query) {
    query = query.toUpperCase()
    // @ts-ignore
    return Array.from(new YXmlTreeWalker(this, element => element.nodeName === query))
  }

  /**
   * Creates YXmlEvent and calls observers.
   * @private
   *
   * @param {Transaction} transaction
   * @param {Set<null|string>} parentSubs Keys changed on this type. `null` if list was modified.
   */
  _callObserver (transaction, parentSubs) {
    callTypeObservers(this, transaction, new YXmlEvent(this, parentSubs, transaction))
  }

  /**
   * Get the string representation of all the children of this YXmlFragment.
   *
   * @return {string} The string representation of all children.
   */
  toString () {
    return typeListMap(this, xml => xml.toString()).join('')
  }

  toJSON () {
    return this.toString()
  }

  /**
   * Creates a Dom Element that mirrors this YXmlElement.
   *
   * @param {Document} [_document=document] The document object (you must define
   *                                        this when calling this method in
   *                                        nodejs)
   * @param {Object<string, any>} [hooks={}] Optional property to customize how hooks
   *                                             are presented in the DOM
   * @param {any} [binding] You should not set this property. This is
   *                               used if DomBinding wants to create a
   *                               association to the created DOM type.
   * @return {Node} The {@link https://developer.mozilla.org/en-US/docs/Web/API/Element|Dom Element}
   *
   * @public
   */
  toDOM (_document = document, hooks = {}, binding) {
    const fragment = _document.createDocumentFragment()
    if (binding !== undefined) {
      binding._createAssociation(fragment, this)
    }
    typeListForEach(this, xmlType => {
      fragment.insertBefore(xmlType.toDOM(_document, hooks, binding), null)
    })
    return fragment
  }

  /**
   * Inserts new content at an index.
   *
   * @example
   *  // Insert character 'a' at position 0
   *  xml.insert(0, [new Y.XmlText('text')])
   *
   * @param {number} index The index to insert content at
   * @param {Array<YXmlElement|YXmlText>} content The array of content
   */
  insert (index, content) {
    if (this.doc !== null) {
      transact(this.doc, transaction => {
        typeListInsertGenerics(transaction, this, index, content)
      })
    } else {
      // @ts-ignore _prelimContent is defined because this is not yet integrated
      this._prelimContent.splice(index, 0, ...content)
    }
  }

  /**
   * Deletes elements starting from an index.
   *
   * @param {number} index Index at which to start deleting elements
   * @param {number} [length=1] The number of elements to remove. Defaults to 1.
   */
  delete (index, length = 1) {
    if (this.doc !== null) {
      transact(this.doc, transaction => {
        typeListDelete(transaction, this, index, length)
      })
    } else {
      // @ts-ignore _prelimContent is defined because this is not yet integrated
      this._prelimContent.splice(index, length)
    }
  }
  /**
   * Transforms this YArray to a JavaScript Array.
   *
   * @return {Array<YXmlElement|YXmlText|YXmlHook>}
   */
  toArray () {
    return typeListToArray(this)
  }
  /**
   * Transform the properties of this type to binary and write it to an
   * BinaryEncoder.
   *
   * This is called when this Item is sent to a remote peer.
   *
   * @private
   * @param {encoding.Encoder} encoder The encoder to write data to.
   */
  _write (encoder) {
    encoding.writeVarUint(encoder, YXmlFragmentRefID)
  }
}

/**
 * @param {decoding.Decoder} decoder
 * @return {YXmlFragment}
 *
 * @private
 * @function
 */
export const readYXmlFragment = decoder => new YXmlFragment()
