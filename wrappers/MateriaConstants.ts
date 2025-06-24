export class Op {
    // Jetton standard
    static transfer = 0xf8a7ea5;
    static transfer_notification = 0x7362d09c;
    static internal_transfer = 0x178d4519;
    static excesses = 0xd53276db;
    static burn = 0x595f07bc;
    static burn_notification = 0x7bdd97de;

    static add_experience = 0x7bdd98de;
    static set_nickname = 0x7bdd9ade;

    // Custom
    static provide_wallet_address = 0x2c76b973;
    static take_wallet_address = 0xd1735400;

    /**
     * Mint tokens (standard jetton)
     * int op::mint () asm "21 PUSHINT";
     */
    static mint = 21;

    /**
     * Update server public key (owner only)
     * int op::update_pubkey () asm "0x01 PUSHINT";
     */
    static update_pubkey = 0x01;

    /**
     * Mint MAT from signed game request
     * int op::mint_from_game () asm "0x02 PUSHINT";
     */
    static mint_from_game = 0x02;

    /**
     * Buy MAT for TON at +35% price
     * int op::buy_mat () asm "0x03 PUSHINT";
     */
    static buy_mat = 0x03;

    /**
     * Deposit TON to the ecosystem bank
     * int op::add_ton_to_bank () asm "0x04 PUSHINT";
     */
    static add_ton_to_bank = 0x04;

    /**
     * Exchange MAT to TON, burn MAT
     * int op::materia_to_ton () asm "0x05 PUSHINT";
     */
    static materia_to_ton = 0x05;

    /**
     * Get current MAT/TON price
     * int op::get_mat_ton_price () asm "0x06 PUSHINT";
     */
    static get_mat_ton_price = 0x06;

    /**
     * Get current TON balance in the bank
     * int op::get_bank_balance () asm "0x07 PUSHINT";
     */
    static get_bank_balance = 0x07;

    /**
     * Proxy for experience update
     * int op::receive_experience () asm "0x08 PUSHINT";
     */
    static receive_experience= 0x08;

    /**
     * Initialize minter and issue initial MAT
     * int op::init_minter () asm "0x09 PUSHINT";
     */
    static init_minter = 0x09;

    /**
     * Change contract admin (custom)
     */
    static change_admin = 3;
}


export class Errors {
    // Legacy / common
    static invalid_op = 709;
    static not_admin = 73;
    static unouthorized_burn = 106;
    static discovery_fee_not_matched = 104;
    static wrong_op = 0xffff;
    static not_owner = 705;
    static not_enough_ton = 709;
    static not_enough_gas = 707;
    static not_valid_wallet = 707;
    static wrong_workchain = 333;
    static balance_error = 706;

    // Minter-specific
    static invalid_signature = 100;
    static signature_expired = 101;
    static invalid_payload = 102;
    static tx_id_already_used = 103;
    static amount_too_low = 104;
    static wallet_creation_failed = 105;
    static invalid_sender = 106;
    static access_denied = 107;
    static zero_ton_transfer = 108;
    static exchange_too_small = 110;
    static creator_not_set = 111;
    static internal_error = 112;
}
