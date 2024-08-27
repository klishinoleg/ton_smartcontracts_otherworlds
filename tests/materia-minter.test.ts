import "@ton-community/test-utils";
import {Blockchain, SandboxContract, TreasuryContract} from "@ton-community/sandbox";
import {jettonContentToCell, MateriaMinter} from "../wrappers/MateriaMinter";
import {Cell} from "@ton/core";
import {compile} from "@ton/blueprint";
import {MateriaWallet} from "../wrappers/MateriaWallet";
import {urlPrompt} from "../scripts/deployMateriaMinter";

describe("Materia Minter test", () => {
    let blochchain: Blockchain;
    let MateriaMinterContract: SandboxContract<MateriaMinter>;
    let adminWallet: SandboxContract<TreasuryContract>;
    let ownerWallet: SandboxContract<TreasuryContract>;
    let content: Cell;
    let wallet_code: Cell;
    let codeCell: Cell

    beforeAll(async () => {
        codeCell = await compile("MateriaMinter");
        wallet_code = await compile("MateriaWallet");
        content = jettonContentToCell({type: 1, uri: urlPrompt})
    })

    beforeEach(async () => {
        blochchain = await Blockchain.create();
        adminWallet = await blochchain.treasury('adminWallet');
        ownerWallet = await blochchain.treasury('ownerAddress');
        const contract = await MateriaMinter.createFromConfig({admin: adminWallet.address, wallet_code, content}, codeCell);
        MateriaMinterContract = blochchain.openContract(contract);
    })
})