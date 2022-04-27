import { BeeDebug } from '@ethersphere/bee-js'

/**
 * Gets postage batch ID from already created batches
 *
 * @param beeDebug BeeDebug instance for interaction
 */
export async function getBatchId(beeDebug: BeeDebug): Promise<string> {
  const batches = await beeDebug.getAllPostageBatch()

  if (batches.length === 0) {
    throw new Error('Postage batch not exists')
  }

  const batchId = batches.pop()?.batchID

  if (!batchId) {
    throw new Error('Incorrect batch id found')
  }

  return batchId
}

/**
 * Checks default postage batch is usable
 *
 * @param beeDebug
 */
export async function isBatchUsable(beeDebug: BeeDebug): Promise<boolean> {
  const batchId = await getBatchId(beeDebug)
  const batch = await beeDebug.getPostageBatch(batchId)

  return batch.usable
}
