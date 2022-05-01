import { RawDirectoryMetadata } from '../pod/types'
import { stringToBytes } from '../utils/bytes'

/**
 * Converts FairOS raw directory metadata to bytes representation
 */
export function getRawDirectoryMetadataBytes(data: RawDirectoryMetadata): Uint8Array {
  return stringToBytes(JSON.stringify(data))
}
