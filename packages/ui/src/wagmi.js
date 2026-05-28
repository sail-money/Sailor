import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import {
  mainnet, arbitrum, arbitrumNova, arbitrumSepolia,
  base, baseSepolia,
  optimism, optimismSepolia,
  polygon, polygonAmoy, polygonZkEvm,
  bsc,
  avalanche, avalancheFuji,
  gnosis,
  celo,
  linea, lineaSepolia,
  zkSync,
  scroll, scrollSepolia,
  mantle,
  blast, blastSepolia,
  mode,
  manta,
  metis,
  fraxtal,
  worldchain,
  aurora,
  fantom,
  moonbeam, moonriver,
  cronos,
  filecoin,
  taiko, taikoHekla,
  berachainTestnetbArtio,
  zora,
  ancient8,
  apeChain,
} from 'wagmi/chains'

export const chains = [
  // Tier 1 mainnets
  base, arbitrum, optimism, mainnet, polygon, bsc,
  // L2s
  arbitrumNova, polygonZkEvm, linea, zkSync, scroll, mantle, blast, mode,
  manta, metis, fraxtal, worldchain, zora, aurora, ancient8, apeChain,
  // L1 alts
  avalanche, gnosis, celo, fantom, moonbeam, moonriver, cronos, filecoin, taiko,
  // Testnets
  baseSepolia, arbitrumSepolia, optimismSepolia, polygonAmoy, lineaSepolia,
  scrollSepolia, blastSepolia, avalancheFuji, taikoHekla, berachainTestnetbArtio,
]

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'sailor-local-dev'

export const wagmiConfig = getDefaultConfig({
  appName: 'Sailor',
  projectId,
  chains,
  ssr: false,
})
