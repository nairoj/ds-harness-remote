export interface DeviceIdentity {
  deviceId: string;
  publicKey: string;
  privateKey: string;
}
export interface RemoteDevice {
  deviceId: string;
  identityKey: string;
  name: string;
  clientVersion: string;
  harnessVersion?: string;
  online: boolean;
  role: string;
}
