// Shapes of the JSON files Sailor persists under .sail/.
// Addresses are stored checksummed; bigints are stored as decimal strings.

export type StoredAccount = {
  safe: string;
  owner: string;
  permissionSigner: string;
  manager: string;
  chainId: number;
  createdAtBlock: string;
};

export type StoredMandatePermission = {
  template: string;
  params: unknown;
};

export type StoredMandate = {
  safe: string;
  chainId: number;
  signedAt: string;
  signature: string;
  registeredOnChain: boolean;
  permissions: StoredMandatePermission[];
};

export type StoredSession = {
  safe: string;
  active: boolean;
  updatedAt: string;
};
