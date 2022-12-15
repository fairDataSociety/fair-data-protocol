import { Bee, Data, Reference, RequestOptions, Utils } from '@ethersphere/bee-js'
import { bmtHashString } from '../account/utils'
import { getId } from './handler'
import { lookup } from './lookup/linear'
import { Epoch, HIGHEST_LEVEL } from './lookup/epoch'
import { bytesToHex } from '../utils/hex'
import { getUnixTimestamp } from '../utils/time'
import { LookupAnswer } from './types'
import { Connection } from '../connection/connection'
import { encryptBytes, PodPasswordBytes } from '../utils/encryption'
import { CHUNK_ALREADY_EXISTS_ERROR, errorStartWith, getError } from '../utils/error'
import { getBmtDataAddress } from '../utils/bytes'

/**
 * Finds and downloads the latest feed content
 *
 * @param bee Bee client
 * @param topic topic for calculation swarm chunk
 * @param address Ethereum address for calculation swarm chunk
 * @param options download chunk options
 */
export async function getFeedData(
  bee: Bee,
  topic: string,
  address: Utils.EthAddress | Uint8Array,
  options?: RequestOptions,
): Promise<LookupAnswer> {
  const topicHash = bmtHashString(topic)

  return lookup(0, async (epoch: Epoch, time: number): Promise<Data> => {
    const tempId = getId(topicHash, time, epoch.level)
    const chunkReference = bytesToHex(Utils.keccak256Hash(tempId.buffer, address.buffer))

    return bee.downloadChunk(chunkReference, options)
  })
}

/**
 * Writes data with encryption to feed using `topic` and `epoch` as a key and signed data with `privateKey` as a value
 *
 * @param connection connection information for data uploading
 * @param topic key for data
 * @param data data to upload
 * @param privateKey private key to sign data
 * @param podPassword bytes for data encryption from pod metadata
 * @param epoch feed epoch
 */
export async function writeFeedData(
  connection: Connection,
  topic: string,
  data: Uint8Array,
  privateKey: string | Uint8Array,
  podPassword: PodPasswordBytes,
  epoch?: Epoch,
): Promise<Reference> {
  data = encryptBytes(podPassword, data)

  return writeFeedDataRaw(connection, topic, data, privateKey, epoch)
}

/**
 * Writes data without encryption to feed using `topic` and `epoch` as a key and signed data with `privateKey` as a value
 *
 * @deprecated required for deprecated methods
 *
 * @param connection connection information for data uploading
 * @param topic key for data
 * @param data data to upload
 * @param privateKey private key to sign data
 * @param epoch feed epoch
 */
export async function writeFeedDataRaw(
  connection: Connection,
  topic: string,
  data: Uint8Array,
  privateKey: string | Uint8Array,
  epoch?: Epoch,
): Promise<Reference> {
  if (!epoch) {
    epoch = new Epoch(HIGHEST_LEVEL, getUnixTimestamp())
  }

  const topicHash = bmtHashString(topic)
  const id = getId(topicHash, epoch.time, epoch.level)
  const socWriter = connection.bee.makeSOCWriter(privateKey)
  try {
    return await socWriter.upload(connection.postageBatchId, id, data, {
      pin: true,
    })
  } catch (e) {
    if (errorStartWith(e, CHUNK_ALREADY_EXISTS_ERROR)) {
      return getBmtDataAddress(data)
    } else {
      throw new Error(getError(e)?.message || 'Unknown error')
    }
  }
}
