use crate::{
    durable_nonce_check,
    state::{Settings, SettingsMutArgs},
    utils::{CompressedTokenArgs, SourceType},
    ChallengeArgs, CompressedSettings, CompressedSettingsData, DomainConfig, MemberKey,
    MultisigError, Permission, ProofArgs, Secp256r1VerifyArgsWithDomainAddress,
    TransactionActionType, LIGHT_CPI_SIGNER, SEED_MULTISIG, SEED_VAULT,
};
use anchor_lang::{
    prelude::*,
    solana_program::{
        program::{invoke, invoke_signed},
        sysvar::SysvarId,
    },
};
use anchor_spl::{
    associated_token::{self},
    token_interface::{transfer_checked, Mint, TokenAccount, TransferChecked},
};
use light_ctoken_interface::instructions::transfer2::MultiInputTokenDataWithContext;
use light_ctoken_sdk::{
    compressed_token::{
        transfer2::{
            create_transfer2_instruction, Transfer2AccountsMetaConfig, Transfer2Config,
            Transfer2Inputs,
        },
        CTokenAccount2,
    },
    ctoken::{
        self, CompressibleParamsCpi, CreateAssociatedCTokenAccountCpi, TransferCTokenCpi,
        TransferCTokenToSplCpi, TransferSplToCtokenCpi, COMPRESSIBLE_CONFIG_V1,
        CTOKEN_CPI_AUTHORITY, CTOKEN_PROGRAM_ID,
    },
    spl_interface::{derive_spl_interface_pda, CreateSplInterfacePda, SplInterfacePda},
};
use light_sdk::{
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    instruction::{PackedMerkleContext, ValidityProof},
    light_hasher::{Hasher, Sha256},
    LightAccount,
};

#[derive(Accounts)]
pub struct TokenTransferIntentCompressed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK:
    #[account(
        address = SlotHashes::id()
    )]
    pub slot_hash_sysvar: Option<UncheckedAccount<'info>>,
    /// CHECK:
    #[account(
        address = Instructions::id(),
    )]
    pub instructions_sysvar: UncheckedAccount<'info>,
    /// CHECK: checked in instructions
    pub source: UncheckedAccount<'info>,
    /// CHECK:
    #[account(
        mut,  
        seeds = [
            source.key().as_ref(),
            token_program.key().as_ref(),
            mint.key().as_ref(),
        ],
        bump,
        seeds::program = associated_token::ID
    )]
    pub source_spl_token_account: UncheckedAccount<'info>,
    /// CHECK:
    #[account(
        mut,
        seeds = [
            source.key().as_ref(),
            CTOKEN_PROGRAM_ID.as_ref(),
            mint.key().as_ref(),
        ],
        bump,
        seeds::program = CTOKEN_PROGRAM_ID
    )]
    pub source_ctoken_token_account: UncheckedAccount<'info>,
    /// CHECK:
    pub destination: UncheckedAccount<'info>,
    /// CHECK:
    #[account(
        mut,  
        seeds = [
            destination.key().as_ref(),
            token_program.key().as_ref(),
            mint.key().as_ref(),
        ],
        bump,
        seeds::program = associated_token::ID
    )]
    pub destination_spl_token_account: Option<UncheckedAccount<'info>>,
    /// CHECK:
    #[account(
        mut,
        seeds = [
            destination.key().as_ref(),
            CTOKEN_PROGRAM_ID.as_ref(),
            mint.key().as_ref(),
        ],
        bump,
        seeds::program = CTOKEN_PROGRAM_ID
    )]
    pub destination_ctoken_token_account: Option<UncheckedAccount<'info>>,
    /// CHECK:
    pub token_program: UncheckedAccount<'info>,
    /// CHECK:
    pub mint: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK:
    #[account(
        address = CTOKEN_CPI_AUTHORITY
    )]
    pub compressed_token_program_authority: UncheckedAccount<'info>,
    /// CHECK:
    #[account(
        mut,
        seeds = [
            b"pool".as_ref(),
            mint.key().as_ref(),
        ],
        bump,
        seeds::program = CTOKEN_PROGRAM_ID
    )]
    pub spl_interface_pda: Option<UncheckedAccount<'info>>,
    /// CHECK:
    #[account(
        address = COMPRESSIBLE_CONFIG_V1
    )]
    pub compressible_config: UncheckedAccount<'info>,
    /// CHECK:
    #[account(mut)]
    pub rent_sponsor: Option<UncheckedAccount<'info>>,
    /// CHECK:
    #[account(
        address = CTOKEN_PROGRAM_ID,
    )]
    pub compressed_token_program: UncheckedAccount<'info>,
}

impl<'info> TokenTransferIntentCompressed<'info> {
    fn validate(
        &self,
        amount: u64,
        remaining_accounts: &'info [AccountInfo<'info>],
        secp256r1_verify_args: &Vec<Secp256r1VerifyArgsWithDomainAddress>,
        settings: &CompressedSettingsData,
    ) -> Result<()> {
        let Self {
            slot_hash_sysvar,
            instructions_sysvar,
            mint,
            destination,
            token_program,
            ..
        } = &self;

        durable_nonce_check(instructions_sysvar)?;

        let mut initiate = false;
        let mut execute = false;
        let mut vote_count = 0;
        let mut are_delegates = true;

        let threshold = settings.threshold as usize;
        let secp256r1_member_keys: Vec<(MemberKey, &Secp256r1VerifyArgsWithDomainAddress)> =
            secp256r1_verify_args
                .iter()
                .filter_map(|arg| {
                    let pubkey = arg
                        .verify_args
                        .extract_public_key_from_instruction(Some(&self.instructions_sysvar))
                        .ok()?;

                    let member_key = MemberKey::convert_secp256r1(&pubkey).ok()?;

                    Some((member_key, arg))
                })
                .collect();

        for member in &settings.members {
            let has_permission = |perm| member.permissions.has(perm);

            let secp256r1_signer = secp256r1_member_keys
                .iter()
                .find(|f| f.0.eq(&member.pubkey));

            let is_signer = secp256r1_signer.is_some()
                || remaining_accounts.iter().any(|account| {
                    account.is_signer
                        && MemberKey::convert_ed25519(account.key)
                            .map_or(false, |key| key.eq(&member.pubkey))
                });

            if is_signer {
                if has_permission(Permission::InitiateTransaction) {
                    initiate = true;
                }
                if has_permission(Permission::ExecuteTransaction) {
                    execute = true;
                }
                if has_permission(Permission::VoteTransaction) {
                    vote_count += 1;
                }
                if secp256r1_signer.is_some() && member.is_delegate == 0 {
                    are_delegates = false;
                }
            }

            if let Some((_, secp256r1_verify_data)) = secp256r1_signer {
                let account_loader = DomainConfig::extract_domain_config_account(
                    remaining_accounts,
                    secp256r1_verify_data.domain_config_key,
                )?;

                let mut buffer = vec![];
                buffer.extend_from_slice(amount.to_le_bytes().as_ref());
                buffer.extend_from_slice(destination.key().as_ref());
                buffer.extend_from_slice(mint.key().as_ref());
                let message_hash = Sha256::hash(&buffer).unwrap();

                secp256r1_verify_data.verify_args.verify_webauthn(
                    slot_hash_sysvar,
                    &Some(account_loader),
                    instructions_sysvar,
                    ChallengeArgs {
                        account: token_program.key(),
                        message_hash,
                        action_type: TransactionActionType::TransferIntent,
                    },
                    &vec![],
                )?;
            }
        }

        require!(
            initiate,
            MultisigError::InsufficientSignerWithInitiatePermission
        );
        require!(
            execute,
            MultisigError::InsufficientSignerWithExecutePermission
        );
        require!(
            vote_count >= threshold,
            MultisigError::InsufficientSignersWithVotePermission
        );
        require!(are_delegates, MultisigError::InvalidNonDelegatedSigners);

        Ok(())
    }

    pub fn process(
        ctx: Context<'_, '_, 'info, 'info, Self>,
        amount: u64,
        compressed_token_account: Option<CompressedTokenArgs>,
        secp256r1_verify_args: Vec<Secp256r1VerifyArgsWithDomainAddress>,
        settings_mut_args: SettingsMutArgs,
        compressed_proof_args: ProofArgs,
    ) -> Result<()> {
        let light_cpi_accounts = CpiAccounts::new(
            &ctx.accounts.payer,
            &ctx.remaining_accounts
                [compressed_proof_args.light_cpi_accounts_start_index as usize..],
            LIGHT_CPI_SIGNER,
        );
        let mut settings_account = LightAccount::<CompressedSettings>::new_mut(
            &crate::ID,
            &settings_mut_args.account_meta,
            settings_mut_args.data,
        )
        .map_err(ProgramError::from)?;

        let settings_data = settings_account
            .data
            .as_ref()
            .ok_or(MultisigError::InvalidAccount)?;

        let settings_key =
            Settings::get_settings_key_from_index(settings_data.index, settings_data.bump)?;

        ctx.accounts.validate(
            amount,
            ctx.remaining_accounts,
            &secp256r1_verify_args,
            &settings_data,
        )?;

        let signer_seeds: &[&[u8]] = &[
            SEED_MULTISIG,
            settings_key.as_ref(),
            SEED_VAULT,
            &[settings_data.multi_wallet_bump],
        ];

        let multi_wallet = Pubkey::create_program_address(signer_seeds, &crate::id())
            .map_err(ProgramError::from)?;
        require!(
            ctx.accounts.source.key().eq(&multi_wallet),
            MultisigError::InvalidAccount
        );

        let mut spl_interface_pda_data = None;
        if let Some(spl_interface_pda) = &ctx.accounts.spl_interface_pda {
            if spl_interface_pda.data_is_empty() {
                let mint = ctx
                    .remaining_accounts
                    .iter()
                    .find(|f| f.key().eq(ctx.accounts.mint.key))
                    .ok_or(MultisigError::MissingAccount)?;
                let ix = CreateSplInterfacePda::new(
                    ctx.accounts.payer.key(),
                    ctx.accounts.mint.key(),
                    ctx.accounts.token_program.key(),
                )
                .instruction();
                invoke(
                    &ix,
                    &[
                        ctx.accounts.payer.to_account_info(),
                        spl_interface_pda.to_account_info(),
                        ctx.accounts.system_program.to_account_info(),
                        mint.to_account_info(),
                        ctx.accounts.token_program.to_account_info(),
                        ctx.accounts
                            .compressed_token_program_authority
                            .to_account_info(),
                    ],
                )?;
            }
            spl_interface_pda_data = Some(derive_spl_interface_pda(ctx.accounts.mint.key, 0))
        }

        let source_type = load_ata(
            &ctx,
            amount,
            &compressed_token_account,
            &light_cpi_accounts,
            &compressed_proof_args,
            &spl_interface_pda_data,
            signer_seeds,
        )?;

        if source_type.eq(&SourceType::Spl)
            && ctx.accounts.destination_ctoken_token_account.is_some()
        {
            spl_to_ctoken_transfer(&ctx, amount, &spl_interface_pda_data, signer_seeds)?;
        } else if source_type.eq(&SourceType::Spl)
            && ctx.accounts.destination_spl_token_account.is_some()
        {
            spl_to_spl_transfer(&ctx, amount, signer_seeds)?;
        } else if source_type.eq(&SourceType::CToken)
            && ctx.accounts.destination_ctoken_token_account.is_some()
        {
            ctoken_to_ctoken_transfer(&ctx, amount, signer_seeds)?;
        } else if source_type.eq(&SourceType::CToken)
            && ctx.accounts.destination_spl_token_account.is_some()
        {
            ctoken_to_spl_transfer(&ctx, amount, &spl_interface_pda_data, signer_seeds)?;
        }

        settings_account.latest_slot_number_check(
            secp256r1_verify_args
                .iter()
                .map(|f| f.verify_args.slot_number)
                .collect(),
            &ctx.accounts.slot_hash_sysvar,
        )?;

        settings_account.invariant()?;

        LightSystemProgramCpi::new_cpi(
            LIGHT_CPI_SIGNER,
            ValidityProof(compressed_proof_args.proof),
        )
        .with_light_account(settings_account)?
        .invoke(light_cpi_accounts)?;

        Ok(())
    }
}

fn spl_to_spl_transfer<'info>(
    ctx: &Context<'_, '_, 'info, 'info, TokenTransferIntentCompressed<'info>>,
    amount: u64,
    signer_seeds: &[&[u8]],
) -> Result<()> {
    let destination_token_account = ctx
        .accounts
        .destination_spl_token_account
        .as_ref()
        .ok_or(MultisigError::MissingAccount)?;
    let mint = Mint::try_deserialize(&mut ctx.accounts.mint.data.borrow().as_ref())?;
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.source_spl_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: destination_token_account.to_account_info(),
                authority: ctx.accounts.source.to_account_info(),
            },
        )
        .with_signer(&[signer_seeds]),
        amount,
        mint.decimals,
    )?;

    Ok(())
}

fn spl_to_ctoken_transfer<'info>(
    ctx: &Context<'_, '_, 'info, 'info, TokenTransferIntentCompressed<'info>>,
    amount: u64,
    spl_interface_pda_data: &Option<SplInterfacePda>,
    signer_seeds: &[&[u8]],
) -> Result<()> {
    let destination_token_account = ctx
        .accounts
        .destination_ctoken_token_account
        .as_ref()
        .ok_or(MultisigError::MissingAccount)?;
    let bump = ctx
        .bumps
        .destination_ctoken_token_account
        .ok_or(MultisigError::MissingAccount)?;
    let rent_sponsor = ctx
        .accounts
        .rent_sponsor
        .as_ref()
        .ok_or(MultisigError::MissingAccount)?;
    let spl_interface_pda = ctx
        .accounts
        .spl_interface_pda
        .as_ref()
        .ok_or(MultisigError::MissingAccount)?;
    let spl_interface_pda_data = spl_interface_pda_data
        .as_ref()
        .ok_or(MultisigError::MissingAccount)?;

    CreateAssociatedCTokenAccountCpi {
        owner: ctx.accounts.destination.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        payer: ctx.accounts.payer.to_account_info(),
        associated_token_account: destination_token_account.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        bump,
        compressible: Some(CompressibleParamsCpi::new(
            ctx.accounts.compressible_config.to_account_info(),
            rent_sponsor.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        )),
        idempotent: true,
    }
    .invoke()?;

    TransferSplToCtokenCpi {
        amount,
        spl_interface_pda_bump: spl_interface_pda_data.bump,
        source_spl_token_account: ctx.accounts.source_spl_token_account.to_account_info(),
        destination_ctoken_account: destination_token_account.to_account_info(),
        authority: ctx.accounts.source.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        payer: ctx.accounts.payer.to_account_info(),
        spl_interface_pda: spl_interface_pda.to_account_info(),
        spl_token_program: ctx.accounts.token_program.to_account_info(),
        compressed_token_program_authority: ctx
            .accounts
            .compressed_token_program_authority
            .to_account_info(),
    }
    .invoke_signed(&[signer_seeds])?;

    Ok(())
}

fn ctoken_to_ctoken_transfer<'info>(
    ctx: &Context<'_, '_, 'info, 'info, TokenTransferIntentCompressed<'info>>,
    amount: u64,
    signer_seeds: &[&[u8]],
) -> Result<()> {
    let destination_token_account = ctx
        .accounts
        .destination_ctoken_token_account
        .as_ref()
        .ok_or(MultisigError::MissingAccount)?;
    let bump = ctx
        .bumps
        .destination_ctoken_token_account
        .ok_or(MultisigError::MissingAccount)?;
    let rent_sponsor = ctx
        .accounts
        .rent_sponsor
        .as_ref()
        .ok_or(MultisigError::MissingAccount)?;

    CreateAssociatedCTokenAccountCpi {
        owner: ctx.accounts.destination.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        payer: ctx.accounts.payer.to_account_info(),
        associated_token_account: destination_token_account.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        bump,
        compressible: Some(CompressibleParamsCpi::new(
            ctx.accounts.compressible_config.to_account_info(),
            rent_sponsor.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        )),
        idempotent: true,
    }
    .invoke()?;

    TransferCTokenCpi {
        amount,
        source: ctx.accounts.source_ctoken_token_account.to_account_info(),
        destination: destination_token_account.to_account_info(),
        authority: ctx.accounts.source.to_account_info(),
        max_top_up: None,
    }
    .invoke_signed(&[signer_seeds])?;

    Ok(())
}

fn ctoken_to_spl_transfer<'info>(
    ctx: &Context<'_, '_, 'info, 'info, TokenTransferIntentCompressed<'info>>,
    amount: u64,
    spl_interface_pda_data: &Option<SplInterfacePda>,
    signer_seeds: &[&[u8]],
) -> Result<()> {
    let destination_token_account = ctx
        .accounts
        .destination_spl_token_account
        .as_ref()
        .ok_or(MultisigError::MissingAccount)?;
    let spl_interface_pda = ctx
        .accounts
        .spl_interface_pda
        .as_ref()
        .ok_or(MultisigError::MissingAccount)?;
    let spl_interface_pda_data = spl_interface_pda_data
        .as_ref()
        .ok_or(MultisigError::MissingAccount)?;
    TransferCTokenToSplCpi {
        source_ctoken_account: ctx.accounts.source_ctoken_token_account.to_account_info(),
        destination_spl_token_account: destination_token_account.to_account_info(),
        amount,
        authority: ctx.accounts.source.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        payer: ctx.accounts.payer.to_account_info(),
        spl_interface_pda: spl_interface_pda.to_account_info(),
        spl_interface_pda_bump: spl_interface_pda_data.bump,
        spl_token_program: ctx.accounts.token_program.to_account_info(),
        compressed_token_program_authority: ctx
            .accounts
            .compressed_token_program_authority
            .to_account_info(),
    }
    .invoke_signed(&[signer_seeds])?;

    Ok(())
}

// should load into spl ata if exist, else load into ctoken ata
fn load_ata<'info>(
    ctx: &Context<'_, '_, 'info, 'info, TokenTransferIntentCompressed<'info>>,
    amount: u64,
    compressed_token_account: &Option<CompressedTokenArgs>,
    light_cpi_accounts: &CpiAccounts<'_, 'info>,
    compressed_proof_args: &ProofArgs,
    spl_interface_pda_data: &Option<SplInterfacePda>,
    signer_seeds: &[&[u8]],
) -> Result<SourceType> {
    let spl_token_account = TokenAccount::try_deserialize(
        &mut ctx.accounts.source_spl_token_account.data.borrow().as_ref(),
    )
    .map_or(None, |f| Some(f));
    let spl_balance = if spl_token_account.is_some() {
        spl_token_account.unwrap().amount
    } else {
        0
    };

    let ctoken_balance =
        ctoken::CToken::try_from_slice(&ctx.accounts.source_ctoken_token_account.data.borrow())
            .map(|f| f.amount)
            .unwrap_or(0);

    let compressed_token_balance = compressed_token_account.as_ref().map_or(0, |f| f.amount);

    let total = spl_balance
        .saturating_add(ctoken_balance)
        .saturating_add(compressed_token_balance);
    if total < amount {
        return Err(ProgramError::InsufficientFunds.into());
    }

    // Fast path: already enough SPL
    if spl_balance >= amount {
        return Ok(SourceType::Spl);
    }

    // If SPL ATA exists → consolidate into SPL and return Spl
    if spl_token_account.is_some() {
        // If SPL+CToken still insufficient, decompress compressed into SPL
        if spl_balance.saturating_add(ctoken_balance) < amount {
            decompress_to_spl(
                ctx,
                compressed_token_account,
                light_cpi_accounts,
                compressed_proof_args,
                signer_seeds,
                spl_interface_pda_data,
                compressed_token_balance,
            )?;
        }

        // Move all CToken into SPL (if any)
        if ctoken_balance != 0 {
            let spl_interface_pda = ctx
                .accounts
                .spl_interface_pda
                .as_ref()
                .ok_or(MultisigError::MissingAccount)?;
            let spl_interface_pda_data = spl_interface_pda_data
                .as_ref()
                .ok_or(MultisigError::MissingAccount)?;
            TransferCTokenToSplCpi {
                source_ctoken_account: ctx.accounts.source_ctoken_token_account.to_account_info(),
                destination_spl_token_account: ctx
                    .accounts
                    .source_spl_token_account
                    .to_account_info(),
                amount: ctoken_balance,
                authority: ctx.accounts.source.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                payer: ctx.accounts.payer.to_account_info(),
                spl_interface_pda: spl_interface_pda.to_account_info(),
                spl_interface_pda_bump: spl_interface_pda_data.bump,
                spl_token_program: ctx.accounts.token_program.to_account_info(),
                compressed_token_program_authority: ctx
                    .accounts
                    .compressed_token_program_authority
                    .to_account_info(),
            }
            .invoke_signed(&[signer_seeds])?;
        }

        return Ok(SourceType::Spl);
    }

    // Else SPL ATA doesn't exist → ensure enough CToken (decompress into CToken path)
    if ctoken_balance < amount {
        decompress_to_ctoken(
            ctx,
            compressed_token_account,
            light_cpi_accounts,
            compressed_proof_args,
            signer_seeds,
            compressed_token_balance,
        )?;
    }

    Ok(SourceType::CToken)
}

fn decompress_to_spl<'info>(
    ctx: &Context<'_, '_, 'info, 'info, TokenTransferIntentCompressed<'info>>,
    compressed_token_account: &Option<CompressedTokenArgs>,
    light_cpi_accounts: &CpiAccounts<'_, 'info>,
    compressed_proof_args: &ProofArgs,
    signer_seeds: &[&[u8]],
    spl_interface_pda_data: &Option<SplInterfacePda>,
    compressed_token_balance: u64,
) -> Result<()> {
    let compressed_token_account = compressed_token_account
        .as_ref()
        .ok_or(MultisigError::InvalidArguments)?;
    let tree_ai: AccountInfo<'_> = light_cpi_accounts
        .get_tree_account_info(
            compressed_token_account
                .merkle_context
                .merkle_tree_pubkey_index as usize,
        )
        .map_err(|_| ErrorCode::AccountNotEnoughKeys)?
        .to_account_info();
    let queue_ai = light_cpi_accounts
        .get_tree_account_info(compressed_token_account.merkle_context.queue_pubkey_index as usize)
        .map_err(|_| ErrorCode::AccountNotEnoughKeys)?
        .to_account_info();

    let spl_interface_pda = ctx
        .accounts
        .spl_interface_pda
        .as_ref()
        .ok_or(MultisigError::MissingAccount)?;
    let spl_interface_pda_data = spl_interface_pda_data
        .as_ref()
        .ok_or(MultisigError::MissingAccount)?;

    // packed metas
    let mut packed_accounts = Vec::new();
    let tree_index = packed_accounts.len();
    packed_accounts.push(AccountMeta::new(tree_ai.key(), false));
    let queue_index = packed_accounts.len();
    packed_accounts.push(AccountMeta::new(queue_ai.key(), false));
    let mint_index = packed_accounts.len();
    packed_accounts.push(AccountMeta::new_readonly(ctx.accounts.mint.key(), false));
    let owner_index = packed_accounts.len();
    packed_accounts.push(AccountMeta::new_readonly(ctx.accounts.source.key(), true));
    let source_index = packed_accounts.len();
    packed_accounts.push(AccountMeta::new(
        ctx.accounts.source_spl_token_account.key(),
        false,
    ));
    let pool_account_index = packed_accounts.len();
    packed_accounts.push(AccountMeta::new(spl_interface_pda.key(), false));
    packed_accounts.push(AccountMeta::new_readonly(
        ctx.accounts.token_program.key(),
        false,
    ));

    let mut token_accounts = CTokenAccount2::new(vec![MultiInputTokenDataWithContext {
        owner: owner_index as u8,
        amount: compressed_token_account.amount,
        has_delegate: false,
        delegate: 0,
        mint: mint_index as u8,
        version: compressed_token_account.version,
        merkle_context: PackedMerkleContext {
            merkle_tree_pubkey_index: tree_index as u8,
            queue_pubkey_index: queue_index as u8,
            leaf_index: compressed_token_account.merkle_context.leaf_index,
            prove_by_index: compressed_token_account.merkle_context.prove_by_index,
        },
        root_index: compressed_token_account.root_index,
    }])
    .map_err(|_| MultisigError::InvalidAccount)?;

    token_accounts
        .decompress_spl(
            compressed_token_balance,
            source_index as u8,
            pool_account_index as u8,
            spl_interface_pda_data.index,
            spl_interface_pda_data.bump,
        )
        .map_err(|_| MultisigError::InvalidAccount)?;

    // account infos
    let mut account_info = Vec::new();
    account_info.push(light_cpi_accounts.account_infos()[0].to_account_info());
    account_info.push(light_cpi_accounts.fee_payer().to_account_info());
    account_info.push(
        ctx.accounts
            .compressed_token_program_authority
            .to_account_info(),
    );
    account_info.push(
        light_cpi_accounts
            .registered_program_pda()
            .unwrap()
            .to_account_info(),
    );
    account_info.push(
        light_cpi_accounts
            .account_compression_authority()
            .unwrap()
            .to_account_info(),
    );
    account_info.push(
        light_cpi_accounts
            .account_compression_program()
            .unwrap()
            .to_account_info(),
    );
    account_info.push(
        light_cpi_accounts
            .system_program()
            .unwrap()
            .to_account_info(),
    );

    account_info.push(tree_ai.to_account_info());
    account_info.push(queue_ai.to_account_info());
    account_info.push(ctx.accounts.mint.to_account_info());
    account_info.push(ctx.accounts.source.to_account_info());
    account_info.push(ctx.accounts.source_spl_token_account.to_account_info());
    account_info.push(spl_interface_pda.to_account_info());
    account_info.push(ctx.accounts.token_program.to_account_info());

    let ix = create_transfer2_instruction(Transfer2Inputs {
        token_accounts: vec![token_accounts],
        validity_proof: ValidityProof(compressed_proof_args.proof),
        transfer_config: Transfer2Config::new(),
        meta_config: Transfer2AccountsMetaConfig::new(ctx.accounts.payer.key(), packed_accounts),
        in_lamports: None,
        out_lamports: None,
        output_queue: queue_index as u8,
    })
    .map_err(|_| MultisigError::InvalidAccount)?;

    invoke_signed(&ix, &account_info, &[signer_seeds])?;
    Ok(())
}

fn decompress_to_ctoken<'info>(
    ctx: &Context<'_, '_, 'info, 'info, TokenTransferIntentCompressed<'info>>,
    compressed_token_account: &Option<CompressedTokenArgs>,
    light_cpi_accounts: &CpiAccounts<'_, 'info>,
    compressed_proof_args: &ProofArgs,
    signer_seeds: &[&[u8]],
    compressed_token_balance: u64,
) -> Result<()> {
    let compressed_token_account = compressed_token_account
        .as_ref()
        .ok_or(MultisigError::InvalidArguments)?;
    let tree_ai: AccountInfo<'_> = light_cpi_accounts
        .get_tree_account_info(
            compressed_token_account
                .merkle_context
                .merkle_tree_pubkey_index as usize,
        )
        .map_err(|_| ErrorCode::AccountNotEnoughKeys)?
        .to_account_info();
    let queue_ai = light_cpi_accounts
        .get_tree_account_info(compressed_token_account.merkle_context.queue_pubkey_index as usize)
        .map_err(|_| ErrorCode::AccountNotEnoughKeys)?
        .to_account_info();

    let mut packed_accounts = Vec::new();
    let tree_index = packed_accounts.len();
    packed_accounts.push(AccountMeta::new(tree_ai.key(), false));
    let queue_index = packed_accounts.len();
    packed_accounts.push(AccountMeta::new(queue_ai.key(), false));
    let mint_index = packed_accounts.len();
    packed_accounts.push(AccountMeta::new_readonly(ctx.accounts.mint.key(), false));
    let owner_index = packed_accounts.len();
    packed_accounts.push(AccountMeta::new_readonly(ctx.accounts.source.key(), true));
    let source_index = packed_accounts.len();
    packed_accounts.push(AccountMeta::new(
        ctx.accounts.source_ctoken_token_account.key(),
        false,
    ));
    packed_accounts.push(AccountMeta::new_readonly(
        ctx.accounts.token_program.key(),
        false,
    ));

    let mut token_accounts = CTokenAccount2::new(vec![MultiInputTokenDataWithContext {
        owner: owner_index as u8,
        amount: compressed_token_account.amount,
        has_delegate: false,
        delegate: 0,
        mint: mint_index as u8,
        version: compressed_token_account.version,
        merkle_context: PackedMerkleContext {
            merkle_tree_pubkey_index: tree_index as u8,
            queue_pubkey_index: queue_index as u8,
            leaf_index: compressed_token_account.merkle_context.leaf_index,
            prove_by_index: compressed_token_account.merkle_context.prove_by_index,
        },
        root_index: compressed_token_account.root_index,
    }])
    .map_err(|_| MultisigError::InvalidAccount)?;

    token_accounts
        .decompress_ctoken(compressed_token_balance, source_index as u8)
        .map_err(|_| MultisigError::InvalidAccount)?;

    let mut account_info = Vec::new();
    account_info.push(light_cpi_accounts.account_infos()[0].to_account_info());
    account_info.push(light_cpi_accounts.fee_payer().to_account_info());
    account_info.push(
        ctx.accounts
            .compressed_token_program_authority
            .to_account_info(),
    );
    account_info.push(
        light_cpi_accounts
            .registered_program_pda()
            .unwrap()
            .to_account_info(),
    );
    account_info.push(
        light_cpi_accounts
            .account_compression_authority()
            .unwrap()
            .to_account_info(),
    );
    account_info.push(
        light_cpi_accounts
            .account_compression_program()
            .unwrap()
            .to_account_info(),
    );
    account_info.push(
        light_cpi_accounts
            .system_program()
            .unwrap()
            .to_account_info(),
    );

    account_info.push(tree_ai.to_account_info());
    account_info.push(queue_ai.to_account_info());
    account_info.push(ctx.accounts.mint.to_account_info());
    account_info.push(ctx.accounts.source.to_account_info());
    account_info.push(ctx.accounts.source_ctoken_token_account.to_account_info());

    let ix = create_transfer2_instruction(Transfer2Inputs {
        token_accounts: vec![token_accounts],
        validity_proof: ValidityProof(compressed_proof_args.proof),
        transfer_config: Transfer2Config::new(),
        meta_config: Transfer2AccountsMetaConfig::new(ctx.accounts.payer.key(), packed_accounts),
        in_lamports: None,
        out_lamports: None,
        output_queue: queue_index as u8,
    })
    .map_err(|_| MultisigError::InvalidAccount)?;

    invoke_signed(&ix, &account_info, &[signer_seeds])?;
    Ok(())
}
