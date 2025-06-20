import {toNano} from '@ton/core';
import {MateriaWallet} from '../wrappers/MateriaWallet';
import {compile, NetworkProvider} from '@ton-community/blueprint';

export async function run(provider: NetworkProvider) {
    const materiaWallet = MateriaWallet.createFromConfig({}, await compile('MateriaWallet'));

    await provider.deploy(materiaWallet, toNano('0.05'));

    const openedContract = provider.open(materiaWallet);

    // run methods on `openedContract`
}
