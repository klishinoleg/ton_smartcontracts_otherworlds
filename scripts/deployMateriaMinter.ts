import {Cell, toNano, Address} from 'ton-core';
import {
    MateriaMinter,
    jettonContentToCell,
} from '../wrappers/MateriaMinter';
import {compile, NetworkProvider} from "@ton-community/blueprint";
import {promptAddress, promptBool, promptUrl} from '../wrappers/ui-utils';
import {SERVER_PUBLIC_KEY} from "../constants/MateriaKeys";

const formatUrl = "https://github.com/ton-blockchain/TEPs/blob/master/text/0064-token-data-standard.md#jetton-metadata-example-offchain";
const exampleContent = {
    name: "Sample Jetton",
    description: "Sample of Jetton",
    symbol: "JTN",
    decimals: 0,
    image: "https://www.svgrepo.com/download/483336/coin-vector.svg"
};
export const urlPrompt = 'Please specify url pointing to jetton metadata(json):';

/**
 * Deploys a Materia Jetton Minter smart contract with user-provided parameters.
 * @param {NetworkProvider} provider - The deployment provider from Blueprint
 */
export async function run(provider: NetworkProvider): Promise<void | null> {
    const ui = provider.ui();
    const sender = provider.sender();
    const adminPrompt: string = `Please specify admin address`;

    ui.write(`Jetton deployer\nCurrent deployer only supports off-chain format:\n${formatUrl}`);

    let admin: Address | undefined = sender.address;

    if (!admin) {
        throw "No admin address";
    }
    ui.write(`Admin address: ${admin.toString()}\n`);

    let contentUrl: string = "https://otherworlds.ru/otherworlds.json";
    ui.write(`Jetton content url: ${contentUrl}`);

    const deployAmountInput: string = await ui.input('How much TON to send for deploy? (default = 100)');
    const deployAmount = toNano(deployAmountInput || '100');

    // Confirm metadata and admin address with the user
    let dataCorrect: boolean = false;
    do {
        ui.write("Please verify data:");
        ui.write(`Admin: ${admin.toString()}`);
        ui.write(`Metadata url: ${contentUrl}`);

        dataCorrect = await promptBool('Is everything ok? (y/n)', ['y', 'n'], ui);
        if (!dataCorrect) {
            const choice = await ui.choose(
                'What do you want to update?',
                ['Admin', 'Url'],
                (c) => c
            );

            if (choice === 'Admin') {
                admin = await promptAddress(adminPrompt, ui, sender.address);
            } else {
                contentUrl = await promptUrl(urlPrompt, ui);
            }
        }
    } while (!dataCorrect);

    // Prepare contract parameters
    const content: Cell = jettonContentToCell({type: 1, uri: contentUrl});
    const wallet_code: Cell = await compile('MateriaWallet');
    const totalSuply: number = 0
    const pubkey: bigint = 0n

    const minter = MateriaMinter.createFromConfig(
        {totalSuply, admin, pubkey, content, wallet_code},
        await compile('MateriaMinter')
    );

    // Deploy and wait for confirmation
    const openedContract = provider.open(minter);
    openedContract.sendDeploy(sender, toNano(deployAmount), SERVER_PUBLIC_KEY);
    await provider.waitForDeploy(minter.address);
}
