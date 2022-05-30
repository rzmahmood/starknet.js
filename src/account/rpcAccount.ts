import { RPCProvider, RPCProviderInterface } from '../rpcProvider';
import { Signer, SignerInterface } from '../signer';
import {
  Abi,
  AddTransactionResponse,
  Call,
  InvocationsDetails,
  InvocationsSignerDetails,
  KeyPair,
  Signature,
} from '../types';
import { EstimateFee } from '../types/account';
import { getSelectorFromName, transactionVersion } from '../utils/hash';
import { BigNumberish, bigNumberishArrayToHexStringArray, toBN, toHex } from '../utils/number';
import { compileCalldata } from '../utils/stark';
import { fromCallsToExecuteCalldataWithNonce } from '../utils/transaction';
import { TypedData, getMessageHash } from '../utils/typedData';
import { AccountInterface } from './interface';

export class RPCAccount extends RPCProvider implements AccountInterface {
  public address: string;

  public signer: SignerInterface;

  constructor(
    provider: RPCProviderInterface,
    address: string,
    keyPairOrSigner: KeyPair | SignerInterface
  ) {
    super(provider);
    this.signer =
      'getPubKey' in keyPairOrSigner ? keyPairOrSigner : new Signer(keyPairOrSigner as KeyPair);
    this.address = address;
  }

  public async getNonce(): Promise<string> {
    const { result } = await this.callContract({
      contractAddress: this.address,
      entrypoint: 'get_nonce',
    });
    return toHex(toBN(result[0]));
  }

  public async estimateFee(_: Call | Call[]): Promise<EstimateFee> {
    throw new Error('Not Implemented');
  }

  /**
   * Invoke execute function in account contract
   *
   * [Reference](https://github.com/starkware-libs/cairo-lang/blob/f464ec4797361b6be8989e36e02ec690e74ef285/src/starkware/starknet/services/api/gateway/gateway_client.py#L13-L17)
   *
   * @param calls - one or more calls to be executed
   * @param abis - one or more abis which can be used to display the calls
   * @param transactionsDetail - optional transaction details
   * @returns a confirmation of invoking a function on the starknet contract
   */
  public async execute(
    calls: Call | Call[],
    abis: Abi[] | undefined = undefined,
    transactionsDetail: InvocationsDetails = {}
  ): Promise<AddTransactionResponse> {
    const transactions = Array.isArray(calls) ? calls : [calls];
    const nonce = toBN(transactionsDetail.nonce ?? (await this.getNonce()));
    // TODO: add estimate fee as soon as it's implemented into a node
    const maxFee: BigNumberish = '0';
    const signerDetails: InvocationsSignerDetails = {
      walletAddress: this.address,
      nonce,
      maxFee,
      version: toBN(transactionVersion),
      chainId: this.chainId,
    };

    const signature = await this.signer.signTransaction(transactions, signerDetails, abis);

    const calldata = fromCallsToExecuteCalldataWithNonce(transactions, nonce);
    return this.fetchEndpoint('starknet_addInvokeTransaction', [
      {
        contract_address: this.address,
        entry_point_selector: getSelectorFromName('__execute__'),
        calldata: bigNumberishArrayToHexStringArray(calldata),
      },
      bigNumberishArrayToHexStringArray(signature),
      toHex(toBN(maxFee)),
      toHex(toBN(transactionVersion)),
    ]);
  }

  /**
   * Sign an JSON object with the starknet private key and return the signature
   *
   * @param json - JSON object to be signed
   * @returns the signature of the JSON object
   * @throws {Error} if the JSON object is not a valid JSON
   */
  public async signMessage(typedData: TypedData): Promise<Signature> {
    return this.signer.signMessage(typedData, this.address);
  }

  /**
   * Hash a JSON object with pederson hash and return the hash
   *
   * @param json - JSON object to be hashed
   * @returns the hash of the JSON object
   * @throws {Error} if the JSON object is not a valid JSON
   */
  public async hashMessage(typedData: TypedData): Promise<string> {
    return getMessageHash(typedData, this.address);
  }

  /**
   * Verify a signature of a given hash
   * @warning This method is not recommended, use verifyMessage instead
   *
   * @param hash - JSON object to be verified
   * @param signature - signature of the JSON object
   * @returns true if the signature is valid, false otherwise
   * @throws {Error} if the JSON object is not a valid JSON or the signature is not a valid signature
   */
  public async verifyMessageHash(hash: BigNumberish, signature: Signature): Promise<boolean> {
    try {
      await this.callContract({
        contractAddress: this.address,
        entrypoint: 'is_valid_signature',
        calldata: compileCalldata({
          hash: toBN(hash).toString(),
          signature: signature.map((x) => toBN(x).toString()),
        }),
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Verify a signature of a JSON object
   *
   * @param hash - hash to be verified
   * @param signature - signature of the hash
   * @returns true if the signature is valid, false otherwise
   * @throws {Error} if the signature is not a valid signature
   */
  public async verifyMessage(typedData: TypedData, signature: Signature): Promise<boolean> {
    const hash = await this.hashMessage(typedData);
    return this.verifyMessageHash(hash, signature);
  }
}
