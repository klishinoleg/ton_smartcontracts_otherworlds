import {readFileSync} from 'fs';
import {join} from 'path';

// Load public and private keys from binary files
const privateKeyBytes = readFileSync(join(__dirname, 'key.pk'));
const publicKeyBytes = readFileSync(join(__dirname, 'key.pub'));

// Convert to BigInt for TVM-compatible format
export const SERVER_PRIVATE_KEY = BigInt('0x' + privateKeyBytes.toString('hex'));
export const SERVER_PUBLIC_KEY = BigInt('0x' + publicKeyBytes.toString('hex'));
