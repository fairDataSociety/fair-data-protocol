import { FdpContracts, FdpStorage } from '../../src'
import {
  createFdp,
  createUsableBatch,
  generateRandomHexString,
  generateUser,
  GET_FEED_DATA_TIMEOUT,
  getBee,
  getCachedBatchId,
  isUsableBatchExists,
  setCachedBatchId,
} from '../utils'
import { MAX_POD_NAME_LENGTH } from '../../src/pod/utils'
import { createUserV1 } from '../../src/account/account'
import { PodShareInfo, RawFileMetadata } from '../../src/pod/types'
import { FileShareInfo } from '../../src/file/types'
import { getFeedData } from '../../src/feed/api'
import { POD_TOPIC } from '../../src/pod/personal-storage'
import { decryptBytes } from '../../src/utils/encryption'
import { Wallet } from 'ethers'
import { removeZeroFromHex } from '../../src/account/utils'
import { bytesToString } from '../../src/utils/bytes'
import { getWalletByIndex, mnemonicToSeed, prepareEthAddress } from '../../src/utils/wallet'
import { assertEncryptedReference, bytesToHex } from '../../src/utils/hex'
import { base64toReference } from '../../src/file/utils'

async function topUpAddress(fdp: FdpStorage) {
  if (!fdp.account.wallet?.address) {
    throw new Error('Address is not defined')
  }

  const account = (await fdp.ens.provider.listAccounts())[0]
  const txHash = await fdp.ens.provider.send('eth_sendTransaction', [
    {
      from: account,
      to: fdp.account.wallet!.address,
      value: '0x2386f26fc10000', // 0.01 ETH
    },
  ])

  await fdp.ens.provider.waitForTransaction(txHash)
}

jest.setTimeout(200000)
describe('Fair Data Protocol class', () => {
  beforeAll(async () => {
    const batchId = await createUsableBatch()
    setCachedBatchId(batchId)
  })

  it('should strip trailing slash', () => {
    const fdp = new FdpStorage('http://localhost:1633/', getCachedBatchId(), {
      downloadOptions: {
        timeout: GET_FEED_DATA_TIMEOUT,
      },
    })
    expect(fdp.connection.bee.url).toEqual('http://localhost:1633')
  })

  it('check default batch usability', async () => {
    expect(await isUsableBatchExists()).toBe(true)
  })

  it('fdp-contracts is not empty', async () => {
    expect(FdpContracts).toBeDefined()
    expect(FdpContracts.ENS).toBeDefined()
  })

  describe('Registration', () => {
    it('should create account wallet', async () => {
      const fdp = createFdp()

      const wallet = fdp.account.createWallet()
      expect(wallet.mnemonic.phrase).toBeDefined()
      expect(wallet.address).toBeDefined()
      expect(wallet.privateKey).toBeDefined()

      await expect(async () => fdp.account.createWallet()).rejects.toThrow('Wallet already created')
    })

    it('should fail on zero balance', async () => {
      const fdp = createFdp()
      const user = generateUser(fdp)

      await expect(fdp.account.register(user.username, user.password)).rejects.toThrow('Not enough funds')
    })

    it('should register users', async () => {
      const fdp = createFdp()

      await expect(fdp.account.register('user', 'password')).rejects.toThrow('Account wallet not found')

      for (let i = 0; i < 2; i++) {
        const fdp = createFdp()

        const user = generateUser(fdp)
        await topUpAddress(fdp)
        const reference = await fdp.account.register(user.username, user.password)
        expect(reference).toBeDefined()
      }
    })

    it('should throw when registering already registered user', async () => {
      const fdp = createFdp()
      const user = generateUser(fdp)
      await topUpAddress(fdp)

      await fdp.account.register(user.username, user.password)
      await expect(fdp.account.register(user.username, user.password)).rejects.toThrow(
        `ENS: Username ${user.username} is not available`,
      )
    })

    it('should migrate v1 user to v2', async () => {
      const fdp = createFdp()
      const fdp2 = createFdp()

      const user = generateUser(fdp)
      generateUser(fdp2)
      await topUpAddress(fdp)
      await topUpAddress(fdp2)
      await createUserV1(fdp.connection, user.username, user.password, user.mnemonic)
      await fdp.account.migrate(user.username, user.password, {
        mnemonic: user.mnemonic,
      })
      const loggedWallet = await fdp.account.login(user.username, user.password)
      expect(loggedWallet.address).toEqual(user.address)

      await expect(fdp2.account.register(user.username, user.password)).rejects.toThrow(
        `ENS: Username ${user.username} is not available`,
      )
    })
  })

  describe('Login', () => {
    it('should login with existing user', async () => {
      const fdp = createFdp()
      const fdp1 = createFdp()
      const user = generateUser(fdp)
      await topUpAddress(fdp)

      const data = await fdp.account.register(user.username, user.password)
      expect(data).toBeDefined()

      const wallet1 = await fdp1.account.login(user.username, user.password)
      expect(wallet1.address).toEqual(user.address)
    })

    it('should throw when username is not registered', async () => {
      const fdp = createFdp()

      const fakeUser = generateUser(fdp)
      await expect(fdp.account.login(fakeUser.username, fakeUser.password)).rejects.toThrow(
        `Username "${fakeUser.username}" does not exists`,
      )
    })

    it('should throw when password is not correct', async () => {
      const fdp = createFdp()
      const user = generateUser(fdp)
      await topUpAddress(fdp)

      await fdp.account.register(user.username, user.password)
      await expect(fdp.account.login(user.username, generateUser().password)).rejects.toThrow('Incorrect password')
      await expect(fdp.account.login(user.username, '')).rejects.toThrow('Incorrect password')
    })

    it('should re-upload an account', async () => {
      const fdp = createFdp()
      const fdp1 = createFdp()
      const user = generateUser(fdp)
      const userFake = generateUser()
      await topUpAddress(fdp)

      const data = await fdp.account.register(user.username, user.password)
      expect(data).toBeDefined()

      fdp1.account.setAccountFromMnemonic(userFake.mnemonic)
      const result1 = await fdp1.account.isPublicKeyEqual(user.username)
      expect(result1).toEqual(false)
      await expect(fdp1.account.reuploadPortableAccount(user.username, user.password)).rejects.toThrow(
        'Public key from the account is not equal to the key from ENS',
      )

      fdp1.account.setAccountFromMnemonic(user.mnemonic)
      const result2 = await fdp1.account.isPublicKeyEqual(user.username)
      expect(result2).toEqual(true)
      await fdp1.account.reuploadPortableAccount(user.username, user.password)
    })
  })

  describe('Pods', () => {
    it('should get empty pods list', async () => {
      const fdp = createFdp()
      generateUser(fdp)

      const pods = (await fdp.personalStorage.list()).getPods()
      expect(pods).toHaveLength(0)
    })

    it('should create pods', async () => {
      const fdp = createFdp()
      generateUser(fdp)

      let list = (await fdp.personalStorage.list()).getPods()
      expect(list).toHaveLength(0)

      const longPodName = generateRandomHexString(MAX_POD_NAME_LENGTH + 1)
      const commaPodName = generateRandomHexString() + ', ' + generateRandomHexString()
      await expect(fdp.personalStorage.create(longPodName)).rejects.toThrow('Pod name is too long')
      await expect(fdp.personalStorage.create(commaPodName)).rejects.toThrow('Pod name cannot contain commas')
      await expect(fdp.personalStorage.create('')).rejects.toThrow('Pod name is too short')

      const examples = [
        { name: generateRandomHexString(), index: 1 },
        { name: generateRandomHexString(), index: 2 },
        { name: generateRandomHexString(), index: 3 },
        { name: generateRandomHexString(), index: 4 },
        { name: generateRandomHexString(), index: 5 },
      ]

      for (let i = 0; examples.length > i; i++) {
        const example = examples[i]
        const result = await fdp.personalStorage.create(example.name)
        expect(result.name).toEqual(example.name)
        expect(result.index).toEqual(example.index)
        expect(result.password).toBeDefined()

        list = (await fdp.personalStorage.list()).getPods()
        expect(list).toHaveLength(i + 1)
        expect(list[i].name).toEqual(example.name)
        expect(list[i].index).toEqual(example.index)
      }

      const failPod = examples[0]
      await expect(fdp.personalStorage.create(failPod.name)).rejects.toThrow(
        `Pod with name "${failPod.name}" already exists`,
      )
    })

    it('should delete pods', async () => {
      const fdp = createFdp()
      generateUser(fdp)

      const podName = generateRandomHexString()
      const podName1 = generateRandomHexString()
      await fdp.personalStorage.create(podName)
      await fdp.personalStorage.create(podName1)
      let list = (await fdp.personalStorage.list()).getPods()
      expect(list).toHaveLength(2)

      const notExistsPod = generateRandomHexString()
      await expect(fdp.personalStorage.delete(notExistsPod)).rejects.toThrow(`Pod "${notExistsPod}" does not exist`)

      await fdp.personalStorage.delete(podName)
      list = (await fdp.personalStorage.list()).getPods()
      expect(list).toHaveLength(1)

      await fdp.personalStorage.delete(podName1)
      list = (await fdp.personalStorage.list()).getPods()
      expect(list).toHaveLength(0)
    })

    it('should share a pod', async () => {
      const fdp = createFdp()
      const user = generateUser(fdp)

      const podName = generateRandomHexString()
      await fdp.personalStorage.create(podName)
      const sharedReference = await fdp.personalStorage.share(podName)
      expect(sharedReference).toHaveLength(128)
      const sharedData = (await fdp.connection.bee.downloadData(sharedReference)).json() as unknown as PodShareInfo
      expect(sharedData.podName).toEqual(podName)
      expect(sharedData.podAddress).toHaveLength(40)
      expect(sharedData.userAddress).toEqual(user.address.toLowerCase().replace('0x', ''))
    })

    it('should receive shared pod info', async () => {
      const fdp = createFdp()
      const user = generateUser(fdp)

      const podName = generateRandomHexString()
      await fdp.personalStorage.create(podName)
      const sharedReference = await fdp.personalStorage.share(podName)
      const sharedData = await fdp.personalStorage.getSharedInfo(sharedReference)

      expect(sharedData.podName).toEqual(podName)
      expect(sharedData.podAddress).toHaveLength(40)
      expect(sharedData.userAddress).toEqual(user.address.toLowerCase().replace('0x', ''))
    })

    it('should save shared pod', async () => {
      const fdp = createFdp()
      const fdp1 = createFdp()
      generateUser(fdp)
      generateUser(fdp1)

      const podName = generateRandomHexString()
      await fdp.personalStorage.create(podName)
      const sharedReference = await fdp.personalStorage.share(podName)

      const list0 = await fdp1.personalStorage.list()
      expect(list0.getPods()).toHaveLength(0)
      expect(list0.getSharedPods()).toHaveLength(0)
      const pod = await fdp1.personalStorage.saveShared(sharedReference)

      expect(pod.name).toEqual(podName)
      expect(pod.address).toHaveLength(20)

      const list = await fdp1.personalStorage.list()
      expect(list.getPods()).toHaveLength(0)
      expect(list.getSharedPods()).toHaveLength(1)
      const savedPod = list.getSharedPods()[0]
      expect(savedPod.name).toEqual(podName)
      expect(savedPod.address).toHaveLength(20)
      expect(savedPod.address).toStrictEqual(pod.address)

      await expect(fdp1.personalStorage.saveShared(sharedReference)).rejects.toThrow(
        `Shared pod with name "${podName}" already exists`,
      )

      const newPodName = generateRandomHexString()
      const pod1 = await fdp1.personalStorage.saveShared(sharedReference, {
        name: newPodName,
      })

      expect(pod1.name).toEqual(newPodName)
      expect(pod1.address).toHaveLength(20)
      expect(pod1.address).toStrictEqual(pod.address)
      const list1 = await fdp1.personalStorage.list()
      expect(list1.getPods()).toHaveLength(0)
      expect(list1.getSharedPods()).toHaveLength(2)
      const savedPod1 = list1.getSharedPods()[1]
      expect(savedPod1.name).toEqual(newPodName)
      expect(savedPod1.address).toHaveLength(20)
      expect(savedPod1.address).toStrictEqual(pod.address)
    })
  })

  describe('Directory', () => {
    it('should create new directory', async () => {
      const fdp = createFdp()
      generateUser(fdp)
      const pod = generateRandomHexString()
      const directoryName = generateRandomHexString()
      const directoryFull = '/' + directoryName
      const directoryName1 = generateRandomHexString()
      const directoryFull1 = '/' + directoryName + '/' + directoryName1

      await fdp.personalStorage.create(pod)
      await expect(fdp.directory.create(pod, directoryFull1)).rejects.toThrow('Parent directory does not exist')
      await fdp.directory.create(pod, directoryFull)
      await expect(fdp.directory.create(pod, directoryFull)).rejects.toThrow(
        `Directory "${directoryFull}" already uploaded to the network`,
      )
      await fdp.directory.create(pod, directoryFull1)
      await expect(fdp.directory.create(pod, directoryFull)).rejects.toThrow(
        `Directory "${directoryFull}" already uploaded to the network`,
      )
      const list = await fdp.directory.read(pod, '/', true)
      expect(list.content).toHaveLength(1)
      expect(list.getDirectories()[0].content).toHaveLength(1)
      const directoryInfo = list.content[0]
      const directoryInfo1 = list.getDirectories()[0].getDirectories()[0]
      expect(directoryInfo.name).toEqual(directoryName)
      expect(directoryInfo1.name).toEqual(directoryName1)
    })

    it('should delete a directory', async () => {
      const fdp = createFdp()
      generateUser(fdp)
      const pod = generateRandomHexString()
      const directoryName = generateRandomHexString()
      const directoryFull = '/' + directoryName

      await fdp.personalStorage.create(pod)
      await fdp.directory.create(pod, directoryFull)
      const list = await fdp.directory.read(pod, '/', true)
      expect(list.content).toHaveLength(1)

      await fdp.directory.delete(pod, directoryFull)
      const listAfter = await fdp.directory.read(pod, '/', true)
      expect(listAfter.content).toHaveLength(0)
    })
  })

  describe('File', () => {
    it('should upload small text data as a file', async () => {
      const fdp = createFdp()
      generateUser(fdp)
      const pod = generateRandomHexString()
      const fileSizeSmall = 100
      const contentSmall = generateRandomHexString(fileSizeSmall)
      const filenameSmall = generateRandomHexString() + '.txt'
      const fullFilenameSmallPath = '/' + filenameSmall

      await fdp.personalStorage.create(pod)
      await fdp.file.uploadData(pod, fullFilenameSmallPath, contentSmall)
      await expect(fdp.file.uploadData(pod, fullFilenameSmallPath, contentSmall)).rejects.toThrow(
        `File "${fullFilenameSmallPath}" already uploaded to the network`,
      )
      const dataSmall = await fdp.file.downloadData(pod, fullFilenameSmallPath)
      expect(dataSmall.text()).toEqual(contentSmall)
      const fdpList = await fdp.directory.read(pod, '/', true)
      expect(fdpList.getFiles().length).toEqual(1)
      const fileInfoSmall = fdpList.getFiles()[0]
      expect(fileInfoSmall.name).toEqual(filenameSmall)
      expect(fileInfoSmall.size).toEqual(fileSizeSmall)
    })

    it('should upload big text data as a file', async () => {
      const fdp = createFdp()
      generateUser(fdp)
      const pod = generateRandomHexString()
      const incorrectPod = generateRandomHexString()
      const fileSizeBig = 5000005
      const contentBig = generateRandomHexString(fileSizeBig)
      const filenameBig = generateRandomHexString() + '.txt'
      const fullFilenameBigPath = '/' + filenameBig
      const incorrectFullPath = fullFilenameBigPath + generateRandomHexString()

      await fdp.personalStorage.create(pod)
      await expect(fdp.file.uploadData(incorrectPod, fullFilenameBigPath, contentBig)).rejects.toThrow(
        `Pod "${incorrectPod}" does not exist`,
      )
      await fdp.file.uploadData(pod, fullFilenameBigPath, contentBig)
      await expect(fdp.file.downloadData(pod, incorrectFullPath)).rejects.toThrow('Data not found')
      const dataBig = (await fdp.file.downloadData(pod, fullFilenameBigPath)).text()
      expect(dataBig).toEqual(contentBig)
      const fdpList = await fdp.directory.read(pod, '/', true)
      expect(fdpList.getFiles().length).toEqual(1)
      const fileInfoBig = fdpList.getFiles()[0]
      expect(fileInfoBig.name).toEqual(filenameBig)
      expect(fileInfoBig.size).toEqual(fileSizeBig)
    })

    it('should delete a file', async () => {
      const fdp = createFdp()
      generateUser(fdp)
      const pod = generateRandomHexString()
      const fileSizeSmall = 100
      const contentSmall = generateRandomHexString(fileSizeSmall)
      const filenameSmall = generateRandomHexString() + '.txt'
      const fullFilenameSmallPath = '/' + filenameSmall

      await fdp.personalStorage.create(pod)
      await fdp.file.uploadData(pod, fullFilenameSmallPath, contentSmall)

      const fdpList = await fdp.directory.read(pod, '/', true)
      expect(fdpList.getFiles().length).toEqual(1)

      await fdp.file.delete(pod, fullFilenameSmallPath)
      const fdpList1 = await fdp.directory.read(pod, '/', true)
      expect(fdpList1.getFiles().length).toEqual(0)
    })

    it('should share a file', async () => {
      const fdp = createFdp()
      generateUser(fdp)
      const pod = generateRandomHexString()
      const fileSizeSmall = 100
      const contentSmall = generateRandomHexString(fileSizeSmall)
      const filenameSmall = generateRandomHexString() + '.txt'
      const fullFilenameSmallPath = '/' + filenameSmall

      await fdp.personalStorage.create(pod)
      await fdp.file.uploadData(pod, fullFilenameSmallPath, contentSmall)

      const sharedReference = await fdp.file.share(pod, fullFilenameSmallPath)
      expect(sharedReference).toHaveLength(128)
      const sharedData = (await fdp.connection.bee.downloadData(sharedReference)).json() as unknown as FileShareInfo
      expect(sharedData.meta).toBeDefined()
    })

    it('should receive information about shared file', async () => {
      const fdp = createFdp()
      generateUser(fdp)
      const pod = generateRandomHexString()
      const fileSizeSmall = 100
      const contentSmall = generateRandomHexString(fileSizeSmall)
      const filenameSmall = generateRandomHexString() + '.txt'
      const fullFilenameSmallPath = '/' + filenameSmall

      await fdp.personalStorage.create(pod)
      await fdp.file.uploadData(pod, fullFilenameSmallPath, contentSmall)

      const sharedReference = await fdp.file.share(pod, fullFilenameSmallPath)
      const sharedData = await fdp.file.getSharedInfo(sharedReference)

      expect(sharedData.meta).toBeDefined()
      expect(sharedData.meta.filePath).toEqual('/')
      expect(sharedData.meta.fileName).toEqual(filenameSmall)
      expect(sharedData.meta.fileSize).toEqual(fileSizeSmall)
    })

    it('should save shared file to a pod', async () => {
      const fdp = createFdp()
      const fdp1 = createFdp()
      generateUser(fdp)
      generateUser(fdp1)
      const pod = generateRandomHexString()
      const pod1 = generateRandomHexString()
      const fileSizeSmall = 100
      const contentSmall = generateRandomHexString(fileSizeSmall)
      const filenameSmall = generateRandomHexString() + '.txt'
      const fullFilenameSmallPath = '/' + filenameSmall

      await fdp.personalStorage.create(pod)
      await fdp1.personalStorage.create(pod1)
      await fdp.file.uploadData(pod, fullFilenameSmallPath, contentSmall)
      const sharedReference = await fdp.file.share(pod, fullFilenameSmallPath)
      const newFilePath = '/'
      const sharedData = await fdp1.file.saveShared(pod1, newFilePath, sharedReference)

      expect(sharedData.filePath).toEqual(newFilePath)
      expect(sharedData.fileName).toEqual(filenameSmall)
      expect(sharedData.fileSize).toEqual(fileSizeSmall)

      const list = await fdp1.directory.read(pod1, '/')
      const files = list.getFiles()
      expect(files).toHaveLength(1)
      const fileInfo = files[0]
      expect(fileInfo.name).toEqual(filenameSmall)
      expect(fileInfo.size).toEqual(fileSizeSmall)
      const meta = fileInfo.raw as RawFileMetadata
      expect(meta.fileName).toEqual(filenameSmall)
      expect(meta.fileSize).toEqual(fileSizeSmall)

      const data = await fdp1.file.downloadData(pod1, fullFilenameSmallPath)
      expect(data.text()).toEqual(contentSmall)

      // checking saving with custom name
      const customName = 'NewCustomName.txt'
      const sharedData1 = await fdp1.file.saveShared(pod1, newFilePath, sharedReference, { name: customName })
      expect(sharedData1.filePath).toEqual(newFilePath)
      expect(sharedData1.fileName).toEqual(customName)
      expect(sharedData1.fileSize).toEqual(fileSizeSmall)

      const data1 = await fdp1.file.downloadData(pod1, '/' + customName)
      expect(data1.text()).toEqual(contentSmall)

      const list1 = await fdp1.directory.read(pod1, '/')
      const files1 = list1.getFiles()
      expect(files1).toHaveLength(2)
    })
  })

  describe('Encryption', () => {
    it('should be encrypted metadata and file data', async () => {
      const bee = getBee()
      const fdp = createFdp()
      const user = generateUser(fdp)
      const pod = generateRandomHexString()
      const directoryName = generateRandomHexString()
      const fullDirectory = '/' + directoryName
      const fileSizeSmall = 100
      const contentSmall = generateRandomHexString(fileSizeSmall)
      const filenameSmall = generateRandomHexString() + '.txt'
      const fullFilenameSmallPath = '/' + filenameSmall

      const privateKey = removeZeroFromHex(Wallet.fromMnemonic(user.mnemonic).privateKey)
      const seed = mnemonicToSeed(user.mnemonic)

      // check pod metadata
      const pod1 = await fdp.personalStorage.create(pod)
      const podData = await getFeedData(bee, POD_TOPIC, prepareEthAddress(user.address))
      const encryptedText1 = podData.data.chunkContent().text()
      const encryptedBytes1 = podData.data.chunkContent()
      // data decrypts with wallet for the pod. Data inside the pod will be encrypted with a password stored in the pod
      const decryptedText1 = bytesToString(decryptBytes(privateKey, encryptedBytes1))
      expect(encryptedText1).not.toContain(pod)
      expect(decryptedText1).toContain(pod)
      // HDNode with index 1 is for first pod
      const node1 = getWalletByIndex(seed, 1)
      const rootDirectoryData = await getFeedData(bee, '/', prepareEthAddress(node1.address))
      const encryptedText2 = rootDirectoryData.data.chunkContent().text()
      const encryptedBytes2 = rootDirectoryData.data.chunkContent()
      // data decrypts with password stored in the pod
      const decryptedText2 = bytesToString(decryptBytes(bytesToHex(pod1.password), encryptedBytes2))
      // check some keywords from root directory of the pod metadata
      const metaWords1 = ['meta', 'version', 'creationTime', 'fileOrDirNames']
      for (const metaWord of metaWords1) {
        expect(encryptedText2).not.toContain(metaWord)
        expect(decryptedText2).toContain(metaWord)
      }

      // check directory metadata
      await fdp.directory.create(pod, fullDirectory)
      const fullDirectoryData = await getFeedData(bee, fullDirectory, prepareEthAddress(node1.address))
      const encryptedText3 = fullDirectoryData.data.chunkContent().text()
      const encryptedBytes3 = fullDirectoryData.data.chunkContent()
      const decryptedText3 = bytesToString(decryptBytes(bytesToHex(pod1.password), encryptedBytes3))
      expect(decryptedText3).toContain(directoryName)
      for (const metaWord of metaWords1) {
        expect(encryptedText3).not.toContain(metaWord)
        expect(decryptedText3).toContain(metaWord)
      }

      await fdp.file.uploadData(pod, fullFilenameSmallPath, contentSmall)
      const fileManifestData = await getFeedData(bee, fullFilenameSmallPath, prepareEthAddress(node1.address))
      const encryptedText4 = fileManifestData.data.chunkContent().text()
      const encryptedBytes4 = fileManifestData.data.chunkContent()
      const decryptedText4 = bytesToString(decryptBytes(bytesToHex(pod1.password), encryptedBytes4))
      const metaWords2 = [filenameSmall, 'version', 'filePath', 'fileName', 'fileSize', 'fileInodeReference']
      for (const metaWord of metaWords2) {
        expect(encryptedText4).not.toContain(metaWord)
        expect(decryptedText4).toContain(metaWord)
      }

      // check file metadata
      const metaObject = JSON.parse(decryptedText4)
      const blocksReference = base64toReference(metaObject.fileInodeReference)
      assertEncryptedReference(blocksReference)
      const decryptedData5 = await bee.downloadData(blocksReference)
      const decryptedText5 = decryptedData5.text()
      const metaWords3 = ['blocks', 'size', 'compressedSize', 'reference']
      for (const metaWord of metaWords3) {
        expect(decryptedText5).toContain(metaWord)
      }

      // check file block
      const blocks = JSON.parse(decryptedText5)
      const blockReference = base64toReference(blocks.blocks[0].reference.swarm)
      const encryptedData6 = await bee.downloadData(blockReference)
      const decryptedText6 = encryptedData6.text()
      expect(decryptedText6).toEqual(contentSmall)
    })
  })
})
