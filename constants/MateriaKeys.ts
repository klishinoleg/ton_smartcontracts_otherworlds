import nacl from 'tweetnacl';
import {readFileSync} from 'fs';
import {join} from "path";

// Read 32-byte seed from key.pk
const privateKeySeed = readFileSync(join(__dirname, 'key.pk'));
const privateNewKeySeed = readFileSync(join(__dirname, "new_key.pk"));

// Generate full keypair from seed
const keyPair = nacl.sign.keyPair.fromSeed(privateKeySeed);
const newKeyPair = nacl.sign.keyPair.fromSeed(privateNewKeySeed);

// Export 64-byte private key
export const SERVER_PRIVATE_KEY = keyPair.secretKey;
// Optionally export public key
export const SERVER_PUBLIC_KEY = BigInt('0x' + Buffer.from(keyPair.publicKey).toString('hex'));
export const NEW_SERVER_PRIVATE_KEY = newKeyPair.secretKey;
// Optionally export public key
export const NEW_SERVER_PUBLIC_KEY = BigInt('0x' + Buffer.from(newKeyPair.publicKey).toString('hex'));
