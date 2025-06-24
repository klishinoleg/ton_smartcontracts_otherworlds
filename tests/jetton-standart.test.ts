import "@ton-community/test-utils";
import {Blockchain, internal, SandboxContract, TreasuryContract} from "@ton-community/sandbox";
import {
    fwd_fee,
    gas_consumption, INIT_MAT_FOR_TON,
    jettonContentToCell,
    MateriaMinter, min_tons_for_storage, PRICE_MULTIPLIER, TAX_VALUE
} from "../wrappers/MateriaMinter";
import {Address, beginCell, Cell, fromNano, toNano} from "ton-core";
import {compile} from "@ton-community/blueprint";
import {MateriaWallet} from "../wrappers/MateriaWallet";
import {Errors, Op} from "../wrappers/MateriaConstants";
import {randomAddress} from "@ton-community/test-utils";
import {SERVER_PUBLIC_KEY} from "../constants/MateriaKeys";
import Decimal from "decimal.js";
import {equalMateria} from "./materia.test";

describe("Standart jetton test", () => {
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
        const initTonAmount = toNano('100000');
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
        let tonAmountForBuyMateria = toNano("100000");
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


    it('minter admin can change admin', async () => {
        const adminBefore = await materiaMinter.getAdminAddress();
        expect(adminBefore).toEqualAddress(deployer.address);
        let res = await materiaMinter.sendChangeAdminMessage(deployer.getSender(), notDeployer.address);
        expect(res.transactions).toHaveTransaction({
            from: deployer.address,
            on: materiaMinter.address,
            success: true
        })
        const adminAfter = await materiaMinter.getAdminAddress();
        expect(adminAfter).toEqualAddress(notDeployer.address);
        await materiaMinter.sendChangeAdminMessage(notDeployer.getSender(), deployer.address);
        expect((await materiaMinter.getAdminAddress()).equals(deployer.address)).toBe(true);
    })

    it('not a minter admin can not change admin', async () => {
        const adminBefore = await materiaMinter.getAdminAddress();
        expect(adminBefore).toEqualAddress(deployer.address);
        let changeAdmin = await materiaMinter.sendChangeAdminMessage(notDeployer.getSender(), notDeployer.address);
        expect((await materiaMinter.getAdminAddress()).equals(deployer.address)).toBe(true);
        expect(changeAdmin.transactions).toHaveTransaction({
            from: notDeployer.address,
            on: materiaMinter.address,
            aborted: true
        });
    })

    it('wallet owner should be able to send jettons', async () => {
        const deployerMateriaWallet = await getUserWallet(deployer.address);
        let initialMaterialBalance = await deployerMateriaWallet.getMateriaBalance();
        let initalTotalSupply = await materiaMinter.getTotalSupply();
        const notDeployerMaterialWallet = await getUserWallet(notDeployer.address);
        let initalMaterialBalance2 = await notDeployerMaterialWallet.getMateriaBalance();
        let sentAmount = toNano('0.5');
        let forwardAmount = toNano('0.01');
        const sendResult = await deployerMateriaWallet.sendTransfer(deployer.getSender(), toNano('0.1'), sentAmount, notDeployer.address, deployer.address, null, forwardAmount, null);
        expect(sendResult.transactions).toHaveTransaction(
            {
                from: notDeployerMaterialWallet.address,
                to: deployer.address
            }
        )
        expect(sendResult.transactions).toHaveTransaction({
            from: notDeployerMaterialWallet.address,
            to: notDeployer.address,
            value: forwardAmount
        })
        expect(await deployerMateriaWallet.getMateriaBalance()).toEqual(initialMaterialBalance - sentAmount)
        expect(await notDeployerMaterialWallet.getMateriaBalance()).toEqual(initalMaterialBalance2 + sentAmount)
        expect(await materiaMinter.getTotalSupply()).toEqual(initalTotalSupply)
    })

    it('not wallet owner should not be able to send jettons', async () => {
        const deployerMateriaWallet = await getUserWallet(deployer.address);
        let initialMateriaBalance = await deployerMateriaWallet.getMateriaBalance();
        let initialTotalSupply = await materiaMinter.getTotalSupply();
        const notDeployerMaterialWallet = await getUserWallet(notDeployer.address);
        let initalMateriaBalance2 = await notDeployerMaterialWallet.getMateriaBalance();
        let sentAmount = toNano('0.5');
        const sendResult = await deployerMateriaWallet.sendTransfer(notDeployer.getSender(), total_ton_amount,
            sentAmount,
            notDeployer.address,
            deployer.address,
            null,
            forward_ton_amount,
            null
        )
        expect(sendResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: deployerMateriaWallet.address,
            aborted: true,
            exitCode: Errors.not_owner
        });
        expect(await deployerMateriaWallet.getMateriaBalance()).toEqual(initialMateriaBalance);
        expect(await notDeployerMaterialWallet.getMateriaBalance()).toEqual(initalMateriaBalance2);
        expect(await materiaMinter.getTotalSupply()).toEqual(initialTotalSupply);
    })

    it('impossible to send too much jettons', async () => {
        const deployerMateriaWallet = await getUserWallet(deployer.address);
        let initialTotalSupply = await materiaMinter.getTotalSupply();
        let initialMateriaBalance = await deployerMateriaWallet.getMateriaBalance();
        const notDeployerMaterialWallet = await getUserWallet(notDeployer.address);
        let initalMateriaBalance2 = await notDeployerMaterialWallet.getMateriaBalance();
        let sentAmount = initialMateriaBalance + 1n;
        const sendResult = await deployerMateriaWallet.sendTransfer(deployer.getSender(), total_ton_amount,
            sentAmount,
            notDeployer.address,
            deployer.address,
            null,
            forward_ton_amount,
            null
        )
        expect(sendResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: deployerMateriaWallet.address,
            aborted: true,
            exitCode: Errors.balance_error
        });
        expect(await deployerMateriaWallet.getMateriaBalance()).toEqual(initialMateriaBalance);
        expect(await notDeployerMaterialWallet.getMateriaBalance()).toEqual(initalMateriaBalance2);
        expect(await materiaMinter.getTotalSupply()).toEqual(initialTotalSupply);
    })

    it('correctly sends forward_payload', async () => {
        const deployerMateriaWallet = await getUserWallet(deployer.address);
        let initialMaterialBalance = await deployerMateriaWallet.getMateriaBalance();
        const notDeployerMaterialWallet = await getUserWallet(notDeployer.address);
        let initalMaterialBalance2 = await notDeployerMaterialWallet.getMateriaBalance();
        let sentAmount = toNano('0.5');
        let forwardPayload = beginCell().storeUint(0x1234567890abcdefn, 128).endCell();
        const sendResult = await deployerMateriaWallet.sendTransfer(deployer.getSender(), total_ton_amount, sentAmount,
            notDeployer.address, deployer.address, null, forward_ton_amount, forwardPayload)
        expect(sendResult.transactions).toHaveTransaction(
            {
                from: notDeployerMaterialWallet.address,
                to: deployer.address
            }
        )
        expect(sendResult.transactions).toHaveTransaction({
            from: notDeployerMaterialWallet.address,
            to: notDeployer.address,
            value: forward_ton_amount,
            body: beginCell()
                .storeUint(Op.transfer_notification, 32)
                .storeUint(0, 64)
                .storeCoins(sentAmount)
                .storeAddress(deployer.address)
                .storeUint(1, 1)
                .storeRef(forwardPayload)
                .endCell()
        })
        expect(await deployerMateriaWallet.getMateriaBalance()).toEqual(initialMaterialBalance - sentAmount);
        expect(await notDeployerMaterialWallet.getMateriaBalance()).toEqual(initalMaterialBalance2 + sentAmount);
    })

    it('no forward_ton_amount - no forward', async () => {
        const deployerMateriaWallet = await getUserWallet(deployer.address);
        let initialMaterialBalance = await deployerMateriaWallet.getMateriaBalance();
        const notDeployerMaterialWallet = await getUserWallet(notDeployer.address);
        let initalMaterialBalance2 = await notDeployerMaterialWallet.getMateriaBalance();
        let sentAmount = toNano('0.5');
        let forwardAmount = 0n;
        let forwardPayload = beginCell().storeUint(0x1234567890abcdefn, 128).endCell();
        const sendResult = await deployerMateriaWallet.sendTransfer(deployer.getSender(), total_ton_amount, sentAmount,
            notDeployer.address, deployer.address, null, forwardAmount, forwardPayload);
        expect(sendResult.transactions).toHaveTransaction({
            from: notDeployerMaterialWallet.address,
            to: deployer.address
        });
        expect(sendResult.transactions).not.toHaveTransaction({
            from: notDeployerMaterialWallet.address,
            to: notDeployer.address
        });
        expect(await deployerMateriaWallet.getMateriaBalance()).toEqual(initialMaterialBalance - sentAmount);
        expect(await notDeployerMaterialWallet.getMateriaBalance()).toEqual(initalMaterialBalance2 + sentAmount);
    })

    it('check revert on not enough tons for forward', async () => {
        const deployerMateriaWallet = await getUserWallet(deployer.address);
        let initialMaterialBalance = await deployerMateriaWallet.getMateriaBalance();
        await deployer.send({value: toNano('1'), bounce: false, to: deployerMateriaWallet.address});
        let sentAmount = toNano('0.1');
        let forwardAmount = toNano('0.3');
        let forwardPayload = beginCell().storeUint(0x1234567890abcdefn, 128).endCell();
        const sendResult = await deployerMateriaWallet.sendTransfer(deployer.getSender(), forwardAmount, sentAmount,
            notDeployer.address, deployer.address, null, forwardAmount, forwardPayload);
        expect(sendResult.transactions).toHaveTransaction({
            from: deployer.address,
            on: deployerMateriaWallet.address,
            aborted: true,
            exitCode: Errors.not_enough_ton
        });
        expect(sendResult.transactions).toHaveTransaction({
            from: deployerMateriaWallet.address,
            on: deployer.address,
            inMessageBounced: true,
            success: true
        });
        expect(await deployerMateriaWallet.getMateriaBalance()).toEqual(initialMaterialBalance);
    })

    it('works with minimal ton amount', async () => {
        const deployerMateriaWallet = await getUserWallet(deployer.address);
        let initialMaterialBalance = await deployerMateriaWallet.getMateriaBalance();
        const someAddress = Address.parse("EQD__________________________________________0vo");
        const someMateriaWallet = await getUserWallet(someAddress);
        let initialMaterialBalance2 = await someMateriaWallet.getMateriaBalance();
        await deployer.send({value: toNano('1'), bounce: false, to: deployerMateriaWallet.address});
        let forwardAmount = toNano('0.3');
        let minimalFee = 2n * fwd_fee + 2n * gas_consumption + min_tons_for_storage;
        let sentAmount = forwardAmount + minimalFee; // not enough, need >
        let forwardPaylod = null;
        let tonBalance = (await blockchain.getContract(deployerMateriaWallet.address)).balance;
        let tonBalance2 = (await blockchain.getContract(someMateriaWallet.address)).balance;
        let sendResult = await deployerMateriaWallet.sendTransfer(deployer.getSender(), sentAmount, sentAmount, someAddress, deployer.address, null, forwardAmount, forwardPaylod);
        expect(sendResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: deployerMateriaWallet.address,
            aborted: true,
            exitCode: Errors.not_enough_ton
        })
        sentAmount += 1n;
        sendResult = await deployerMateriaWallet.sendTransfer(deployer.getSender(), sentAmount, sentAmount, someAddress, deployer.address, null, forwardAmount, forwardPaylod);
        expect(sendResult.transactions).not.toHaveTransaction({
            from: someMateriaWallet.address,
            to: deployer.address
        })
        expect(sendResult.transactions).toHaveTransaction({
            from: someMateriaWallet.address,
            to: someAddress,
            value: forwardAmount,
            body: beginCell()
                .storeUint(Op.transfer_notification, 32)
                .storeUint(0, 64)
                .storeCoins(sentAmount)
                .storeAddress(deployer.address)
                .storeUint(0, 1)
                .endCell()
        })
        expect(await deployerMateriaWallet.getMateriaBalance()).toEqual(initialMaterialBalance - sentAmount);
        expect(await someMateriaWallet.getMateriaBalance()).toEqual(initialMaterialBalance2 + sentAmount);

        tonBalance = (await blockchain.getContract(deployerMateriaWallet.address)).balance;
        expect((await blockchain.getContract(someMateriaWallet.address)).balance).toBeGreaterThan(min_tons_for_storage);
    })

    it('wallet does not accept internal_transfer not from wallet', async () => {
        const deployerMateriaWallet = await getUserWallet(deployer.address);
        let initialMateriaBalance = await deployerMateriaWallet.getMateriaBalance();
        let internalTransfer = beginCell()
            .storeUint(0x178d4519, 32)
            .storeUint(0, 64)
            .storeCoins(toNano('0.01'))
            .storeAddress(deployer.address)
            .storeAddress(deployer.address)
            .storeCoins(toNano('0.05'))
            .storeUint(0, 1)
            .endCell();
        const sendResult = await blockchain.sendMessage(internal({
            from: notDeployer.address,
            to: deployerMateriaWallet.address,
            body: internalTransfer,
            value: toNano('0.3')
        }));
        expect(sendResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: deployerMateriaWallet.address,
            aborted: true,
            exitCode: Errors.not_valid_wallet
        });
        expect(await deployerMateriaWallet.getMateriaBalance()).toEqual(initialMateriaBalance);
    })

    it('wallet owner should be able to burn jettons', async () => {
        const deployerMateriaWallet = await getUserWallet(deployer.address);
        let initialMateriaBalance = await deployerMateriaWallet.getMateriaBalance();
        let initialTotalSupply = await materiaMinter.getTotalSupply();
        let burnAmount = toNano('0.01');
        const sendResult = await deployerMateriaWallet.sendBurn(deployer.getSender(), total_ton_amount, burnAmount, deployer.address, null);
        expect(sendResult.transactions).toHaveTransaction({ //burn notification
            from: deployerMateriaWallet.address,
            to: materiaMinter.address
        });
        expect(sendResult.transactions).toHaveTransaction({  //excesses
            from: materiaMinter.address,
            to: deployer.address
        })
        expect(await deployerMateriaWallet.getMateriaBalance()).toEqual(initialMateriaBalance - burnAmount);
        expect(await materiaMinter.getTotalSupply()).toEqual(initialTotalSupply - burnAmount);
    })

    it('not wallet owner should not be able to burn jettons', async () => {
        const deployerMateriaWallet = await getUserWallet(deployer.address);
        let initialMateriaBalance = await deployerMateriaWallet.getMateriaBalance();
        let initialTotalSupply = await materiaMinter.getTotalSupply();
        let burnAmount = toNano('0.01');
        const sendResult = await deployerMateriaWallet.sendBurn(notDeployer.getSender(), total_ton_amount, burnAmount, deployer.address, null);
        expect(sendResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: deployerMateriaWallet.address,
            aborted: true,
            exitCode: Errors.not_owner
        })
        expect(await deployerMateriaWallet.getMateriaBalance()).toEqual(initialMateriaBalance);
        expect(await materiaMinter.getTotalSupply()).toEqual(initialTotalSupply);
    })

    it('wallet owner can not burn more jettons than it has', async () => {
        const deployerMateriaWallet = await getUserWallet(deployer.address);
        let initialMateriaBalance = await deployerMateriaWallet.getMateriaBalance();
        let initialTotalSupply = await materiaMinter.getTotalSupply();
        let burnAmount = initialMateriaBalance + 1n;
        const sendResult = await deployerMateriaWallet.sendBurn(deployer.getSender(), total_ton_amount, burnAmount, deployer.address, null);
        expect(sendResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: deployerMateriaWallet.address,
            aborted: true,
            exitCode: Errors.balance_error
        })
        expect(await deployerMateriaWallet.getMateriaBalance()).toEqual(initialMateriaBalance);
        expect(await materiaMinter.getTotalSupply()).toEqual(initialTotalSupply);
    })

    it('minimal burn message fee', async () => {
        const deployerMateriaWallet = await getUserWallet(deployer.address);
        let initialMateriaBalance = await deployerMateriaWallet.getMateriaBalance();
        let initialTotalSupply = await materiaMinter.getTotalSupply();
        let burnAmount = toNano('0.01');
        let fwd_fee = 1492012n, gas_consumption = 15000000n;
        let minimalFee = fwd_fee + 2n * gas_consumption;
        const sendLow = await deployerMateriaWallet.sendBurn(deployer.getSender(), minimalFee, burnAmount, deployer.address, null);
        expect(sendLow.transactions).toHaveTransaction({
            from: deployer.address,
            to: deployerMateriaWallet.address,
            aborted: true,
            exitCode: Errors.not_enough_gas
        })
        const sendExcess = await deployerMateriaWallet.sendBurn(deployer.getSender(), minimalFee + 1n, burnAmount, deployer.address, null);
        expect(sendExcess.transactions).toHaveTransaction({
            from: deployer.address,
            to: deployerMateriaWallet.address,
            success: true
        })
        expect(await deployerMateriaWallet.getMateriaBalance()).toEqual(initialMateriaBalance - burnAmount);
        expect(await materiaMinter.getTotalSupply()).toEqual(initialTotalSupply - burnAmount)
    })

    it('minter should only accept burn messages from jetton wallets', async () => {
        const deployerMateriaWallet = await getUserWallet(deployer.address);
        let burnAmount = toNano("1");
        const burnNotification = (amount: bigint, addr: Address, tonAmount: bigint = 0n) => {
            return beginCell()
                .storeUint(Op.burn_notification, 32)
                .storeUint(0, 64)
                .storeCoins(amount)
                .storeAddress(addr)
                .storeAddress(deployer.address)
                .storeCoins(tonAmount)
                .endCell();
        }
        let res = await blockchain.sendMessage(internal({
            from: deployerMateriaWallet.address,
            to: materiaMinter.address,
            body: burnNotification(burnAmount, randomAddress(0)),
            value: toNano('0.1')
        }))

        expect(res.transactions).toHaveTransaction({
            from: deployerMateriaWallet.address,
            to: materiaMinter.address,
            aborted: true,
            exitCode: Errors.unouthorized_burn
        })

        res = await blockchain.sendMessage(internal({
            from: deployerMateriaWallet.address,
            to: materiaMinter.address,
            body: burnNotification(burnAmount, deployer.address),
            value: toNano('0.1')
        }))

        expect(res.transactions).toHaveTransaction({
            from: deployerMateriaWallet.address,
            to: materiaMinter.address,
            success: true
        })

        res = await blockchain.sendMessage(internal({
            from: deployer.address,
            to: materiaMinter.address,
            body: burnNotification(burnAmount, deployer.address, toNano("100")),
            value: toNano('0.1')
        }))
        expect(res.transactions).toHaveTransaction({
            from: deployer.address,
            to: materiaMinter.address,
            success: false,
            exitCode: Errors.invalid_sender
        })
    })

    it('report correct discovery address', async () => {
        let discoveryResult = await materiaMinter.sendDiscoveryMessage(deployer.getSender(), deployer.address, true);
        const deployerMateriaWallet = await getUserWallet(deployer.address);
        expect(discoveryResult.transactions).toHaveTransaction({
            from: materiaMinter.address,
            to: deployer.address,
            body: beginCell()
                .storeUint(Op.take_wallet_address, 32)
                .storeUint(0, 64)
                .storeAddress(deployerMateriaWallet.address)
                .storeUint(1, 1)
                .storeRef(beginCell().storeAddress(deployer.address).endCell())
                .endCell()
        })
        discoveryResult = await materiaMinter.sendDiscoveryMessage(deployer.getSender(), notDeployer.address, true);
        const notDeployerMateteriaWallet = await getUserWallet(notDeployer.address);
        expect(discoveryResult.transactions).toHaveTransaction({
            from: materiaMinter.address,
            to: deployer.address,
            body: beginCell()
                .storeUint(Op.take_wallet_address, 32)
                .storeUint(0, 64)
                .storeAddress(notDeployerMateteriaWallet.address)
                .storeUint(1, 1)
                .storeRef(beginCell().storeAddress(notDeployer.address).endCell())
                .endCell()
        })
        discoveryResult = await materiaMinter.sendDiscoveryMessage(deployer.getSender(), notDeployer.address, false);
        expect(discoveryResult.transactions).toHaveTransaction({
            from: materiaMinter.address,
            to: deployer.address,
            body: beginCell()
                .storeUint(Op.take_wallet_address, 32)
                .storeUint(0, 64)
                .storeAddress(notDeployerMateteriaWallet.address)
                .storeUint(0, 1)
                .endCell()
        })
    })

    it('minimal discovery fee', async () => {
        const fwdFee = 1464012n;
        const minimalFee = fwdFee + 10000000n;
        let discoveryResult = await materiaMinter.sendDiscoveryMessage(deployer.getSender(), notDeployer.address, false, minimalFee);

        expect(discoveryResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: materiaMinter.address,
            aborted: true,
            exitCode: Errors.discovery_fee_not_matched
        })

        discoveryResult = await materiaMinter.sendDiscoveryMessage(deployer.getSender(), notDeployer.address, false, minimalFee + 1n);


        expect(discoveryResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: materiaMinter.address,
            success: true
        })
    })

    it('correctly handles not valid address in discovery', async () => {
        const badAddr = randomAddress(-1);
        let discoveryResult = await materiaMinter.sendDiscoveryMessage(deployer.getSender(), badAddr, false);
        expect(discoveryResult.transactions).toHaveTransaction({
            from: materiaMinter.address,
            to: deployer.address,
            body: beginCell()
                .storeUint(Op.take_wallet_address, 32)
                .storeUint(0, 64)
                .storeUint(0, 2)
                .storeUint(0, 1)
                .endCell()
        })
        // Include address should still be available
        discoveryResult = await materiaMinter.sendDiscoveryMessage(deployer.getSender(), badAddr, true);
        expect(discoveryResult.transactions).toHaveTransaction({
            from: materiaMinter.address,
            to: deployer.address,
            body: beginCell()
                .storeUint(Op.take_wallet_address, 32)
                .storeUint(0, 64)
                .storeUint(0, 2)
                .storeUint(1, 1)
                .storeRef(beginCell().storeAddress(badAddr).endCell())
                .endCell()
        })
    })

    it('can not send to masterchain', async () => {
        const deployerMateriaWallet = await getUserWallet(deployer.address);
        let sentAmount = toNano('0.5');
        let forwardAmount = toNano('0.05');
        const sendResult = await deployerMateriaWallet.sendTransfer(
            deployer.getSender(), total_ton_amount, sentAmount,
            Address.parse("Ef8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAU"),
            deployer.address, null, forwardAmount, null
        )
        expect(sendResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: deployerMateriaWallet.address,
            aborted: true,
            exitCode: Errors.wrong_workchain
        })
    })

})


