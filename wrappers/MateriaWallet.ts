import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider, fromNano,
    Sender,
    SendMode,
    toNano
} from 'ton-core';
import {Op} from "./MateriaConstants";

export type JettonWalletConfig = {};

export function jettonWalletConfigToCell(config: JettonWalletConfig): Cell {
    return beginCell().endCell();
}

export class MateriaWallet implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {
    }

    static createFromAddress(address: Address) {
        return new MateriaWallet(address);
    }

    static createFromConfig(config: JettonWalletConfig, code: Cell, workchain = 0) {
        const data = jettonWalletConfigToCell(config);
        const init = {code, data};
        return new MateriaWallet(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async getMateriaBalance(provider: ContractProvider) {
        let state = await provider.getState();
        if (state.state.type !== 'active') {
            return 0n;
        }
        let res = await provider.get('get_wallet_data', []);
        return res.stack.readBigNumber();
    }

    async getExperience(provider: ContractProvider) {
        let state = await provider.getState();
        if (state.state.type !== 'active') {
            return 0n;
        }
        let res = await provider.get('get_experience', []);
        return res.stack.readBigNumber()
    }

    async getBalance(provider: ContractProvider): Promise<string> {
        return fromNano((await this.getWalletData(provider) ?? {balance: "0"}).balance);
    }

    async getWalletData(provider: ContractProvider) {
        const state = await provider.getState();
        if (state.state.type !== 'active') {
            return null;
        }
        const res = await provider.get('get_wallet_data', []);
        return {
            balance: res.stack.readBigNumber(),
            owner_address: res.stack.readAddress(),
            jetton_master_address: res.stack.readAddress(),
            jetton_wallet_code: res.stack.readCell(),
            experience: res.stack.readBigNumber()
        };
    }

    static transferMessage(jetton_amount: bigint, to: Address,
                           responseAddress: Address,
                           customPayload: Cell | null,
                           forward_ton_amount: bigint,
                           forwardPayload: Cell | null) {
        return beginCell()
            .storeUint(Op.transfer, 32).storeUint(0, 64) // op, queryId
            .storeCoins(jetton_amount).storeAddress(to)
            .storeAddress(responseAddress)
            .storeMaybeRef(customPayload)
            .storeCoins(forward_ton_amount)
            .storeMaybeRef(forwardPayload)
            .endCell();
    }

    async sendTransfer(provider: ContractProvider, via: Sender,
                       value: bigint,
                       jetton_amount: bigint, to: Address,
                       responseAddress: Address,
                       customPayload: Cell,
                       forward_ton_amount: bigint,
                       forwardPayload: Cell) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: MateriaWallet.transferMessage(jetton_amount, to, responseAddress, customPayload, forward_ton_amount, forwardPayload),
            value: value
        });

    }

    /*
      burn#595f07bc query_id:uint64 amount:(VarUInteger 16)
                    response_destination:MsgAddress custom_payload:(Maybe ^Cell)
                    = InternalMsgBody;
    */
    static burnMessage(jetton_amount: bigint,
                       responseAddress: Address,
                       customPayload: Cell | null) {
        return beginCell().storeUint(0x595f07bc, 32).storeUint(0, 64) // op, queryId
            .storeCoins(jetton_amount).storeAddress(responseAddress)
            .storeMaybeRef(customPayload)
            .endCell();
    }

    async sendBurn(provider: ContractProvider, via: Sender, value: bigint,
                   jetton_amount: bigint,
                   responseAddress: Address,
                   customPayload: Cell) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: MateriaWallet.burnMessage(jetton_amount, responseAddress, customPayload),
            value: value
        });

    }

    /*
      withdraw_tons#107c49ef query_id:uint64 = InternalMsgBody;
    */
    static withdrawTonsMessage() {
        return beginCell().storeUint(0x6d8e5e3c, 32).storeUint(0, 64) // op, queryId
            .endCell();
    }

    async sendWithdrawTons(provider: ContractProvider, via: Sender) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: MateriaWallet.withdrawTonsMessage(),
            value: toNano('0.1')
        });

    }

    /*
      withdraw_jettons#10 query_id:uint64 wallet:MsgAddressInt amount:Coins = InternalMsgBody;
    */
    static withdrawJettonsMessage(from: Address, amount: bigint) {
        return beginCell().storeUint(0x768a50b2, 32).storeUint(0, 64) // op, queryId
            .storeAddress(from)
            .storeCoins(amount)
            .storeMaybeRef(null)
            .endCell();
    }

    async sendWithdrawJettons(provider: ContractProvider, via: Sender, from: Address, amount: bigint) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: MateriaWallet.withdrawJettonsMessage(from, amount),
            value: toNano('0.1')
        });

    }
}