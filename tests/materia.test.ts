import "@ton-community/test-utils";
import {Blockchain, internal, SandboxContract, TreasuryContract} from "@ton-community/sandbox";
import {
    fwd_fee,
    gas_consumption, INIT_MAT_FOR_TON,
    jettonContentToCell,
    jettonTxIdsToCell,
    MateriaMinter, min_tons_for_storage, PRICE_MULTIPLIER, TAX_VALUE
} from "../wrappers/MateriaMinter";
import {Address, beginCell, Cell, fromNano, toNano} from "ton-core";
import {compile} from "@ton-community/blueprint";
import {MateriaWallet} from "../wrappers/MateriaWallet";
import {Errors, Op} from "../wrappers/MateriaConstants";
import {randomAddress} from "@ton-community/test-utils";
import {SERVER_PUBLIC_KEY} from "../constants/MateriaKeys";
import Decimal from "decimal.js";

export const equalMateria = (init: bigint, end: bigint, ton: bigint, price: Decimal) => {
    const resMateria: Decimal = new Decimal(fromNano(ton)).div(price)
    const diff = new Decimal("0.00001").mul(resMateria);
    const minMateria = resMateria.minus(diff);
    const maxMateria = resMateria.plus(diff);
    const realMateria = new Decimal(fromNano(toNano(end) - toNano(init)));
    const res = realMateria > minMateria && realMateria < maxMateria;
    expect(res).toBeTruthy();
}

describe("Materia test", () => {
    let wallet_code = new Cell();
    let minter_code = new Cell();
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let notDeployer: SandboxContract<TreasuryContract>;
    let materiaMinter: SandboxContract<MateriaMinter>;
    let getUserWallet: any;
    let pubkey: bigint;
    let content: Cell;
    let txIds: Cell;
    const forward_ton_amount = toNano('0.05');
    const total_ton_amount = toNano('1');
    const totalSuply: number = 0;

    beforeAll(async () => {
        wallet_code = await compile("MateriaWallet");
        minter_code = await compile("MateriaMinter");
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        notDeployer = await blockchain.treasury('notDeployer');
        content = jettonContentToCell({type: 1, uri: "https://testjetton.org/content.json"});
        pubkey = 0n;
        txIds = jettonTxIdsToCell([])
        const admin = deployer.address
        materiaMinter = blockchain.openContract(MateriaMinter.createFromConfig({
            totalSuply,
            admin,
            pubkey,
            content,
            wallet_code,
            txIds
        }, minter_code));
        getUserWallet = async (address: Address) => blockchain.openContract(
            MateriaWallet.createFromAddress(
                await materiaMinter.getWalletAddress(address)
            )
        );
    })

    it('should deploy and mint correct amount to owner', async () => {
        const initTonAmount = toNano('100');
        // 💥 deploy contract with 100 TON
        const deployResult = await materiaMinter.sendDeploy(
            deployer.getSender(),
            initTonAmount,
            SERVER_PUBLIC_KEY
        );

        // ✅ check deployment transaction
        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: materiaMinter.address,
            value: initTonAmount,
            deploy: true
        });

        let initialTotalSupply = await materiaMinter.getTotalSupply();
        const deployerMateriaWallet = await getUserWallet(deployer.address);
        const balance = await materiaMinter.getBalance();
        expect(await materiaMinter.getInitialSupplyCorrect(initTonAmount)).toBeTruthy();
        const price = await materiaMinter.getCurrentPriceDecimal();
        expect(price).toEqual(
            new Decimal(balance.toString()).div(initialTotalSupply.toString()).toDecimalPlaces(9)
        );
        expect(await deployerMateriaWallet.getMateriaBalance()).toEqual(initTonAmount * INIT_MAT_FOR_TON)
    });



})


