import { stringToBytes, wrapBytesWithHelpers } from '../utils/bytes'
import { Bee, Data, BeeRequestOptions } from '@ethersphere/bee-js'
import { EthAddress } from '@ethersphere/bee-js/dist/types/utils/eth'
import {
  assertFullPathWithName,
  calcUploadBlockPercentage,
  DEFAULT_FILE_PERMISSIONS,
  downloadBlocksManifest,
  extractPathInfo,
  getFileMode,
  updateUploadProgress,
  uploadBytes,
} from './utils'
import { FileMetadata } from '../pod/types'
import { blocksToManifest, getFileMetadataRawBytes, rawFileMetadataToFileMetadata } from './adapter'
import { assertRawFileMetadata } from '../directory/utils'
import { getCreationPathInfo, getRawMetadata } from '../content-items/utils'
import { PodPasswordBytes } from '../utils/encryption'
import { Blocks, DataUploadOptions, UploadProgressType } from './types'
import { assertPodName, getExtendedPodsListByAccountData, META_VERSION } from '../pod/utils'
import { getUnixTimestamp } from '../utils/time'
import { addEntryToDirectory, DEFAULT_UPLOAD_OPTIONS } from '../content-items/handler'
import { writeFeedData } from '../feed/api'
import { AccountData } from '../account/account-data'
import { prepareEthAddress } from '../utils/wallet'
import { assertWallet } from '../utils/type'
import { getNextEpoch } from '../feed/lookup/utils'

/**
 * File prefix
 */
export const FILE_TOKEN = '_F_'
/**
 * Directory prefix
 */
export const DIRECTORY_TOKEN = '_D_'

/**
 * Get converted metadata by path
 *
 * @param bee Bee client
 * @param path path with information
 * @param address Ethereum address of the pod which contains the path
 * @param podPassword bytes for data encryption from pod metadata
 * @param downloadOptions options for downloading
 */
export async function getFileMetadata(
  bee: Bee,
  path: string,
  address: EthAddress,
  podPassword: PodPasswordBytes,
  downloadOptions?: BeeRequestOptions,
): Promise<FileMetadata> {
  const data = (await getRawMetadata(bee, path, address, podPassword, downloadOptions)).metadata
  assertRawFileMetadata(data)

  return rawFileMetadataToFileMetadata(data)
}

/**
 * Downloads file parts and compile them into Data
 *
 * @param bee Bee client
 * @param fullPath full path to the file
 * @param address address of the pod
 * @param podPassword bytes for data encryption from pod metadata
 * @param downloadOptions download options
 */
export async function downloadData(
  bee: Bee,
  fullPath: string,
  address: EthAddress,
  podPassword: PodPasswordBytes,
  downloadOptions?: BeeRequestOptions,
): Promise<Data> {
  const fileMetadata = await getFileMetadata(bee, fullPath, address, podPassword, downloadOptions)

  if (fileMetadata.compression) {
    // TODO: implement compression support
    throw new Error('Compressed data is not supported yet')
  }

  const blocks = await downloadBlocksManifest(bee, fileMetadata.blocksReference, downloadOptions)

  let totalLength = 0
  for (const block of blocks.blocks) {
    totalLength += block.size
  }

  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const block of blocks.blocks) {
    const data = await bee.downloadData(block.reference, downloadOptions)
    result.set(data, offset)
    offset += data.length
  }

  return wrapBytesWithHelpers(result)
}

/**
 * Generate block name by block number
 */
export function generateBlockName(blockNumber: number): string {
  return 'block-' + blockNumber.toString().padStart(5, '0')
}

/**
 * Uploads file content
 *
 * @param podName pod where file is stored
 * @param fullPath full path of the file
 * @param data file content
 * @param accountData account data
 * @param options upload options
 */
export async function uploadData(
  podName: string,
  fullPath: string,
  data: Uint8Array | string,
  accountData: AccountData,
  options: DataUploadOptions,
): Promise<FileMetadata> {
  assertPodName(podName)
  assertFullPathWithName(fullPath)
  assertPodName(podName)
  assertWallet(accountData.wallet)

  const blockSize = options.blockSize ?? Number(DEFAULT_UPLOAD_OPTIONS!.blockSize)
  const contentType = options.contentType ?? String(DEFAULT_UPLOAD_OPTIONS!.contentType)

  data = typeof data === 'string' ? stringToBytes(data) : data
  const connection = accountData.connection
  updateUploadProgress(options, UploadProgressType.GetPodInfo)
  const { podWallet, pod } = await getExtendedPodsListByAccountData(accountData, podName)

  updateUploadProgress(options, UploadProgressType.GetPathInfo)
  const fullPathInfo = await getCreationPathInfo(
    connection.bee,
    fullPath,
    prepareEthAddress(podWallet.address),
    connection.options?.requestOptions,
  )
  const pathInfo = extractPathInfo(fullPath)
  const now = getUnixTimestamp()
  const totalBlocks = Math.ceil(data.length / blockSize)
  const blocks: Blocks = { blocks: [] }
  for (let i = 0; i < totalBlocks; i++) {
    updateUploadProgress(options, UploadProgressType.UploadBlockStart, {
      totalBlocks,
      currentBlockId: i,
      uploadPercentage: calcUploadBlockPercentage(i, totalBlocks),
    })
    const currentBlock = data.slice(i * blockSize, (i + 1) * blockSize)
    const result = await uploadBytes(connection, currentBlock)
    blocks.blocks.push({
      size: currentBlock.length,
      compressedSize: currentBlock.length,
      reference: result.reference,
    })
    updateUploadProgress(options, UploadProgressType.UploadBlockEnd, {
      totalBlocks,
      currentBlockId: i,
      uploadPercentage: calcUploadBlockPercentage(i, totalBlocks),
    })
  }

  updateUploadProgress(options, UploadProgressType.UploadBlocksMeta)
  const manifestBytes = stringToBytes(blocksToManifest(blocks))
  const blocksReference = (await uploadBytes(connection, manifestBytes)).reference
  const meta: FileMetadata = {
    version: META_VERSION,
    filePath: pathInfo.path,
    fileName: pathInfo.filename,
    fileSize: data.length,
    blockSize,
    contentType,
    compression: '',
    creationTime: now,
    accessTime: now,
    modificationTime: now,
    blocksReference,
    mode: getFileMode(DEFAULT_FILE_PERMISSIONS),
  }

  updateUploadProgress(options, UploadProgressType.WriteDirectoryInfo)
  await addEntryToDirectory(connection, podWallet, pod.password, pathInfo.path, pathInfo.filename, true)
  updateUploadProgress(options, UploadProgressType.WriteFileInfo)
  await writeFeedData(
    connection,
    fullPath,
    getFileMetadataRawBytes(meta),
    podWallet,
    pod.password,
    getNextEpoch(fullPathInfo?.lookupAnswer.epoch),
  )

  updateUploadProgress(options, UploadProgressType.Done)

  return meta
}
