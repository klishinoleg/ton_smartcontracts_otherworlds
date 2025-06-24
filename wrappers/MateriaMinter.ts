import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider, Dictionary,
    Sender,
    SendMode,
    toNano, TupleBuilder, TupleItem
} from 'ton-core';

import {Op} from './MateriaConstants';
import Decimal from "decimal.js";
import {JettonWallet} from "ton";
import retryTimes = jest.retryTimes;
import Any = jasmine.Any;

export const fwd_fee = 1804014n, gas_consumption = 15000000n, min_tons_for_storage = 10000000n;
export const INIT_MAT_FOR_TON: bigint = 100_000n;
export const TAX_VALUE: bigint = 30n
export const PRICE_MULTIPLIER: bigint = 160n

/**
 * Off-chain metadata descriptor for Jetton.
 */
export type JettonMinterContent = {
    type: 0 | 1;
    uri: string;
};

/**
 * Configuration used to initialize the MateriaMinter contract.
 */
export type MateriaMinterConfig = {
    totalSuply: number;
    admin: Address;
    pubkey: bigint;
    content: Cell;
    wallet_code: Cell;
};

/**
 * Serializes MateriaMinter configuration into a single data Cell.
 */
export function jettonMinterConfigToCell(config: MateriaMinterConfig): Cell {
    return beginCell()
        .storeCoins(config.totalSuply)
        .storeAddress(config.admin)
        .storeUint(config.pubkey, 256)
        .storeRef(config.content)
        .storeRef(config.wallet_code)
        .storeDict()
        .endCell();
}

/**
 * Serializes Jetton content into a Cell following JettonMetadata standard.
 */
export function jettonContentToCell(content: JettonMinterContent): Cell {
    return beginCell()
        .storeUint(content.type, 8)
        .storeStringTail(content.uri)     // UTF-8 string
        .endCell();
}

/**
 * MateriaMinter smart contract wrapper with interaction logic.
 */
export class MateriaMinter implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell }
    ) {
    }

    /**
     * Creates an instance of MateriaMinter from an existing deployed address.
     * This is used for interacting with already deployed contracts.
     *
     * @param address - The address of the deployed MateriaMinter contract
     * @returns An instance of MateriaMinter without init data
     */
    static createFromAddress(address: Address): MateriaMinter {
        return new MateriaMinter(address);
    }

    /**
     * Creates an instance of MateriaMinter from configuration.
     * Used to predict address or deploy a new contract.
     *
     * @param config - The initial configuration (admin, content, wallet code, txIds)
     * @param code - The compiled code cell for the contract
     * @param workchain - Workchain ID (default 0)
     * @returns A deployable instance of MateriaMinter with init data
     */
    static createFromConfig(
        config: MateriaMinterConfig,
        code: Cell,
        workchain: number = 0
    ): MateriaMinter {
        const data: Cell = jettonMinterConfigToCell(config);
        const init = {code, data};
        const address: Address = contractAddress(workchain, init);
        return new MateriaMinter(address, init);
    }

    /**
     * Sends a deploy message to initialize the MateriaMinter contract.
     * This must be called once after deploying the contract with init data.
     *
     * Message includes:
     * - op = `Op.init_minter`
     * - serverPubkey = 256-bit public key to be stored on-chain
     *
     * @param provider - Contract provider to send the message
     * @param via - Sender wallet used to initialize the contract
     * @param initTonAmount - Amount of TON to cover deployment and gas
     * @param serverPubkey - 256-bit public key used for signature verification in mint/experience ops
     * @param queryId : bigint
     */
    async sendDeploy(
        provider: ContractProvider,
        via: Sender,
        initTonAmount: bigint,
        serverPubkey: bigint,
        queryId: bigint = 0n
    ): Promise<void> {
        const body: Cell = beginCell()
            .storeUint(Op.init_minter, 32)
            .storeUint(queryId, 64)
            .storeCoins(initTonAmount)
            .storeUint(serverPubkey, 256)
            .endCell();
        await provider.internal(via, {
            value: initTonAmount,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body,
        });
    }

    /**
     * Builds an internal transfer message compatible with Jetton Wallet (TEP-64).
     * Typically used when forwarding jettons after mint or via proxy logic.
     *
     * Fields:
     * - op = `0x0f8a7ea5` (internal_transfer)
     * - query_id = custom optional value
     * - jetton_amount = amount of jettons to transfer
     * - destination = left null (let the wallet resolve it)
     * - response_address = address to send success/failure notification
     * - forward_ton_amount = TON to forward with jetton
     * - custom_payload = none
     *
     * @param jetton_amount - Amount of jettons to send
     * @param forward_ton_amount - Amount of TON to forward to recipient
     * @param response_addr - Optional response address (receives confirmation/error)
     * @param query_id - Optional message identifier (default: 0)
     * @returns Cell containing internal transfer message
     */
    protected static jettonInternalTransfer(
        jetton_amount: bigint,
        forward_ton_amount: bigint,
        response_addr?: Address,
        query_id: number | bigint = 0n
    ): Cell {
        return beginCell()
            .storeUint(Op.internal_transfer, 32)  // Jetton op code
            .storeUint(query_id, 64)              // Optional tracking ID
            .storeCoins(jetton_amount)            // Jetton amount
            .storeAddress(null)                   // Recipient: null (auto)
            .storeAddress(response_addr)          // Response address
            .storeCoins(forward_ton_amount)       // TON to forward
            .storeBit(false)                      // No custom payload
            .endCell();
    }

    /**
     * Builds a message to request an experience update through `receive_experience` operation.
     *
     * The message includes:
     * - op code (0x08)
     * - query ID
     * - signature (stored in a referenced cell)
     * - XP value (uint64)
     * - timestamp (uint64)
     *
     * @param signature - 64-byte Ed25519 signature of (address + xp + timestamp)
     * @param xp - Amount of experience to be credited
     * @param timestamp - Signature timestamp (should be close to current time)
     * @param query_id - Optional identifier for tracking the message
     */
    static receiveExperienceMessage(
        signature: Buffer,
        xp: bigint,
        timestamp: bigint,
        query_id: number | bigint = 0n
    ): Cell {
        return beginCell()
            .storeUint(Op.receive_experience, 32)
            .storeUint(query_id, 64)
            .storeUint(xp, 64)
            .storeUint(timestamp, 64)
            .storeBuffer(signature, 64)
            .endCell();
    }

    /**
     * Sends a signed request to the minter to credit experience (MAT) to the sender.
     * The contract will verify the signature using the server public key and ensure the request is fresh.
     *
     * @param provider - Contract provider used to send the message
     * @param via - Sender wallet (must match the address in the signed message)
     * @param signature - 64-byte Ed25519 signature created by server
     * @param xp - Experience value to apply
     * @param timestamp - When the signature was issued
     * @param value - Amount of TON to send (must match EXPERIENCE_TOTAL_FEE in contract)
     */
    async sendReceiveExperienceMessage(
        provider: ContractProvider,
        via: Sender,
        signature: Buffer,
        xp: bigint,
        timestamp: bigint,
        value: bigint = toNano("0.5")
    ): Promise<void> {
        const body = MateriaMinter.receiveExperienceMessage(signature, xp, timestamp);

        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body,
            value, // Must match EXPERIENCE_TOTAL_FEE()
        });
    }

    static mintMessage(
        query_id: number | bigint = 0,
    ): Cell {
        return beginCell()
            .storeUint(Op.mint, 32)
            .storeUint(query_id, 64)
            .endCell();
    }

    /**
     * Sends a mint request to the minter. The amount of TON sent will be converted into MAT inside the contract.
     *
     * @param provider - Contract provider for interaction
     * @param via - Sender account
     * @param ton_amount - The amount of TON to pay (converted to MAT)
     */
    async sendMintMessage(
        provider: ContractProvider,
        via: Sender,
        ton_amount: bigint
    ): Promise<void> {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: MateriaMinter.mintMessage(),
            value: ton_amount
        });
    }

    /**
     * Builds a message to request the jetton wallet address for a given owner.
     * Contract will respond with `take_wallet_address` if `op::provide_wallet_address()` is matched.
     *
     * @param owner - Owner address for whom to resolve wallet address
     * @param include_address - Whether to include original address as ref in response
     * @returns Cell containing the discovery request
     */
    static discoveryMessage(owner: Address, include_address: boolean): Cell {
        return beginCell()
            .storeUint(Op.provide_wallet_address, 32) // op code: provide_wallet_address()
            .storeUint(0, 64)                         // query_id
            .storeAddress(owner)                      // MsgAddress
            .storeBit(include_address)                // 1-bit flag
            .endCell();
    }

    /**
     * Sends a request to the minter to retrieve the Jetton Wallet address for a user.
     * The contract will respond with `take_wallet_address` and optional reference to the original address.
     *
     * @param provider - Provider to interact with the blockchain
     * @param via - Wallet sender
     * @param owner - Address to resolve
     * @param include_address - Whether to include original address in ref
     * @param value - Amount of TON to attach (must exceed forward + gas)
     */
    async sendDiscoveryMessage(
        provider: ContractProvider,
        via: Sender,
        owner: Address,
        include_address: boolean,
        value: bigint = toNano('0.1')
    ): Promise<void> {
        if (value <= toNano('0.01')) {
            throw new Error("TON amount too low; must exceed forward fee + gas");
        }

        const body: Cell = MateriaMinter.discoveryMessage(owner, include_address);

        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body,
            value,
        });
    }

    /**
     * Builds a message to change the admin (owner) address of the minter contract.
     * Can only be called by the current admin.
     *
     * FunC expects:
     * - op = 3
     * - query_id = 0 (ignored)
     * - new admin as MsgAddress
     *
     * @param newOwner - Address to assign as the new admin
     * @returns A Cell containing the change_admin message
     */
    static changeAdminMessage(newOwner: Address): Cell {
        return beginCell()
            .storeUint(Op.change_admin, 32) // op = 3
            .storeUint(0, 64)               // query_id (ignored)
            .storeAddress(newOwner)        // new admin address
            .endCell();
    }


    /**
     * Sends a request to change the minter contract's admin address.
     * Must be sent from the current admin wallet.
     *
     * @param provider - ContractProvider for blockchain interaction
     * @param via - Sender (must be current admin)
     * @param newOwner - Address to become the new admin
     */
    async sendChangeAdminMessage(
        provider: ContractProvider,
        via: Sender,
        newOwner: Address
    ): Promise<void> {
        if (!newOwner) {
            throw new Error("New admin address must be provided");
        }

        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: MateriaMinter.changeAdminMessage(newOwner),
            value: toNano("0.05"), // Must be enough to cover gas
        });
    }

    /**
     * Builds a message to request minting MAT from a signed game event.
     * The contract will verify the signature, prevent replays via tx_id, and mint MAT.
     *
     * @param signature - Ed25519 64-byte signature from the server
     * @param amount - Amount of MAT to mint (nano-units)
     * @param tx_id - Unique transaction ID for deduplication
     * @param timestamp - Time the signature was created (unix)
     * @param query_id - Optional message identifier
     * @returns Cell containing the encoded message
     */
    static mintFromGameMessage(
        signature: Buffer,
        amount: bigint,
        tx_id: number | bigint,
        timestamp: number | bigint,
        query_id: number | bigint = 0n
    ): Cell {

        return beginCell()
            .storeUint(Op.mint_from_game, 32)     // op = 0x02
            .storeUint(query_id, 64)              // optional query_id
            .storeCoins(amount)                   // amount of MAT to mint
            .storeUint(tx_id, 64)                 // unique tx_id
            .storeUint(timestamp, 64)             // timestamp (for expiration check)
            .storeBuffer(signature, 64)              // ref to signature
            .endCell();
    }

    /**
     * Sends a signed mint-from-game message to the contract.
     * This method allows trusted minting based on off-chain game events.
     *
     * @param provider - Blockchain provider
     * @param via - Sender (typically the player)
     * @param signature - Server signature for this request
     * @param amount - Amount of MAT to mint
     * @param tx_id - Unique transaction ID for replay protection
     * @param timestamp - Unix timestamp of the signature (validated on-chain)
     * @param value - Amount of TON to send with the request (covers gas)
     */
    async sendMintFromGameMessage(
        provider: ContractProvider,
        via: Sender,
        signature: Buffer,
        amount: bigint,
        tx_id: number | bigint,
        timestamp: number | bigint,
        value: bigint = toNano("0.05")
    ): Promise<void> {
        const body: Cell = MateriaMinter.mintFromGameMessage(signature, amount, tx_id, timestamp);

        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body,
            value,
        });
    }

    /**
     * Builds a message to update the server public key used for signature verification.
     * Only the current admin can send this message.
     *
     * @param newPubkey - New 256-bit Ed25519 public key
     * @param query_id - Optional message ID for tracking
     * @returns Cell with the update_pubkey message
     */
    static updatePubkeyMessage(
        newPubkey: bigint,
        query_id: number | bigint = 0n
    ): Cell {
        return beginCell()
            .storeUint(Op.update_pubkey, 32)  // op = 0x01
            .storeUint(query_id, 64)          // query_id (ignored)
            .storeUint(newPubkey, 256)        // New pubkey to set
            .endCell();
    }

    /**
     * Sends a request to update the server public key.
     * Must be called by the current admin wallet.
     *
     * @param provider - Blockchain provider
     * @param via - Sender (must match current admin address)
     * @param newPubkey - New 256-bit Ed25519 public key to be stored
     * @param value - TON to cover the transaction (default 0.05)
     */
    async sendUpdatePubkeyMessage(
        provider: ContractProvider,
        via: Sender,
        newPubkey: bigint,
        value: bigint = toNano("0.05")
    ): Promise<void> {
        const body = MateriaMinter.updatePubkeyMessage(newPubkey);

        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body,
            value,
        });
    }

    /**
     * Builds a message to request exchange of MAT tokens back to TON.
     * The contract will calculate the TON amount using current formula and burn the MAT tokens.
     *
     * @param amount - Amount of MAT to exchange (in nanoMAT)
     * @param query_id - Optional message identifier
     * @returns Cell with encoded message
     */
    static materiaToTonMessage(
        amount: bigint,
        query_id: number | bigint = 0n
    ): Cell {
        return beginCell()
            .storeUint(Op.materia_to_ton, 32) // op = 0x05
            .storeUint(query_id, 64)
            .storeCoins(amount)               // amount of MAT to convert
            .endCell();
    }

    /**
     * Sends a request to exchange MAT to TON.
     * The user burns MAT, and the contract returns TON based on the current formula.
     *
     * @param provider - Contract provider
     * @param via - Sender wallet that holds MAT tokens
     * @param amount - Amount of MAT to convert
     * @param value - TON attached to the message to cover gas and fees (default: 0.05 TON)
     */
    async sendMateriaToTon(
        provider: ContractProvider,
        via: Sender,
        amount: bigint,
        value: bigint = toNano('0.05')
    ): Promise<void> {
        const body = MateriaMinter.materiaToTonMessage(amount);

        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body,
            value,
        });
    }

    /**
     * Builds a message to update the stored public key used for verifying signatures.
     * Can only be called by the current admin.
     *
     * @param newPubkey - The new 256-bit public key (as bigint)
     * @param query_id - Optional query identifier (default = 0)
     * @returns Cell representing the update_pubkey message
     */
    static changePubkeyMessage(newPubkey: bigint, query_id: number | bigint = 0n): Cell {
        return beginCell()
            .storeUint(Op.update_pubkey, 32)  // op = 0x01
            .storeUint(query_id, 64)          // query ID
            .storeUint(newPubkey, 256)        // new server public key
            .endCell();
    }

    /**
     * Sends a request to update the server public key in the contract.
     * Must be called from the current admin wallet.
     *
     * @param provider - Contract provider
     * @param via - Sender (must be current admin)
     * @param newPubkey - New 256-bit public key (as bigint)
     * @param value - TON amount to cover gas (default: 0.05)
     */
    async sendChangePubkeyMessage(
        provider: ContractProvider,
        via: Sender,
        newPubkey: bigint,
        value: bigint = toNano("0.05")
    ): Promise<void> {
        const body = MateriaMinter.changePubkeyMessage(newPubkey);

        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body,
            value,
        });
    }


    /**
     * Returns the Jetton Wallet address for the specified owner address.
     *
     * This method calls the `get_wallet_address` getter of the minter contract,
     * which calculates the deterministic address of the user's Jetton Wallet
     * using the contract’s current wallet code and the provided owner address.
     *
     * @param provider - Smart contract provider interface
     * @param owner - Address of the user whose wallet address should be calculated
     * @returns Resolved Address of the Jetton Wallet
     */
    async getWalletAddress(
        provider: ContractProvider,
        owner: Address
    ): Promise<Address> {
        const res = await provider.get('get_wallet_address', [{
            type: 'slice',
            cell: beginCell().storeAddress(owner).endCell()
        }]);

        return res.stack.readAddress();
    }

    /**
     * Get smartconract TON balance
     * @param provider
     */
    async getBalance(provider: ContractProvider): Promise<bigint> {
        return (await provider.getState()).balance;
    }

    /**
     * Retrieves on-chain metadata about the Jetton from the minter contract.
     *
     * Corresponds to the FunC getter:
     * (int, int, slice, cell, cell) get_jetton_data() method_id {
     *   (int total_supply, slice admin_address, cell content, cell jetton_wallet_code, cell tx_ids) = load_data();
     *   return (total_supply, -1, admin_address, content, jetton_wallet_code);
     * }
     *
     * @param provider - ContractProvider used to interact with the blockchain
     * @returns An object with totalSupply, mintable flag, admin address, content cell, and wallet code
     */
    async getJettonData(
        provider: ContractProvider
    ): Promise<{
        totalSupply: bigint;
        mintable: boolean;
        adminAddress: Address;
        content: Cell;
        walletCode: Cell;
    }> {
        const res = await provider.get('get_jetton_data', []);

        return {
            totalSupply: res.stack.readBigNumber(),  // int total_supply
            mintable: res.stack.readBoolean(),       // always returns -1 (true) for now
            adminAddress: res.stack.readAddress(),   // slice admin_address
            content: res.stack.readCell(),           // cell content
            walletCode: res.stack.readCell(),        // cell jetton_wallet_code
        };
    }


    async getDictLen(provider: ContractProvider): Promise<number> {
        const res = await provider.get("get_dict_len", []);
        return res.stack.readNumber();
    }

    async getDictKeys(provider: ContractProvider): Promise<Array<bigint>> {
        const res = await provider.get("get_dict_keys", []);
        const keysTuple = res.stack.readTuple();
        const keys: bigint[] = [];
        while (true) {
            try {
                keys.push(keysTuple.readBigNumber());
            } catch (e) {
                break;
            }
        }
        return keys;
    }

    /**
     * Returns the current total supply of the Jetton in smallest units (e.g., nanoMAT).
     *
     * @param provider - Contract provider to call the getter
     * @returns Total minted supply as bigint
     */
    async getTotalSupply(provider: ContractProvider): Promise<bigint> {
        return (await this.getJettonData(provider)).totalSupply;
    }

    /**
     * Returns the address of the current Jetton minter admin.
     *
     * @param provider - Contract provider to call the getter
     * @returns Address of the admin
     */
    async getAdminAddress(provider: ContractProvider): Promise<Address> {
        return (await this.getJettonData(provider)).adminAddress;
    }

    /**
     * Returns the metadata content cell of the Jetton.
     * This cell typically contains a reference to an off-chain URI or on-chain data.
     *
     * @param provider - Contract provider to call the getter
     * @returns Content cell as defined in Jetton metadata format
     */
    async getContent(provider: ContractProvider): Promise<Cell> {
        return (await this.getJettonData(provider)).content;
    }


    /**
     * Fetches current MAT/TON price from the contract with high-precision decimal format.
     *
     * @param provider - Contract provider to call the getter
     * @returns Total minted supply as bigint
     */
    async getCurrentPriceDecimal(provider: ContractProvider): Promise<Decimal> {
        const totalSupply: bigint = await this.getTotalSupply(provider);

        const args = new TupleBuilder();
        args.writeNumber(totalSupply);

        const res = await provider.get('get_price_9', args.build());
        const rawPrice: bigint = res.stack.readBigNumber();

        return new Decimal('1').div(rawPrice.toString()).toDecimalPlaces(9);
    }

    /**
     * Validates that totalSupply was correctly initialized after deployment.
     * Contract logic: totalSupply must equal (TON × INIT_MAT_FOR_TON)
     *
     * @param provider - Contract provider to call the getter
     * @param tonAmount - Amount of TON (in nanoTON) used in initialization
     */
    async getInitialSupplyCorrect(
        provider: ContractProvider,
        tonAmount: bigint
    ): Promise<boolean> {
        const expectedSupply = tonAmount * INIT_MAT_FOR_TON / 1_000_000_000n;
        const actualSupply = await this.getTotalSupply(provider);
        return actualSupply == expectedSupply;
    }

    /**
     * Checks that the expected amount of MAT was minted into sender's wallet.
     *
     * @param provider - Contract provider to call the getter
     * @param wallet - Sender's Jetton wallet
     * @param initialBalance - Sender's wallet balance before mint (in nanoMAT)
     * @param tonSent - Amount of TON sent for mint (in nanoTON)
     * @param priceDecimal - Current MAT/TON exchange rate as Decimal
     */
    async expectMintedAmountCorrect(
        provider: ContractProvider,
        wallet: JettonWallet,
        initialBalance: bigint,
        tonSent: bigint,
        priceDecimal: Decimal
    ): Promise<void> {
        const finalBalance = await wallet.getBalance(provider);

        const tonAmountDecimal = new Decimal(tonSent.toString());
        const expectedMint = tonAmountDecimal.mul(priceDecimal).toDecimalPlaces(0, Decimal.ROUND_DOWN); // → nanoMAT

        const expectedFinal = new Decimal(initialBalance.toString()).add(expectedMint);

        expect(finalBalance.toString()).toBe(expectedFinal.toString());
    }
}
