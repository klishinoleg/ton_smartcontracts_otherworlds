import "@ton-community/test-utils";
import {Blockchain, internal, SandboxContract, TreasuryContract} from "@ton-community/sandbox";
import {
    INIT_MAT_FOR_TON, jettonContentToCell, MateriaMinter, PRICE_MULTIPLIER, TAX_VALUE
} from "../wrappers/MateriaMinter";
import {Address, beginCell, Cell, fromNano, toNano} from "ton-core";
import {compile, sleep} from "@ton-community/blueprint";
import {MateriaWallet} from "../wrappers/MateriaWallet";
import {Errors, Op} from "../wrappers/MateriaConstants";
import {randomAddress} from "@ton-community/test-utils";
import {NEW_SERVER_PRIVATE_KEY, NEW_SERVER_PUBLIC_KEY, SERVER_PUBLIC_KEY} from "../constants/MateriaKeys";
import Decimal from "decimal.js";
import {createMintFromGameSignature} from "../helpers/createMintFromGameSignature";
import {Event} from "@ton-community/sandbox";
import {createExperienceSignature} from "../helpers/createExperienceSignature";

export const equalMateria = (init: bigint, end: bigint, ton: bigint, price: Decimal) => {
    const resMateria: Decimal = new Decimal(fromNano(ton)).div(price)
    const diff = new Decimal("0.000015").mul(resMateria);
    const minMateria = resMateria.minus(diff);
    const maxMateria = resMateria.plus(diff);
    const realMateria = new Decimal(fromNano(toNano(end) - toNano(init)));
    const res = realMateria > minMateria && realMateria < maxMateria;
    expect(res).toBeTruthy();
}

export const equalTon = (value1: Decimal | null, value2: Decimal) => {
    const diff = new Decimal("0.0002").mul(value2);
    const minTon = value2.minus(diff);
    const maxTon = value2.plus(diff);
    const res = value1 !== null && value1 > minTon && value1 < maxTon;
    expect(res).toBeTruthy();
}

export const equalEventValue = (value: Decimal, events: Event[], from: Address, to: Address) => {
    const event = events.find(e => e.type === 'message_sent'
        && e.from.toString() === from.toString() && e.to.toString() === to.toString());
    const eventValue: Decimal | null = event?.type === 'message_sent' ? new Decimal(fromNano(event.value)) : null;
    equalTon(eventValue, value);
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
    const totalSuply: number = 0;

    beforeAll(async () => {
        wallet_code = await compile("MateriaWallet");
        minter_code = await compile("MateriaMinter");
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        notDeployer = await blockchain.treasury('notDeployer');
        content = jettonContentToCell({type: 1, uri: "https://testjetton.org/content.json"});
        pubkey = 0n;
        const admin = deployer.address
        materiaMinter = blockchain.openContract(MateriaMinter.createFromConfig({
            totalSuply,
            admin,
            pubkey,
            content,
            wallet_code
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
            new Decimal(fromNano(balance)).div(initialTotalSupply.toString()).toDecimalPlaces(9)
        );
        const initialMateriaBalance = await deployerMateriaWallet.getMateriaBalance();
        expect(initialMateriaBalance).toEqual(initTonAmount / 1_000_000_000n * INIT_MAT_FOR_TON)
    });

    it('any user can mint manteria for wallet', async () => {
        const notDeployerMateriaWallet = await getUserWallet(notDeployer.address);
        const deployerMateriaWallet = await getUserWallet(deployer.address);
        const deployerStartBalance = await deployer.getBalance();
        const initialTotalSupply = await materiaMinter.getTotalSupply();
        const initalBalance: bigint = await materiaMinter.getBalance();
        const initialDeployerData = await deployerMateriaWallet.getMateriaBalance();
        const initialNotDeployerData = await notDeployerMateriaWallet.getMateriaBalance();
        let tonAmountForBuyMateria = toNano("1000");
        const price = await materiaMinter.getCurrentPriceDecimal();
        const buyPrice = price.mul(new Decimal(PRICE_MULTIPLIER.toString())).div(100);
        const mintResult = await materiaMinter.sendMintMessage(notDeployer.getSender(), tonAmountForBuyMateria);
        // deploy wallet
        expect(mintResult.transactions.length).toEqual(4)
        expect(mintResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: materiaMinter.address,
            value: tonAmountForBuyMateria
        })
        expect(mintResult.transactions).toHaveTransaction({
            from: materiaMinter.address,
            to: notDeployerMateriaWallet.address
        })
        expect(mintResult.transactions).toHaveTransaction({
            from: materiaMinter.address,
            to: deployer.address,
            value: tonAmountForBuyMateria * TAX_VALUE / 100n
        })

        const endTotalSupply = await materiaMinter.getTotalSupply();
        const endBalance: bigint = await materiaMinter.getBalance();
        const endDeployerData = await deployerMateriaWallet.getMateriaBalance();
        const endNotDeployerData = await notDeployerMateriaWallet.getMateriaBalance();
        expect(await deployer.getBalance() - deployerStartBalance).toBeGreaterThan(tonAmountForBuyMateria * TAX_VALUE / 100n - toNano("0.001"));
        expect(endBalance - initalBalance).toBeGreaterThan(tonAmountForBuyMateria * (100n - TAX_VALUE) / 100n - toNano("0.05"));
        expect(initialDeployerData).toEqual(endDeployerData)
        equalMateria(initialNotDeployerData, endNotDeployerData, tonAmountForBuyMateria, buyPrice);
        equalMateria(initialTotalSupply, endTotalSupply, tonAmountForBuyMateria, buyPrice);
    })

    it('mint materia from game by signed transaction', async () => {
        const sender = notDeployer.address;
        const jettonAmount = 1_000_000n
        const txId = Math.floor(Math.random() * 1000000);
        const timestamp = BigInt(Math.floor(Date.now() / 1000));
        const initialTotalSupply = await materiaMinter.getTotalSupply();
        const wallet = await getUserWallet(sender);
        const initialBalance = await wallet.getMateriaBalance();
        const signature = createMintFromGameSignature({
            sender,
            jettonAmount,
            txId: BigInt(txId),
            timestamp
        });
        const result = await materiaMinter.sendMintFromGameMessage(
            notDeployer.getSender(), signature, jettonAmount, txId, timestamp);
        expect(result.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: materiaMinter.address,
            success: true
        });
        expect(result.transactions).toHaveTransaction({
            from: materiaMinter.address,
            to: wallet.address,
            success: true
        });
        const updatedTotalSupply = await materiaMinter.getTotalSupply();
        const updatedBalance = await wallet.getMateriaBalance();
        expect(updatedTotalSupply).toEqual(initialTotalSupply + jettonAmount);
        expect(updatedBalance).toEqual(initialBalance + jettonAmount);
        const resultTxError = await materiaMinter.sendMintFromGameMessage(
            notDeployer.getSender(), signature, jettonAmount, txId, timestamp);
        expect(resultTxError.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: materiaMinter.address,
            success: false,
            exitCode: Errors.tx_id_already_used
        });
        const resultSignError = await materiaMinter.sendMintFromGameMessage(
            notDeployer.getSender(), signature, jettonAmount, txId + 1, timestamp);
        expect(resultSignError.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: materiaMinter.address,
            success: false,
            exitCode: Errors.invalid_signature
        });

        const signature2 = createMintFromGameSignature({
            sender,
            jettonAmount,
            txId: BigInt(txId) + 1n,
            timestamp: timestamp - 100000n
        });

        const resultExpireError = await materiaMinter.sendMintFromGameMessage(
            notDeployer.getSender(), signature2, jettonAmount, txId + 1, timestamp - 100000n);

        expect(resultExpireError.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: materiaMinter.address,
            success: false,
            exitCode: Errors.signature_expired
        });
        const signature3 = createMintFromGameSignature({
            sender,
            jettonAmount,
            txId: BigInt(txId + 1),
            timestamp
        });
        const result2 = await materiaMinter.sendMintFromGameMessage(
            notDeployer.getSender(), signature3, jettonAmount, txId + 1, timestamp);
        expect(result2.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: materiaMinter.address,
            success: true
        });
        console.log(await materiaMinter.getDictKeys());
    });

    it("updates pubkey and verifies signature accordingly", async () => {
        const changePubkeyResult = await materiaMinter.sendChangePubkeyMessage(
            deployer.getSender(), NEW_SERVER_PUBLIC_KEY
        );
        expect(changePubkeyResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: materiaMinter.address,
            success: true
        })
        const notDeployerChangePubkeyResult = await materiaMinter.sendChangePubkeyMessage(
            notDeployer.getSender(), NEW_SERVER_PUBLIC_KEY
        )
        expect(notDeployerChangePubkeyResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: materiaMinter.address,
            success: false,
            exitCode: Errors.access_denied
        })
        const sender = notDeployer.address;
        const jettonAmount = 1_000_000n;
        const txId = Math.floor(Math.random() * 1000000);
        const timestamp = BigInt(Math.floor(Date.now() / 1000));
        const signature = createMintFromGameSignature({
            sender,
            jettonAmount,
            txId: BigInt(txId),
            timestamp
        });
        const oldPrivateKeyResult = await materiaMinter.sendMintFromGameMessage(
            notDeployer.getSender(), signature, jettonAmount, txId, timestamp);
        expect(oldPrivateKeyResult.transactions).toHaveTransaction({
            from: sender,
            to: materiaMinter.address,
            success: false,
            exitCode: Errors.invalid_signature
        });
        const newSignature = createMintFromGameSignature({
            sender,
            jettonAmount,
            txId: BigInt(txId),
            timestamp
        }, NEW_SERVER_PRIVATE_KEY);
        const newPrivateKeyResult = await materiaMinter.sendMintFromGameMessage(
            notDeployer.getSender(), newSignature, jettonAmount, txId, timestamp);
        expect(newPrivateKeyResult.transactions).toHaveTransaction({
            from: sender,
            to: materiaMinter.address,
            success: true
        });
    })
    it("change materia to ton", async () => {
        const initialMinterMateria = await materiaMinter.getTotalSupply();
        const initialMinterTon = await materiaMinter.getBalance();
        const wallet = await getUserWallet(notDeployer.address);
        const initialWalletMateria = await wallet.getMateriaBalance();
        const initialWalletTon = await notDeployer.getBalance();
        const price = await materiaMinter.getCurrentPriceDecimal();
        const changeAmount = 50_000_000n;
        const badAmount = 100_000n;
        const changeResult = await materiaMinter.sendMateriaToTon(notDeployer.getSender(), changeAmount);
        expect(changeResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: materiaMinter.address,
            success: true
        })
        const tonAmount = new Decimal(changeAmount.toString()).mul(price);
        equalEventValue(tonAmount, changeResult.events, materiaMinter.address, notDeployer.address);
        const endMinterMateria = await materiaMinter.getTotalSupply();
        const endMinterTon = await materiaMinter.getBalance();
        const endWalletMateria = await wallet.getMateriaBalance();
        const endWalletTon = await notDeployer.getBalance();
        expect(endMinterMateria + changeAmount).toEqual(initialMinterMateria);
        expect(endWalletMateria + changeAmount).toEqual(initialWalletMateria);
        equalTon(new Decimal(fromNano(initialMinterTon)).minus(tonAmount), new Decimal(fromNano(endMinterTon)));
        equalTon(new Decimal(fromNano(initialWalletTon)).plus(tonAmount), new Decimal(fromNano(endWalletTon)));
        const badAmountResult = await materiaMinter.sendMateriaToTon(notDeployer.getSender(), badAmount);
        expect(badAmountResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: materiaMinter.address,
            success: false,
            exitCode: Errors.exchange_too_small
        })
    })

    it("send experience message", async () => {
        const wallet = await getUserWallet(notDeployer.address);
        const experience: bigint = 15678n;
        const timestamp: bigint = BigInt(Math.floor(Date.now() / 1000));
        const signature: Buffer = createExperienceSignature({sender: notDeployer.address, experience, timestamp}, NEW_SERVER_PRIVATE_KEY);
        const res = await materiaMinter
            .sendReceiveExperienceMessage(notDeployer.getSender(), signature, experience, timestamp);
        expect(res.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: materiaMinter.address,
            success: true
        })
        expect(res.transactions).toHaveTransaction({
            from: materiaMinter.address,
            to: wallet.address,
            success: true
        })
        expect(await wallet.getExperience()).toEqual(experience);
    })
})