import nacl from 'tweetnacl';
import {Address, beginCell} from 'ton-core';
import {SERVER_PRIVATE_KEY} from "../constants/MateriaKeys";

export function createExperienceSignature(params: {
    sender: Address;
    experience: bigint;
    timestamp: bigint;
}, key: Uint8Array | null = null): Buffer {
    const {sender, experience, timestamp} = params;

    // .store_slice(sender_address)
    // .store_uint(experience, 64)
    // .store_uint(timestamp, 64)
    const payload = beginCell()
        .storeAddress(sender)
        .storeUint(experience, 64)
        .storeUint(timestamp, 64)
        .endCell();

    const hash = payload.hash();
    const signature = nacl.sign.detached(hash, key ?? SERVER_PRIVATE_KEY);

    return Buffer.from(signature);
}
