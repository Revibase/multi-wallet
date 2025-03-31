/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/multi_wallet.json`.
 */
export type MultiWallet = {
  address: "mu1LDWh4VGHhnZHB85s92HNBapj3b9s5DgzTkiAyeKY";
  metadata: {
    name: "multiWallet";
    version: "0.1.0";
    spec: "0.1.0";
    description: "Created with Anchor";
  };
  instructions: [
    {
      name: "changeConfig";
      docs: [
        "# Parameters",
        "- `ctx`: The context of the multi-action execution.",
        "- `config_actions`: The list of actions to be executed.",
        "",
        "# Returns",
        "- `Result<()>`: The result of the multi-action execution.",
      ];
      discriminator: [24, 158, 114, 115, 94, 210, 244, 233];
      accounts: [
        {
          name: "settings";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  109,
                  117,
                  108,
                  116,
                  105,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116,
                ];
              },
              {
                kind: "account";
                path: "settings.create_key";
                account: "settings";
              },
            ];
          };
        },
        {
          name: "multiWallet";
          writable: true;
          signer: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  109,
                  117,
                  108,
                  116,
                  105,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116,
                ];
              },
              {
                kind: "account";
                path: "settings";
              },
              {
                kind: "const";
                value: [118, 97, 117, 108, 116];
              },
            ];
          };
        },
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "configActions";
          type: {
            vec: {
              defined: {
                name: "configAction";
              };
            };
          };
        },
      ];
    },
    {
      name: "create";
      docs: [
        "Creates a new multi-wallet.",
        "",
        "# Parameters",
        "- `ctx`: The context of the multi-wallet creation.",
        "- `initial_member`: The member key used to create the multi-wallet.",
        "- `metadata`: An optional metadata for the multi-wallet.",
        "- `label`: An optional label for the multi-wallet.",
        "",
        "# Returns",
        "- `Result<()>`: The result of the multi-wallet creation.",
      ];
      discriminator: [24, 30, 200, 40, 5, 28, 7, 119];
      accounts: [
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "settings";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  109,
                  117,
                  108,
                  116,
                  105,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116,
                ];
              },
              {
                kind: "arg";
                path: "createKey";
              },
            ];
          };
        },
        {
          name: "delegate";
          writable: true;
          optional: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [100, 101, 108, 101, 103, 97, 116, 101];
              },
              {
                kind: "arg";
                path: "initial_member.pubkey";
              },
            ];
          };
        },
        {
          name: "multiWallet";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  109,
                  117,
                  108,
                  116,
                  105,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116,
                ];
              },
              {
                kind: "account";
                path: "settings";
              },
              {
                kind: "const";
                value: [118, 97, 117, 108, 116];
              },
            ];
          };
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "initialMember";
          type: {
            defined: {
              name: "member";
            };
          };
        },
        {
          name: "createKey";
          type: "pubkey";
        },
        {
          name: "metadata";
          type: {
            option: "pubkey";
          };
        },
      ];
    },
    {
      name: "createDomainConfig";
      docs: [
        "Create the domain config needed for secp256r1 verification.",
        "",
        "# Parameters",
        "- `ctx`: The context of the domain config.",
        "",
        "# Returns",
        "- `Result<()>`: The result of the domain config creation.",
      ];
      discriminator: [197, 81, 191, 2, 164, 140, 184, 90];
      accounts: [
        {
          name: "domainConfig";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  100,
                  111,
                  109,
                  97,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                ];
              },
              {
                kind: "arg";
                path: "args.rp_id_hash";
              },
            ];
          };
        },
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "args";
          type: {
            defined: {
              name: "createDomainConfigArgs";
            };
          };
        },
      ];
    },
    {
      name: "deleteDomainConfig";
      docs: [
        "Delete the domain config needed for secp256r1 verification.",
        "",
        "# Parameters",
        "- `ctx`: The context of the domain config.",
        "",
        "# Returns",
        "- `Result<()>`: The result of the domain config Delete.",
      ];
      discriminator: [225, 169, 39, 18, 125, 147, 36, 29];
      accounts: [
        {
          name: "domainConfig";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  100,
                  111,
                  109,
                  97,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                ];
              },
              {
                kind: "account";
                path: "domainConfig";
              },
            ];
          };
        },
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [];
    },
    {
      name: "editDomainConfig";
      docs: [
        "Edit the domain config needed for secp256r1 verification.",
        "",
        "# Parameters",
        "- `ctx`: The context of the domain config.",
        "",
        "# Returns",
        "- `Result<()>`: The result of the domain config edit.",
      ];
      discriminator: [110, 212, 99, 229, 72, 93, 185, 231];
      accounts: [
        {
          name: "domainConfig";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  100,
                  111,
                  109,
                  97,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                ];
              },
              {
                kind: "account";
                path: "domainConfig";
              },
            ];
          };
        },
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "args";
          type: {
            defined: {
              name: "editDomainConfigArgs";
            };
          };
        },
      ];
    },
    {
      name: "transactionBufferClose";
      docs: [
        "Closes an existing transaction buffer.",
        "",
        "# Parameters",
        "- `ctx`: Context containing all necessary accounts.",
        "- `args`: Arguments for closing the transaction buffer.",
        "",
        "# Returns",
        "- `Ok(())`: If the transaction buffer is successfully closed.",
        "- `Err`: If validation fails or the accounts are invalid.",
      ];
      discriminator: [17, 182, 208, 228, 136, 24, 178, 102];
      accounts: [
        {
          name: "settings";
        },
        {
          name: "domainConfig";
          optional: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  100,
                  111,
                  109,
                  97,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                ];
              },
              {
                kind: "account";
                path: "domainConfig";
              },
            ];
          };
        },
        {
          name: "transactionBuffer";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  109,
                  117,
                  108,
                  116,
                  105,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116,
                ];
              },
              {
                kind: "account";
                path: "transaction_buffer.multi_wallet_settings";
                account: "transactionBuffer";
              },
              {
                kind: "const";
                value: [
                  116,
                  114,
                  97,
                  110,
                  115,
                  97,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  98,
                  117,
                  102,
                  102,
                  101,
                  114,
                ];
              },
              {
                kind: "account";
                path: "transaction_buffer.creator";
                account: "transactionBuffer";
              },
              {
                kind: "account";
                path: "transaction_buffer.buffer_index";
                account: "transactionBuffer";
              },
            ];
          };
        },
        {
          name: "closer";
          signer: true;
          optional: true;
        },
        {
          name: "rentPayer";
          writable: true;
        },
        {
          name: "slotHashSysvar";
          address: "SysvarS1otHashes111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "secp256r1VerifyArgs";
          type: {
            option: {
              defined: {
                name: "secp256r1VerifyArgs";
              };
            };
          };
        },
      ];
    },
    {
      name: "transactionBufferCreate";
      docs: [
        "Creates a new transaction buffer.",
        "",
        "# Parameters",
        "- `ctx`: Context containing all necessary accounts.",
        "- `args`: Arguments for the transaction buffer creation.",
        "",
        "# Returns",
        "- `Ok(())`: If the transaction buffer is successfully created.",
        "- `Err`: If validation fails or the provided arguments are invalid.",
      ];
      discriminator: [245, 201, 113, 108, 37, 63, 29, 89];
      accounts: [
        {
          name: "settings";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  109,
                  117,
                  108,
                  116,
                  105,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116,
                ];
              },
              {
                kind: "account";
                path: "settings.create_key";
                account: "settings";
              },
            ];
          };
        },
        {
          name: "domainConfig";
          optional: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  100,
                  111,
                  109,
                  97,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                ];
              },
              {
                kind: "account";
                path: "domainConfig";
              },
            ];
          };
        },
        {
          name: "transactionBuffer";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  109,
                  117,
                  108,
                  116,
                  105,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116,
                ];
              },
              {
                kind: "account";
                path: "settings";
              },
              {
                kind: "const";
                value: [
                  116,
                  114,
                  97,
                  110,
                  115,
                  97,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  98,
                  117,
                  102,
                  102,
                  101,
                  114,
                ];
              },
              {
                kind: "arg";
                path: "args.creator";
              },
              {
                kind: "arg";
                path: "args.buffer_index";
              },
            ];
          };
        },
        {
          name: "creator";
          signer: true;
          optional: true;
        },
        {
          name: "rentPayer";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "instructionsSysvar";
          address: "Sysvar1nstructions1111111111111111111111111";
        },
        {
          name: "slotHashSysvar";
          address: "SysvarS1otHashes111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "args";
          type: {
            defined: {
              name: "transactionBufferCreateArgs";
            };
          };
        },
        {
          name: "secp256r1VerifyArgs";
          type: {
            option: {
              defined: {
                name: "secp256r1VerifyArgs";
              };
            };
          };
        },
      ];
    },
    {
      name: "transactionBufferExecute";
      docs: [
        "Executes a transaction buffer.",
        "",
        "# Parameters",
        "- `ctx`: The context of the vault transaction execution.",
        "- `args`: Arguments for executing the vault transaction.",
        "",
        "# Returns",
        "- `Result<()>`: The result of the vault transaction execution.",
      ];
      discriminator: [48, 73, 34, 19, 129, 99, 128, 73];
      accounts: [
        {
          name: "domainConfig";
          optional: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  100,
                  111,
                  109,
                  97,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                ];
              },
              {
                kind: "account";
                path: "domainConfig";
              },
            ];
          };
        },
        {
          name: "settings";
          writable: true;
        },
        {
          name: "rentPayer";
          writable: true;
        },
        {
          name: "executor";
          signer: true;
          optional: true;
        },
        {
          name: "transactionBuffer";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  109,
                  117,
                  108,
                  116,
                  105,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116,
                ];
              },
              {
                kind: "account";
                path: "transaction_buffer.multi_wallet_settings";
                account: "transactionBuffer";
              },
              {
                kind: "const";
                value: [
                  116,
                  114,
                  97,
                  110,
                  115,
                  97,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  98,
                  117,
                  102,
                  102,
                  101,
                  114,
                ];
              },
              {
                kind: "account";
                path: "transaction_buffer.creator";
                account: "transactionBuffer";
              },
              {
                kind: "account";
                path: "transaction_buffer.buffer_index";
                account: "transactionBuffer";
              },
            ];
          };
        },
        {
          name: "slotHashSysvar";
          address: "SysvarS1otHashes111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "secp256r1VerifyArgs";
          type: {
            option: {
              defined: {
                name: "secp256r1VerifyArgs";
              };
            };
          };
        },
      ];
    },
    {
      name: "transactionBufferExtend";
      docs: [
        "Extends an existing transaction buffer.",
        "",
        "# Parameters",
        "- `ctx`: Context containing all necessary accounts.",
        "- `args`: Arguments for extending the transaction buffer.",
        "",
        "# Returns",
        "- `Ok(())`: If the transaction buffer is successfully extended.",
        "- `Err`: If validation fails or the provided arguments are invalid.",
      ];
      discriminator: [230, 157, 67, 56, 5, 238, 245, 146];
      accounts: [
        {
          name: "transactionBuffer";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  109,
                  117,
                  108,
                  116,
                  105,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116,
                ];
              },
              {
                kind: "account";
                path: "transaction_buffer.multi_wallet_settings";
                account: "transactionBuffer";
              },
              {
                kind: "const";
                value: [
                  116,
                  114,
                  97,
                  110,
                  115,
                  97,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  98,
                  117,
                  102,
                  102,
                  101,
                  114,
                ];
              },
              {
                kind: "account";
                path: "transaction_buffer.creator";
                account: "transactionBuffer";
              },
              {
                kind: "account";
                path: "transaction_buffer.buffer_index";
                account: "transactionBuffer";
              },
            ];
          };
        },
        {
          name: "domainConfig";
          optional: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  100,
                  111,
                  109,
                  97,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                ];
              },
              {
                kind: "account";
                path: "domainConfig";
              },
            ];
          };
        },
        {
          name: "creator";
          signer: true;
          optional: true;
        },
        {
          name: "slotHashSysvar";
          address: "SysvarS1otHashes111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "args";
          type: {
            defined: {
              name: "transactionBufferExtendArgs";
            };
          };
        },
        {
          name: "secp256r1VerifyArgs";
          type: {
            option: {
              defined: {
                name: "secp256r1VerifyArgs";
              };
            };
          };
        },
      ];
    },
    {
      name: "transactionBufferVote";
      docs: [
        "Sign to approve a transaction buffer.",
        "",
        "# Parameters",
        "- `ctx`: Context containing all necessary accounts.",
        "- `args`: Arguments for the transaction buffer vote.",
        "",
        "# Returns",
        "- `Ok(())`: If the transaction buffer is successfully approved.",
        "- `Err`: If validation fails or the provided arguments are invalid.",
      ];
      discriminator: [203, 50, 79, 187, 94, 53, 82, 122];
      accounts: [
        {
          name: "settings";
        },
        {
          name: "domainConfig";
          optional: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  100,
                  111,
                  109,
                  97,
                  105,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                ];
              },
              {
                kind: "account";
                path: "domainConfig";
              },
            ];
          };
        },
        {
          name: "transactionBuffer";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  109,
                  117,
                  108,
                  116,
                  105,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116,
                ];
              },
              {
                kind: "account";
                path: "transaction_buffer.multi_wallet_settings";
                account: "transactionBuffer";
              },
              {
                kind: "const";
                value: [
                  116,
                  114,
                  97,
                  110,
                  115,
                  97,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  98,
                  117,
                  102,
                  102,
                  101,
                  114,
                ];
              },
              {
                kind: "account";
                path: "transaction_buffer.creator";
                account: "transactionBuffer";
              },
              {
                kind: "account";
                path: "transaction_buffer.buffer_index";
                account: "transactionBuffer";
              },
            ];
          };
        },
        {
          name: "voter";
          signer: true;
          optional: true;
        },
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "slotHashSysvar";
          address: "SysvarS1otHashes111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "secp256r1VerifyArgs";
          type: {
            option: {
              defined: {
                name: "secp256r1VerifyArgs";
              };
            };
          };
        },
      ];
    },
  ];
  accounts: [
    {
      name: "delegate";
      discriminator: [92, 145, 166, 111, 11, 38, 38, 247];
    },
    {
      name: "domainConfig";
      discriminator: [201, 232, 212, 229, 59, 241, 106, 197];
    },
    {
      name: "settings";
      discriminator: [223, 179, 163, 190, 177, 224, 67, 173];
    },
    {
      name: "transactionBuffer";
      discriminator: [90, 36, 35, 219, 93, 225, 110, 96];
    },
  ];
  events: [
    {
      name: "configEvent";
      discriminator: [162, 6, 172, 68, 201, 128, 119, 230];
    },
  ];
  errors: [
    {
      code: 6000;
      name: "publicKeyLengthMismatch";
      msg: "Public Key Length does not match the Public Key Type";
    },
    {
      code: 6001;
      name: "durableNonceDetected";
      msg: "Durable nonce detected. Durable nonce is not allowed for this transaction.";
    },
    {
      code: 6002;
      name: "duplicateMember";
      msg: "Duplicate public keys found in the members array. Each member must have a unique public key.";
    },
    {
      code: 6003;
      name: "emptyMembers";
      msg: "The members array cannot be empty. Add at least one member.";
    },
    {
      code: 6004;
      name: "tooManyMembers";
      msg: "Too many members specified. A maximum of 65,535 members is allowed.";
    },
    {
      code: 6005;
      name: "invalidThreshold";
      msg: "Invalid threshold specified. The threshold must be between 1 and the total number of members.";
    },
    {
      code: 6006;
      name: "invalidTransactionMessage";
      msg: "The provided TransactionMessage is malformed or improperly formatted.";
    },
    {
      code: 6007;
      name: "notEnoughSigners";
      msg: "Insufficient signers. The number of signers must meet or exceed the minimum threshold.";
    },
    {
      code: 6008;
      name: "invalidNumberOfAccounts";
      msg: "Incorrect number of accounts provided. Verify the account count matches the expected number.";
    },
    {
      code: 6009;
      name: "invalidAccount";
      msg: "One or more accounts provided are invalid. Ensure all accounts meet the requirements.";
    },
    {
      code: 6010;
      name: "missingAccount";
      msg: "Required account is missing. Ensure all necessary accounts are included.";
    },
    {
      code: 6011;
      name: "accountAlreadyExist";
      msg: "The account already exist.";
    },
    {
      code: 6012;
      name: "illegalAccountOwner";
      msg: "Account is not owned by the Multisig program. Only accounts under the Multisig program can be used.";
    },
    {
      code: 6013;
      name: "missingOwner";
      msg: "The members array cannot have a length of one. Add an additional member.";
    },
    {
      code: 6014;
      name: "cannotRemoveDelegateKeyFromMember";
      msg: "You cannot remove delegate key from the member. Change the delegate first before removing it as a member.";
    },
    {
      code: 6015;
      name: "insufficientSignerWithExecutePermission";
      msg: "Require at least one signer to have the execute permission.";
    },
    {
      code: 6016;
      name: "insufficientSignerWithInitiatePermission";
      msg: "Require at least one signer to have the initiate permission.";
    },
    {
      code: 6017;
      name: "insufficientSignersWithVotePermission";
      msg: "Require threshold to be lesser than or equal to the number of members with vote permission.";
    },
    {
      code: 6018;
      name: "insufficientSignerWithIsDelegatePermission";
      msg: "Require at least one signer to have isDelegate permission.";
    },
    {
      code: 6019;
      name: "unauthorisedToModifyBuffer";
      msg: "Only the creator of the transaction buffer have permission to modify the buffer.";
    },
    {
      code: 6020;
      name: "finalBufferHashMismatch";
      msg: "Final message buffer hash doesnt match the expected hash";
    },
    {
      code: 6021;
      name: "finalBufferSizeExceeded";
      msg: "Final buffer size cannot exceed 4000 bytes";
    },
    {
      code: 6022;
      name: "finalBufferSizeMismatch";
      msg: "Final buffer size mismatch";
    },
    {
      code: 6023;
      name: "transactionHasExpired";
      msg: "Transaction has expired. 3 min has passed since the transaction was created.";
    },
    {
      code: 6024;
      name: "protectedAccount";
      msg: "Account is protected, it cannot be passed into a CPI as writable";
    },
    {
      code: 6025;
      name: "maxLengthExceeded";
      msg: "Origin must be lesser than 256 characters.";
    },
    {
      code: 6026;
      name: "invalidSlotHash";
      msg: "Slot hash is either invalid or 2.5 min has passed since the transaction was signed.";
    },
    {
      code: 6027;
      name: "domainConfigIsMissing";
      msg: "Domain Config is missing.";
    },
    {
      code: 6028;
      name: "rpIdIsInvalid";
      msg: "Rp Id is Invalid";
    },
    {
      code: 6029;
      name: "invalidJson";
      msg: "Unable to parse json data.";
    },
    {
      code: 6030;
      name: "missingOrigin";
      msg: "Origin is missing in client data json";
    },
    {
      code: 6031;
      name: "invalidOrigin";
      msg: "Origin in client data json is invalid.";
    },
    {
      code: 6032;
      name: "missingType";
      msg: "Type is missing in client data json";
    },
    {
      code: 6033;
      name: "invalidType";
      msg: "Type in client data json is not equals to webauthn.get";
    },
    {
      code: 6034;
      name: "missingChallenge";
      msg: "Challenge is missing in client data json";
    },
    {
      code: 6035;
      name: "invalidChallenge";
      msg: "Challenge in client data json is invalid.";
    },
    {
      code: 6036;
      name: "secp256r1VerifyArgsIsMissing";
      msg: "Secp256r1 Verify Args is missing.";
    },
  ];
  types: [
    {
      name: "configAction";
      type: {
        kind: "enum";
        variants: [
          {
            name: "setMembers";
            fields: [
              {
                vec: {
                  defined: {
                    name: "member";
                  };
                };
              },
            ];
          },
          {
            name: "addMembers";
            fields: [
              {
                vec: {
                  defined: {
                    name: "member";
                  };
                };
              },
            ];
          },
          {
            name: "removeMembers";
            fields: [
              {
                vec: {
                  defined: {
                    name: "memberKey";
                  };
                };
              },
            ];
          },
          {
            name: "setThreshold";
            fields: ["u8"];
          },
          {
            name: "setMetadata";
            fields: [
              {
                option: "pubkey";
              },
            ];
          },
        ];
      };
    },
    {
      name: "configEvent";
      type: {
        kind: "struct";
        fields: [
          {
            name: "createKey";
            type: "pubkey";
          },
          {
            name: "members";
            type: {
              vec: {
                defined: {
                  name: "member";
                };
              };
            };
          },
          {
            name: "threshold";
            type: "u8";
          },
          {
            name: "metadata";
            type: {
              option: "pubkey";
            };
          },
        ];
      };
    },
    {
      name: "createDomainConfigArgs";
      type: {
        kind: "struct";
        fields: [
          {
            name: "rpIdHash";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "origin";
            type: "string";
          },
          {
            name: "authority";
            type: "pubkey";
          },
        ];
      };
    },
    {
      name: "delegate";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "multiWalletSettings";
            type: "pubkey";
          },
          {
            name: "multiWallet";
            type: "pubkey";
          },
          {
            name: "bump";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "domainConfig";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "rpIdHash";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "originLength";
            type: "u8";
          },
          {
            name: "origin";
            type: {
              array: ["u8", 256];
            };
          },
          {
            name: "bump";
            type: "u8";
          },
          {
            name: "authority";
            type: "pubkey";
          },
          {
            name: "padding";
            type: {
              array: ["u8", 128];
            };
          },
        ];
      };
    },
    {
      name: "editDomainConfigArgs";
      type: {
        kind: "struct";
        fields: [
          {
            name: "origin";
            type: "string";
          },
          {
            name: "authority";
            type: "pubkey";
          },
        ];
      };
    },
    {
      name: "member";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pubkey";
            type: {
              defined: {
                name: "memberKey";
              };
            };
          },
          {
            name: "permissions";
            type: {
              defined: {
                name: "permissions";
              };
            };
          },
        ];
      };
    },
    {
      name: "memberKey";
      type: {
        kind: "struct";
        fields: [
          {
            name: "keyType";
            type: "u8";
          },
          {
            name: "key";
            type: "bytes";
          },
        ];
      };
    },
    {
      name: "permissions";
      docs: ["Bitmask for permissions."];
      type: {
        kind: "struct";
        fields: [
          {
            name: "mask";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "secp256r1VerifyArgs";
      type: {
        kind: "struct";
        fields: [
          {
            name: "signature";
            type: {
              array: ["u8", 64];
            };
          },
          {
            name: "pubkey";
            type: {
              array: ["u8", 33];
            };
          },
          {
            name: "authData";
            type: "bytes";
          },
          {
            name: "clientDataJson";
            type: "bytes";
          },
          {
            name: "slotNumber";
            type: "u64";
          },
          {
            name: "slotHash";
            type: {
              array: ["u8", 32];
            };
          },
        ];
      };
    },
    {
      name: "settings";
      type: {
        kind: "struct";
        fields: [
          {
            name: "createKey";
            type: "pubkey";
          },
          {
            name: "threshold";
            type: "u8";
          },
          {
            name: "multiWalletBump";
            type: "u8";
          },
          {
            name: "bump";
            type: "u8";
          },
          {
            name: "metadata";
            type: {
              option: "pubkey";
            };
          },
          {
            name: "members";
            type: {
              vec: {
                defined: {
                  name: "member";
                };
              };
            };
          },
        ];
      };
    },
    {
      name: "transactionBuffer";
      type: {
        kind: "struct";
        fields: [
          {
            name: "multiWalletSettings";
            docs: ["The multisig settings this belongs to."];
            type: "pubkey";
          },
          {
            name: "creator";
            docs: ["Member of the Multisig who created the TransactionBuffer."];
            type: {
              defined: {
                name: "memberKey";
              };
            };
          },
          {
            name: "voters";
            docs: ["Members that voted for this transaction"];
            type: {
              vec: {
                defined: {
                  name: "memberKey";
                };
              };
            };
          },
          {
            name: "expiry";
            type: "u64";
          },
          {
            name: "rentPayer";
            docs: ["Rent payer for the transaction buffer"];
            type: "pubkey";
          },
          {
            name: "bump";
            docs: ["transaction bump"];
            type: "u8";
          },
          {
            name: "bufferIndex";
            docs: ["Index to seed address derivation"];
            type: "u8";
          },
          {
            name: "finalBufferHash";
            docs: ["Hash of the final assembled transaction message."];
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "finalBufferSize";
            docs: ["The size of the final assembled transaction message."];
            type: "u16";
          },
          {
            name: "buffer";
            docs: ["The buffer of the transaction message."];
            type: "bytes";
          },
        ];
      };
    },
    {
      name: "transactionBufferCreateArgs";
      type: {
        kind: "struct";
        fields: [
          {
            name: "bufferIndex";
            docs: [
              "Index of the buffer account to seed the account derivation",
            ];
            type: "u8";
          },
          {
            name: "finalBufferHash";
            docs: ["Hash of the final assembled transaction message."];
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "finalBufferSize";
            docs: ["Final size of the buffer."];
            type: "u16";
          },
          {
            name: "buffer";
            docs: ["Initial slice of the buffer."];
            type: "bytes";
          },
          {
            name: "creator";
            docs: ["Creator of the transaction"];
            type: {
              defined: {
                name: "memberKey";
              };
            };
          },
        ];
      };
    },
    {
      name: "transactionBufferExtendArgs";
      type: {
        kind: "struct";
        fields: [
          {
            name: "buffer";
            type: "bytes";
          },
        ];
      };
    },
  ];
};
