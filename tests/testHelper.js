import * as Y from '../src/index.js'

import {
  createDeleteSetFromStructStore,
  getStateVector,
  AbstractItem,
  DeleteSet, StructStore, Doc // eslint-disable-line
} from '../src/internals.js'

import * as t from 'lib0/testing.js'
import * as prng from 'lib0/prng.js'
import * as encoding from 'lib0/encoding.js'
import * as decoding from 'lib0/decoding.js'
import * as syncProtocol from 'y-protocols/sync.js'

/**
 * @param {TestYInstance} y // publish message created by `y` to all other online clients
 * @param {Uint8Array} m
 */
const broadcastMessage = (y, m) => {
  if (y.tc.onlineConns.has(y)) {
    y.tc.onlineConns.forEach(remoteYInstance => {
      if (remoteYInstance !== y) {
        remoteYInstance._receive(m, y)
      }
    })
  }
}

export class TestYInstance extends Doc {
  /**
   * @param {TestConnector} testConnector
   * @param {number} clientID
   */
  constructor (testConnector, clientID) {
    super()
    this.userID = clientID // overwriting clientID
    /**
     * @type {TestConnector}
     */
    this.tc = testConnector
    /**
     * @type {Map<TestYInstance, Array<Uint8Array>>}
     */
    this.receiving = new Map()
    testConnector.allConns.add(this)
    // set up observe on local model
    this.on('update', /** @param {Uint8Array} update @param {any} origin */ (update, origin) => {
      if (origin !== testConnector) {
        const encoder = encoding.createEncoder()
        syncProtocol.writeUpdate(encoder, update)
        broadcastMessage(this, encoding.toUint8Array(encoder))
      }
    })
    this.connect()
  }
  /**
   * Disconnect from TestConnector.
   */
  disconnect () {
    this.receiving = new Map()
    this.tc.onlineConns.delete(this)
  }
  /**
   * Append yourself to the list of known Y instances in testconnector.
   * Also initiate sync with all clients.
   */
  connect () {
    if (!this.tc.onlineConns.has(this)) {
      this.tc.onlineConns.add(this)
      const encoder = encoding.createEncoder()
      syncProtocol.writeSyncStep1(encoder, this)
      // publish SyncStep1
      broadcastMessage(this, encoding.toUint8Array(encoder))
      this.tc.onlineConns.forEach(remoteYInstance => {
        if (remoteYInstance !== this) {
          // remote instance sends instance to this instance
          const encoder = encoding.createEncoder()
          syncProtocol.writeSyncStep1(encoder, remoteYInstance)
          this._receive(encoding.toUint8Array(encoder), remoteYInstance)
        }
      })
    }
  }
  /**
   * Receive a message from another client. This message is only appended to the list of receiving messages.
   * TestConnector decides when this client actually reads this message.
   *
   * @param {Uint8Array} message
   * @param {TestYInstance} remoteClient
   */
  _receive (message, remoteClient) {
    let messages = this.receiving.get(remoteClient)
    if (messages === undefined) {
      messages = []
      this.receiving.set(remoteClient, messages)
    }
    messages.push(message)
  }
}

/**
 * Keeps track of TestYInstances.
 *
 * The TestYInstances add/remove themselves from the list of connections maiained in this object.
 * I think it makes sense. Deal with it.
 */
export class TestConnector {
  /**
   * @param {prng.PRNG} gen
   */
  constructor (gen) {
    /**
     * @type {Set<TestYInstance>}
     */
    this.allConns = new Set()
    /**
     * @type {Set<TestYInstance>}
     */
    this.onlineConns = new Set()
    /**
     * @type {prng.PRNG}
     */
    this.prng = gen
  }
  /**
   * Create a new Y instance and add it to the list of connections
   * @param {number} clientID
   */
  createY (clientID) {
    return new TestYInstance(this, clientID)
  }
  /**
   * Choose random connection and flush a random message from a random sender.
   *
   * If this function was unable to flush a message, because there are no more messages to flush, it returns false. true otherwise.
   * @return {boolean}
   */
  flushRandomMessage () {
    const gen = this.prng
    const conns = Array.from(this.onlineConns).filter(conn => conn.receiving.size > 0)
    if (conns.length > 0) {
      const receiver = prng.oneOf(gen, conns)
      const [sender, messages] = prng.oneOf(gen, Array.from(receiver.receiving))
      const m = messages.shift()
      if (messages.length === 0) {
        receiver.receiving.delete(sender)
      }
      if (m === undefined) {
        return this.flushRandomMessage()
      }
      const encoder = encoding.createEncoder()
      // console.log('receive (' + sender.userID + '->' + receiver.userID + '):\n', syncProtocol.stringifySyncMessage(decoding.createDecoder(m), receiver))
      // do not publish data created when this function is executed (could be ss2 or update message)
      syncProtocol.readSyncMessage(decoding.createDecoder(m), encoder, receiver, receiver.tc)
      if (encoding.length(encoder) > 0) {
        // send reply message
        sender._receive(encoding.toUint8Array(encoder), receiver)
      }
      return true
    }
    return false
  }
  /**
   * @return {boolean} True iff this function actually flushed something
   */
  flushAllMessages () {
    let didSomething = false
    while (this.flushRandomMessage()) {
      didSomething = true
    }
    return didSomething
  }
  reconnectAll () {
    this.allConns.forEach(conn => conn.connect())
  }
  disconnectAll () {
    this.allConns.forEach(conn => conn.disconnect())
  }
  syncAll () {
    this.reconnectAll()
    this.flushAllMessages()
  }
  /**
   * @return {boolean} Whether it was possible to disconnect a randon connection.
   */
  disconnectRandom () {
    if (this.onlineConns.size === 0) {
      return false
    }
    prng.oneOf(this.prng, Array.from(this.onlineConns)).disconnect()
    return true
  }
  /**
   * @return {boolean} Whether it was possible to reconnect a random connection.
   */
  reconnectRandom () {
    /**
     * @type {Array<TestYInstance>}
     */
    const reconnectable = []
    this.allConns.forEach(conn => {
      if (!this.onlineConns.has(conn)) {
        reconnectable.push(conn)
      }
    })
    if (reconnectable.length === 0) {
      return false
    }
    prng.oneOf(this.prng, reconnectable).connect()
    return true
  }
}

/**
 * @template T
 * @param {t.TestCase} tc
 * @param {{users?:number}} conf
 * @param {InitTestObjectCallback<T>} [initTestObject]
 * @return {{testObjects:Array<any>,testConnector:TestConnector,users:Array<TestYInstance>,array0:Y.Array<any>,array1:Y.Array<any>,array2:Y.Array<any>,map0:Y.Map<any>,map1:Y.Map<any>,map2:Y.Map<any>,map3:Y.Map<any>,text0:Y.Text,text1:Y.Text,text2:Y.Text,xml0:Y.XmlElement,xml1:Y.XmlElement,xml2:Y.XmlElement}}
 */
export const init = (tc, { users = 5 } = {}, initTestObject) => {
  /**
   * @type {Object<string,any>}
   */
  const result = {
    users: []
  }
  const gen = tc.prng
  const testConnector = new TestConnector(gen)
  result.testConnector = testConnector
  for (let i = 0; i < users; i++) {
    const y = testConnector.createY(i)
    y.clientID = i
    result.users.push(y)
    result['array' + i] = y.get('array', Y.Array)
    result['map' + i] = y.get('map', Y.Map)
    result['xml' + i] = y.get('xml', Y.XmlElement)
    result['text' + i] = y.get('text', Y.Text)
  }
  testConnector.syncAll()
  result.testObjects = result.users.map(initTestObject || (() => null))
  // @ts-ignore
  return result
}

/**
 * 1. reconnect and flush all
 * 2. user 0 gc
 * 3. get type content
 * 4. disconnect & reconnect all (so gc is propagated)
 * 5. compare os, ds, ss
 *
 * @param {Array<TestYInstance>} users
 */
export const compare = users => {
  users.forEach(u => u.connect())
  while (users[0].tc.flushAllMessages()) {}
  const userArrayValues = users.map(u => u.getArray('array').toJSON().map(val => JSON.stringify(val)))
  const userMapValues = users.map(u => u.getMap('map').toJSON())
  const userXmlValues = users.map(u => u.get('xml', Y.XmlElement).toString())
  const userTextValues = users.map(u => u.getText('text').toDelta())
  for (const u of users) {
    t.assert(u.store.pendingDeleteReaders.length === 0)
    t.assert(u.store.pendingStack.length === 0)
    t.assert(u.store.pendingClientsStructRefs.size === 0)
  }
  for (let i = 0; i < users.length - 1; i++) {
    t.compare(userArrayValues[i].length, users[i].getArray('array').length)
    t.compare(userArrayValues[i], userArrayValues[i + 1])
    t.compare(userMapValues[i], userMapValues[i + 1])
    t.compare(userXmlValues[i], userXmlValues[i + 1])
    // @ts-ignore
    t.compare(userTextValues[i].map(a => a.insert).join('').length, users[i].getText('text').length)
    t.compare(userTextValues[i], userTextValues[i + 1])
    t.compare(getStateVector(users[i].store), getStateVector(users[i + 1].store))
    compareDS(createDeleteSetFromStructStore(users[i].store), createDeleteSetFromStructStore(users[i + 1].store))
    compareStructStores(users[i].store, users[i + 1].store)
  }
  users.map(u => u.destroy())
}

/**
 * @param {AbstractItem?} a
 * @param {AbstractItem?} b
 * @return {boolean}
 */
export const compareItemIDs = (a, b) => a === b || (a !== null && b != null && Y.compareIDs(a.id, b.id))

/**
 * @param {StructStore} ss1
 * @param {StructStore} ss2
 */
export const compareStructStores = (ss1, ss2) => {
  t.assert(ss1.clients.size === ss2.clients.size)
  for (const [client, structs1] of ss1.clients) {
    const structs2 = ss2.clients.get(client)
    t.assert(structs2 !== undefined && structs1.length === structs2.length)
    for (let i = 0; i < structs1.length; i++) {
      const s1 = structs1[i]
      // @ts-ignore
      const s2 = structs2[i]
      // checks for abstract struct
      if (
        s1.constructor !== s2.constructor ||
        !Y.compareIDs(s1.id, s2.id) ||
        s1.deleted !== s2.deleted ||
        s1.length !== s2.length
      ) {
        t.fail('Structs dont match')
      }
      if (s1 instanceof AbstractItem) {
        if (
          !(s2 instanceof AbstractItem) ||
          !((s1.left === null && s2.left === null) || (s1.left !== null && s2.left !== null && Y.compareIDs(s1.left.lastId, s2.left.lastId))) ||
          !compareItemIDs(s1.right, s2.right) ||
          !Y.compareIDs(s1.origin, s2.origin) ||
          !Y.compareIDs(s1.rightOrigin, s2.rightOrigin) ||
          s1.parentSub !== s2.parentSub
        ) {
          return t.fail('Items dont match')
        }
        // make sure that items are connected correctly
        t.assert(s1.left === null || s1.left.right === s1)
        t.assert(s1.right === null || s1.right.left === s1)
        t.assert(s2.left === null || s2.left.right === s2)
        t.assert(s2.right === null || s2.right.left === s2)
      }
    }
  }
}

/**
 * @param {DeleteSet} ds1
 * @param {DeleteSet} ds2
 */
export const compareDS = (ds1, ds2) => {
  t.assert(ds1.clients.size === ds2.clients.size)
  for (const [client, deleteItems1] of ds1.clients) {
    const deleteItems2 = ds2.clients.get(client)
    t.assert(deleteItems2 !== undefined && deleteItems1.length === deleteItems2.length)
    for (let i = 0; i < deleteItems1.length; i++) {
      const di1 = deleteItems1[i]
      // @ts-ignore
      const di2 = deleteItems2[i]
      if (di1.clock !== di2.clock || di1.len !== di2.len) {
        t.fail('DeleteSets dont match')
      }
    }
  }
}

/**
 * @template T
 * @callback InitTestObjectCallback
 * @param {TestYInstance} y
 * @return {T}
 */

/**
 * @template T
 * @param {t.TestCase} tc
 * @param {Array<function(Y.Doc,prng.PRNG,T):void>} mods
 * @param {number} iterations
 * @param {InitTestObjectCallback<T>} [initTestObject]
 */
export const applyRandomTests = (tc, mods, iterations, initTestObject) => {
  const gen = tc.prng
  const result = init(tc, { users: 5 }, initTestObject || (() => null))
  const { testConnector, users } = result
  for (let i = 0; i < iterations; i++) {
    if (prng.int31(gen, 0, 100) <= 2) {
      // 2% chance to disconnect/reconnect a random user
      if (prng.bool(gen)) {
        testConnector.disconnectRandom()
      } else {
        testConnector.reconnectRandom()
      }
    } else if (prng.int31(gen, 0, 100) <= 1) {
      // 1% chance to flush all
      testConnector.flushAllMessages()
    } else if (prng.int31(gen, 0, 100) <= 50) {
      // 50% chance to flush a random message
      testConnector.flushRandomMessage()
    }
    const user = prng.int31(gen, 0, users.length - 1)
    const test = prng.oneOf(gen, mods)
    test(users[user], gen, result.testObjects[user])
  }
  compare(users)
  return result
}
