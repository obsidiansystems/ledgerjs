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

  CLA = 0x80;
  MAX_APDU_SIZE = 230;

  INS_VERSION = 0x00;
  INS_GET_WALLET_ID = 0x01;
  INS_PROMPT_PUBLIC_KEY = 0x02;
  INS_PROMPT_EXT_PUBLIC_KEY = 0x03;
  INS_SIGN_HASH = 0x04;

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

    const cla = this.CLA;
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

    const cla = this.CLA;
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
   * @param derivationPathPrefix a BIP-32 path that will act as the prefix to all other signing paths.
   * @param derivationPathSuffixes an array of BIP-32 path suffixes that will be
   *                               appended to the prefix to form the final path for signing.
   * @param hash hex-encoded hash to sign
   * @return an signature object
   * @example
   * const signature = await avalanche.signHash("44'/9000'/0'/0/0", "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000");
   */
  async signHash(
    derivationPathPrefix: BIPPath,
    derivationPathSuffixes: Array<BIPPath>,
    hash: Buffer,
  ): Promise<Map<string, Buffer>> {
    const uInt8Buffer: Buffer = uint8 => {
      let buff: Buffer = Buffer.alloc(1);
      buff.writeUInt8(uint8);
      return buff;
    };

    const uInt32BEBuffer: Buffer = uint32 => {
      let buff: Buffer = Buffer.alloc(4);
      buff.writeUInt32BE(uint32);
      return buff;
    };

    const encodeBip32Path: Buffer = (path: BIPPath) => {
      const pathArr = path.toPathArray();
      return Buffer.concat([uInt8Buffer(pathArr.length)].concat(pathArr.map(uInt32BEBuffer)));
    };

    {
      if (hash.length != 32) {
        throw "Hash buffer must be 32 bytes";
      }

      const firstMessage: Buffer = Buffer.concat([
        uInt8Buffer(derivationPathSuffixes.length),
        hash,
        encodeBip32Path(derivationPathPrefix)
      ]);
      const responseHash = await this.transport.send(this.CLA, this.INS_SIGN_HASH, 0x00, 0x00, firstMessage)
        .catch(e => console.error("Ledger error: ", e));
      if (!responseHash.slice(0, 32).equals(hash)) {
        throw "Ledger reported a hash that does not match the input hash!";
      }
    }

    let resultMap: Map<string, Buffer> = new Map();
    for (let ix = 0; ix < derivationPathSuffixes.length; ix++) {
      const suffix = derivationPathSuffixes[ix];
      const message: Buffer = encodeBip32Path(suffix);
      const isLastMessage: Boolean = ix >= derivationPathSuffixes.length - 1;
      const signatureData = await this.transport.send(this.CLA, this.INS_SIGN_HASH, isLastMessage ? 0x81 : 0x01, 0x00, message)
        .catch(e => console.error("Ledger error: ", e));
      resultMap.set(suffix.toString(true), signatureData.slice(0, -2));
    };
    return resultMap;
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
   *   "commit": "0000000000000000000000000000000000000000"
   *   "name": "Avax"
   * }
   */
  async getAppConfiguration(): Promise<{
    version: string,
    commit: string,
    name: string
  }> {
    const data: Buffer = await this.transport.send(this.CLA, this.INS_VERSION, 0x00, 0x00);

    const eatNBytes = function(input, n) {
      const out = input.slice(0, n);
      return [out, input.slice(n)];
    };

    const eatWhile = function(input, f) {
      for (var i = 0; i < input.length; i++) {
        if (!f(input[i])) {
          return [input.slice(0, i), input.slice(i)];
        }
      }
      return [input, ""];
    };

    const [versionData, rest1] = eatNBytes(data, 3);
    const [commitData, rest2] = eatWhile(rest1, c => c != 0);
    const [nameData, rest3] = eatWhile(rest2.slice(1), c => c != 0);
    if (rest3.toString("hex") != "009000") {
      console.error("WARNING: Response data does not exactly match expected format for VERSION instruction");
    }

    return {
      version: "" + versionData[0] + "." + versionData[1] + "." + versionData[2],
      commit: commitData.toString("latin1"),
      name: nameData.toString("latin1")
    };
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
    const result = await this.transport.send(this.CLA, this.INS_GET_WALLET_ID, 0x00, 0x00);
    return result.slice(0,-2);
  }
}
