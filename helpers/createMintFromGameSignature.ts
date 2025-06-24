import nacl from 'tweetnacl';
import {Address, beginCell} from 'ton-core';
import {SERVER_PRIVATE_KEY} from "../constants/MateriaKeys";

export function createMintFromGameSignature(params: {
    sender: Address;
    jettonAmount: bigint;
    txId: bigint;
    timestamp: bigint;
}, key: Uint8Array | null = null): Buffer {
    const {sender, jettonAmount, txId, timestamp} = params;

    // .store_slice(sender_address)
    // .store_uint(jettonAmount, 64)
    // .store_uint(txId, 64)
    // .store_uint(timestamp, 64)
    const payload = beginCell()
        .storeAddress(sender)
        .storeUint(jettonAmount, 64)
        .storeUint(txId, 64)
        .storeUint(timestamp, 64)
        .endCell();

    const hash = payload.hash();
    const signature = nacl.sign.detached(hash, key ?? SERVER_PRIVATE_KEY);

    return Buffer.from(signature);
}
