import fs from 'fs'
import path from 'path'
import BinaryDecoder from '../Util/Binary/Decoder.js'
import BinaryEncoder from '../Util/Binary/Encoder.js'
import { createMutualExclude } from '../Util/mutualExclude.js'
import { encodeUpdate, encodeStructsDS, decodePersisted } from './decodePersisted.js'

function createFilePath (persistence, roomName) {
  // TODO: filename checking!
  return path.join(persistence.dir, roomName)
}

export default class FilePersistence {
  constructor (dir) {
    this.dir = dir
    this._mutex = createMutualExclude()
  }
  setRemoteUpdateCounter (roomName, remoteUpdateCounter) {
    // TODO: implement
    // nop
  }
  saveUpdate (room, y, encodedStructs) {
    return new Promise((resolve, reject) => {
      this._mutex(() => {
        const filePath = createFilePath(this, room)
        const updateMessage = new BinaryEncoder()
        encodeUpdate(y, encodedStructs, updateMessage)
        fs.appendFile(filePath, Buffer.from(updateMessage.createBuffer()), (err) => {
          if (err !== null) {
            reject(err)
          } else {
            resolve()
          }
        })
      }, resolve)
    })
  }
  saveState (roomName, y) {
    return new Promise((resolve, reject) => {
      const encoder = new BinaryEncoder()
      encodeStructsDS(y, encoder)
      const filePath = createFilePath(this, roomName)
      fs.writeFile(filePath, Buffer.from(encoder.createBuffer()), (err) => {
        if (err !== null) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }
  readState (roomName, y) {
    // Check if the file exists in the current directory.
    return new Promise((resolve, reject) => {
      const filePath = path.join(this.dir, roomName)
      fs.readFile(filePath, (err, data) => {
        if (err !== null) {
          resolve()
          // reject(err)
        } else {
          this._mutex(() => {
            console.info(`unpacking data (${data.length})`)
            console.time('unpacking')
            decodePersisted(y, new BinaryDecoder(data))
            console.timeEnd('unpacking')
          })
          resolve()
        }
      })
    })
  }
}