import './shim/crypto'
import { FdpStorage } from './fdp-storage'
import { AccountData } from './account/account-data'
import { PersonalStorage } from './pod/personal-storage'
import { Directory } from './directory/directory'

export { FdpStorage, AccountData, PersonalStorage, Directory }

// for require-like imports
declare global {
  interface Window {
    // bound as 'fdp' via Webpack
    fdp: {
      FdpStorage: typeof import('./fdp-storage').FdpStorage
      AccountData: typeof import('./account/account-data').AccountData
      PersonalStorage: typeof import('./pod/personal-storage').PersonalStorage
      Directory: typeof import('./directory/directory').Directory
    }
  }
}
