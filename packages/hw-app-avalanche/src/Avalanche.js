//@flow

import type Transport from "@ledgerhq/hw-transport";
import BIPPath from "bip32-path";

/**
 * Avalanche API
 *
 * @example
 * import Avalanche from "@ledgerhq/hw-app-avalanche";
 * const avalanche = new Avalanche(transport);
 */
export default class Avalanche {
  transport: Transport<*>;

  MAX_APDU_SIZE = 230;

  INS_VERSION = 0x00;
  INS_GIT = 0x01;
  INS_GET_WALLET_ID = 0x02;
  INS_PROMPT_PUBLIC_KEY = 0x03;
  INS_PROMPT_EXT_PUBLIC_KEY = 0x04;
  INS_SIGN_HASH = 0x05;

  constructor(transport: Transport<*>, scrambleKey: string = "Avalanche") {
    this.transport = transport;
    transport.decorateAppAPIMethods(
      this,
      [
        "getAppConfiguration",
        "getWalletId",
        "getWalletPublicKey",
        "signTransaction"
      ],
      scrambleKey
    );
  }

  /**
   * get Avalanche address for a given BIP-32 path.
   *
   * @param derivation_path a path in BIP 32 format
   * @return a buffer with a public key, and TODO: should be address, not public key
   * @example
   * const result = await avalanche.getWalletPublicKey("44'/9000'/0'/0/0");
   * const publicKey = result;
   */
  async getWalletPublicKey(derivation_path: string): Promise<Buffer> {
    const bipPath = BIPPath.fromString(derivation_path).toPathArray();

    const cla = 0x80;
    const ins = this.INS_PROMPT_PUBLIC_KEY;
    const p1 = 0x00;
    const p2 = 0x00;
    const data = Buffer.alloc(1 + bipPath.length * 4);

    data.writeUInt8(bipPath.length, 0);
    bipPath.forEach((segment, index) => {
      data.writeUInt32BE(segment, 1 + index * 4);
    });

    const response = await this.transport.send(cla, ins, p1, p2, data);
    const publicKeyLength = response[0];
    return response.slice(1, 1 + publicKeyLength);
  }

  /**
   * get extended public key for a given BIP 32 path.
   *
   * @param derivation_path a path in BIP 32 format
   * @return an object containing an extended public key
   * @example
   * const result = await avalanche.getWalletPublicKey("44'/9000'/0'/0/0");
   * const publicKey = result;
   */
  async getWalletExtendedPublicKey(derivation_path: string): Promise<{
    public_key: Buffer,
    chain_code: Buffer
  }> {
    const bipPath = BIPPath.fromString(derivation_path).toPathArray();

    const cla = 0x80;
    const ins = this.INS_PROMPT_EXT_PUBLIC_KEY;
    const p1 = 0x00;
    const p2 = 0x00;
    const data = Buffer.alloc(1 + bipPath.length * 4);

    data.writeUInt8(bipPath.length, 0);
    bipPath.forEach((segment, index) => {
      data.writeUInt32BE(segment, 1 + index * 4);
    });

    const response = await this.transport.send(cla, ins, p1, p2, data);
    const publicKeyLength = response[0];
    const chainCodeOffset = 2+publicKeyLength;
    const chainCodeLength = response[1+publicKeyLength];
    return {
      public_key: response.slice(1, 1 + publicKeyLength),
      chain_code: response.slice(chainCodeOffset, chainCodeOffset+chainCodeLength),
    };
  }

  /**
   * Sign a hash with a given BIP-32 path.
   *
   * @param derivation_path a path in BIP 32 format
   * @param hash hex-encoded hash to sign
   * @return an signature object
   * @example
   * const signature = await avalanche.signHash("44'/9000'/0'/0/0", "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000");
   */
  async signHash(
    derivation_path: string,
    hash: string
  ): Promise<{
    hash: Buffer,
    signature: Buffer
  }> {
    const bipPath = BIPPath.fromString(derivation_path).toPathArray();
    // TODO: It would be nice to have either Buffer or string as parameter
    const rawTx = Buffer.from(hash, "hex");

    let rawPath = Buffer.alloc(1 + bipPath.length * 4);
    rawPath.writeInt8(bipPath.length, 0);
    bipPath.forEach((segment, index) => {
      rawPath.writeUInt32BE(segment, 1 + index * 4);
    });
    await this.transport.send(0x80, this.INS_SIGN_HASH, 0x00, 0x00, rawPath);

    const txFullChunks = Math.floor(rawTx.length / this.MAX_APDU_SIZE);
    for (let i = 0; i < txFullChunks; i++) {
      const data = rawTx.slice(i*this.MAX_APDU_SIZE, (i+1)*this.MAX_APDU_SIZE);
      await this.transport.send(0x80, this.INS_SIGN_HASH, 0x01, 0x00, data);
    }

    const lastOffset = Math.floor(rawTx.length / this.MAX_APDU_SIZE) * this.MAX_APDU_SIZE;
    const lastData = rawTx.slice(lastOffset, lastOffset+this.MAX_APDU_SIZE);
    const response = await this.transport.send(0x80, this.INS_SIGN_HASH, 0x81, 0x00, lastData);
    const resp = Buffer.from(response, "hex");

    const respHash = resp.slice(0, 32);
    if (respHash != hash) {
      throw "Signed hash does not match input hash!";
    }

    return {
      hash: respHash,
      signature: resp.slice(32, -2),
    };
  }

  /**
   * Get the version of the Avalanche app installed on the hardware device
   *
   * @return an object with a version
   * @example
   * const result = await avalanche.getAppConfiguration();
   *
   * {
   *   "version": "1.0.3",
   *   "hash": "0000000000000000000000000000000000000000"
   * }
   */
  async getAppConfiguration(): Promise<{
    version: string,
    hash: string
  }> {
    const version = await this.transport.send(0x80, this.INS_VERSION, 0x00, 0x00);
    const hash = await this.transport.send(0x80, this.INS_GIT, 0x00, 0x00);

    const result = {};
    result.version =
      "" + version[0] + "." + version[1] + "." + version[2];
    result.hash = hash.toString("hex");

    return result;
  }

  /**
   * Get the wallet identifier for the Ledger wallet
   *
   * @return a byte string
   * @example
   * const id = await avalanche.getWalletId();
   *
   * "0x69c46b6dd072a2693378ef4f5f35dcd82f826dc1fdcc891255db5870f54b06e6"
   */
  async getWalletId(): Promise<Buffer> {
    const response = await this.transport.send(0x80, this.INS_GET_WALLET_ID, 0x00, 0x00);

    return result.slice(0,-2);
  }
}
