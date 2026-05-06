use crate::error::MultisigError;
use crate::state::ProofArgs;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::{prelude::*, solana_program::program::invoke};
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TransferChecked};
use light_compressed_token_sdk::compressed_token::transfer2::{
    create_transfer2_instruction, Transfer2AccountsMetaConfig, Transfer2Config, Transfer2Inputs,
};
use light_compressed_token_sdk::compressed_token::CTokenAccount2;
use light_sdk::cpi::v2::CpiAccounts;
use light_sdk::instruction::PackedMerkleContext;
use light_token::compat::AccountState;
use light_token::instruction::{CreateTokenAtaCpi, TransferCpi, TransferFromSplCpi};
use light_token::spl_interface::derive_spl_interface_pda;
use light_token::spl_interface::{CreateSplInterfacePda, SplInterfacePda};
use light_token::utils::get_associated_token_address_and_bump;
use light_token::{ExtensionInstructionData, ValidityProof};
use light_token_interface::instructions::extensions::CompressedOnlyExtensionInstructionData;
use light_token_interface::instructions::transfer2::{
    Compression, MultiInputTokenDataWithContext, MultiTokenTransferOutputData,
};
use light_token_interface::state::ExtensionStruct;
use std::collections::HashMap;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct SplInterfacePdaArgs {
    pub index: u8,
    pub restricted: bool,
}

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct CompressedTokenArgs {
    pub version: u8,
    pub root_index: u16,
    pub amount: u64,
    pub merkle_context: PackedMerkleContext,
    pub tlv: Option<Vec<ExtensionStruct>>,
    pub state: AccountState,
}

#[derive(PartialEq)]
pub enum SourceType {
    CToken,
    Spl,
}

struct PackedAccount<'info> {
    index: u8,
    writable: bool,
    signer: bool,
    account_info: AccountInfo<'info>,
}

pub struct TokenTransfer<'a, 'info> {
    pub source: &'a AccountInfo<'info>,
    pub destination: &'a AccountInfo<'info>,
    pub mint: &'a AccountInfo<'info>,
    pub payer: &'a AccountInfo<'info>,
    pub source_spl_token_account: &'a AccountInfo<'info>,
    pub source_ctoken_token_account: &'a AccountInfo<'info>,
    pub destination_spl_token_account: Option<&'a AccountInfo<'info>>,
    pub destination_ctoken_token_account: Option<&'a AccountInfo<'info>>,
    pub spl_interface_pda: Option<&'a AccountInfo<'info>>,
    pub token_program: &'a AccountInfo<'info>,
    pub compressed_token_program_authority: &'a AccountInfo<'info>,
    pub compressible_config: &'a AccountInfo<'info>,
    pub rent_sponsor: Option<&'a AccountInfo<'info>>,
    pub system_program: &'a AccountInfo<'info>,
    pub spl_interface_pda_args: Option<SplInterfacePdaArgs>,
}

impl<'a, 'info> TokenTransfer<'a, 'info> {
    pub fn load_ata(
        &self,
        amount: u64,
        source_compressed_token: &[CompressedTokenArgs],
        light_cpi_accounts: Option<&CpiAccounts<'_, 'info>>,
        compressed_proof_args: Option<&ProofArgs>,
        spl_interface_pda_data: &Option<SplInterfacePda>,
        signer_seeds: &[&[u8]],
    ) -> Result<SourceType> {
        let spl_token_account = TokenAccount::try_deserialize(
            &mut self.source_spl_token_account.data.borrow().as_ref(),
        )
        .ok();
        let spl_balance = spl_token_account
            .as_ref()
            .map(|acc| acc.amount)
            .unwrap_or(0);

        let ctoken_account = light_token_interface::state::Token::try_from_slice(
            &self.source_ctoken_token_account.data.borrow(),
        )
        .ok();

        let ctoken_balance = ctoken_account.as_ref().map(|acc| acc.amount).unwrap_or(0);

        let compressed_token_balance = source_compressed_token.iter().map(|acc| acc.amount).sum();

        let total = spl_balance
            .saturating_add(ctoken_balance)
            .saturating_add(compressed_token_balance);
        if total < amount {
            return Err(ProgramError::InsufficientFunds.into());
        }

        if spl_balance >= amount {
            return Ok(SourceType::Spl);
        }

        // If SPL ATA exists → consolidate into SPL and return Spl
        if spl_token_account.is_some() {
            // If SPL+CToken still insufficient, decompress compressed into CToken
            if spl_balance.saturating_add(ctoken_balance) < amount {
                self.decompress_to_ctoken(
                    source_compressed_token,
                    light_cpi_accounts,
                    compressed_proof_args,
                    signer_seeds,
                )?;
            }

            // Move all CToken into SPL
            self.ctoken_to_spl_transfer(
                ctoken_balance.saturating_add(compressed_token_balance),
                spl_interface_pda_data,
                signer_seeds,
                &self.source_spl_token_account,
            )?;

            return Ok(SourceType::Spl);
        }

        // Else SPL ATA doesn't exist → if insufficient ctoken (decompress into CToken path)
        if ctoken_balance < amount {
            self.decompress_to_ctoken(
                source_compressed_token,
                light_cpi_accounts,
                compressed_proof_args,
                signer_seeds,
            )?;
        }

        return Ok(SourceType::CToken);
    }

    pub fn decompress_to_ctoken(
        &self,
        source_compressed_token_accounts: &[CompressedTokenArgs],
        light_cpi_accounts: Option<&CpiAccounts<'_, 'info>>,
        compressed_proof_args: Option<&ProofArgs>,
        signer_seeds: &[&[u8]],
    ) -> Result<()> {
        require!(
            !source_compressed_token_accounts.is_empty(),
            MultisigError::MissingCompressedTokenAccount
        );

        self.create_ctoken_ata(self.source, self.source_ctoken_token_account)?;

        let light_cpi_accounts =
            light_cpi_accounts.ok_or(MultisigError::MissingLightCpiAccounts)?;

        let compressed_proof_args =
            compressed_proof_args.ok_or(MultisigError::MissingCompressedProofArgs)?;

        /*
        -------------------------------------------------
        collect unique trees + queues (Vec only)
        -------------------------------------------------
        */

        let mut trees: Vec<AccountInfo<'info>> =
            Vec::with_capacity(source_compressed_token_accounts.len());

        let mut queues: Vec<AccountInfo<'info>> =
            Vec::with_capacity(source_compressed_token_accounts.len());

        for f in source_compressed_token_accounts {
            let tree = light_cpi_accounts
                .get_tree_account_info(f.merkle_context.merkle_tree_pubkey_index as usize)
                .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;

            if !trees.iter().any(|x| x.key == tree.key) {
                trees.push(tree.to_account_info());
            }

            let queue = light_cpi_accounts
                .get_tree_account_info(f.merkle_context.queue_pubkey_index as usize)
                .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;

            if !queues.iter().any(|x| x.key == queue.key) {
                queues.push(queue.to_account_info());
            }
        }

        /*
        -------------------------------------------------
        deterministic ordering
        -------------------------------------------------
        */

        let mut accounts: HashMap<Pubkey, PackedAccount<'info>> =
            HashMap::with_capacity(trees.len() + queues.len() + 3);

        let mut next_index: u8 = 0;

        // 1. trees
        for ai in trees {
            Self::get_or_insert(&mut accounts, &mut next_index, ai, true, false);
        }

        // 2. queues
        for ai in queues {
            Self::get_or_insert(&mut accounts, &mut next_index, ai, true, false);
        }

        // 3. source
        let owner_index = Self::get_or_insert(
            &mut accounts,
            &mut next_index,
            self.source.to_account_info(),
            false,
            true,
        );

        // 4. mint
        let mint_index = Self::get_or_insert(
            &mut accounts,
            &mut next_index,
            self.mint.to_account_info(),
            true,
            false,
        );

        // 5. destination
        let destination_index = Self::get_or_insert(
            &mut accounts,
            &mut next_index,
            self.source_ctoken_token_account.to_account_info(),
            true,
            false,
        );

        /*
        -------------------------------------------------
        build token inputs
        -------------------------------------------------
        */

        let mut total_amount = 0;

        let mut sources = Vec::with_capacity(source_compressed_token_accounts.len());

        let mut tlv_inputs = Vec::with_capacity(source_compressed_token_accounts.len());

        let ata_bump = get_associated_token_address_and_bump(self.source.key, self.mint.key).1;

        for f in source_compressed_token_accounts {
            total_amount += f.amount;

            let tree = light_cpi_accounts
                .get_tree_account_info(f.merkle_context.merkle_tree_pubkey_index as usize)
                .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;

            let queue = light_cpi_accounts
                .get_tree_account_info(f.merkle_context.queue_pubkey_index as usize)
                .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;

            let merkle_tree_pubkey_index = accounts[tree.key].index;

            let queue_pubkey_index = accounts[queue.key].index;

            let is_frozen = f.state == AccountState::Frozen;

            let mut tlv_vec = Vec::with_capacity(f.tlv.as_ref().map_or(0, |v| v.len()));

            if let Some(exts) = &f.tlv {
                for ext in exts {
                    if let ExtensionStruct::CompressedOnly(co) = ext {
                        tlv_vec.push(ExtensionInstructionData::CompressedOnly(
                            CompressedOnlyExtensionInstructionData {
                                delegated_amount: co.delegated_amount,
                                withheld_transfer_fee: co.withheld_transfer_fee,
                                is_frozen,
                                compression_index: 0,
                                is_ata: co.is_ata != 0,
                                bump: if co.is_ata != 0 { ata_bump } else { 0 },
                                owner_index,
                            },
                        ));
                    }
                }
            }

            tlv_inputs.push(tlv_vec);

            sources.push(MultiInputTokenDataWithContext {
                owner: owner_index,
                amount: f.amount,
                has_delegate: false,
                delegate: 0,
                mint: mint_index,
                version: f.version,
                merkle_context: PackedMerkleContext {
                    merkle_tree_pubkey_index,
                    queue_pubkey_index,
                    prove_by_index: f.merkle_context.prove_by_index,
                    leaf_index: f.merkle_context.leaf_index,
                },
                root_index: f.root_index,
            });
        }

        /*
        -------------------------------------------------
        build token account
        -------------------------------------------------
        */

        let mut token_account =
            CTokenAccount2::new(sources).map_err(|_| ProgramError::InvalidAccountData)?;

        token_account
            .decompress(total_amount, destination_index)
            .map_err(|_| ProgramError::InvalidAccountData)?;

        /*
        -------------------------------------------------
        pack metas
        -------------------------------------------------
        */

        let mut packed_accounts = vec![AccountMeta::default(); accounts.len()];

        let mut ordered_infos = vec![None; accounts.len()];

        for acc in accounts.values() {
            packed_accounts[acc.index as usize] = if acc.writable {
                AccountMeta::new(*acc.account_info.key, acc.signer)
            } else {
                AccountMeta::new_readonly(*acc.account_info.key, acc.signer)
            };

            ordered_infos[acc.index as usize] = Some(acc.account_info.to_account_info());
        }

        /*
        -------------------------------------------------
        instruction
        -------------------------------------------------
        */

        let inputs = Transfer2Inputs {
            meta_config: Transfer2AccountsMetaConfig::new(self.payer.key(), packed_accounts),
            token_accounts: vec![token_account],
            transfer_config: Transfer2Config::default().filter_zero_amount_outputs(),
            validity_proof: light_token::ValidityProof(compressed_proof_args.proof),
            in_tlv: if tlv_inputs.iter().all(|f| f.is_empty()) {
                None
            } else {
                Some(tlv_inputs)
            },
            ..Default::default()
        };

        let ix = create_transfer2_instruction(inputs).map_err(ProgramError::from)?;

        /*
        -------------------------------------------------
        cpi
        -------------------------------------------------
        */

        let mut account_infos = vec![
            light_cpi_accounts.account_infos()[0].to_account_info(),
            light_cpi_accounts.fee_payer().to_account_info(),
            self.compressed_token_program_authority.to_account_info(),
            light_cpi_accounts
                .registered_program_pda()
                .map_err(|_| MultisigError::LightCpiAccountError)?
                .to_account_info(),
            light_cpi_accounts
                .account_compression_authority()
                .map_err(|_| MultisigError::LightCpiAccountError)?
                .to_account_info(),
            light_cpi_accounts
                .account_compression_program()
                .map_err(|_| MultisigError::LightCpiAccountError)?
                .to_account_info(),
            light_cpi_accounts
                .system_program()
                .map_err(|_| MultisigError::LightCpiAccountError)?
                .to_account_info(),
        ];

        account_infos.extend(ordered_infos.into_iter().map(|x| x.unwrap()));

        invoke_signed(&ix, &account_infos, &[signer_seeds])?;

        Ok(())
    }

    pub fn spl_to_spl_transfer(&self, amount: u64, signer_seeds: &[&[u8]]) -> Result<()> {
        let destination_token_account = self
            .destination_spl_token_account
            .ok_or(MultisigError::MissingCompressedTokenAccount)?;
        let mint_data = self.mint.data.borrow();
        let mint = Mint::try_deserialize(&mut mint_data.as_ref())?;
        transfer_checked(
            CpiContext::new(
                self.token_program.to_account_info(),
                TransferChecked {
                    from: self.source_spl_token_account.to_account_info(),
                    mint: self.mint.to_account_info(),
                    to: destination_token_account.to_account_info(),
                    authority: self.source.to_account_info(),
                },
            )
            .with_signer(&[signer_seeds]),
            amount,
            mint.decimals,
        )?;

        Ok(())
    }

    pub fn spl_to_ctoken_transfer(
        self,
        amount: u64,
        spl_interface_pda_data: &Option<SplInterfacePda>,
        signer_seeds: &[&[u8]],
    ) -> Result<()> {
        let destination_token_account = self
            .destination_ctoken_token_account
            .ok_or(MultisigError::MissingCompressedTokenAccount)?;
        self.create_ctoken_ata(self.destination, destination_token_account)?;
        let spl_interface_pda = self
            .spl_interface_pda
            .ok_or(MultisigError::MissingSplInterfacePda)?;
        let spl_interface_pda_data = spl_interface_pda_data
            .as_ref()
            .ok_or(MultisigError::MissingSplInterfacePda)?;
        let mint_data = self.mint.data.borrow();
        let mint = Mint::try_deserialize(&mut mint_data.as_ref())?;
        TransferFromSplCpi {
            amount,
            spl_interface_pda_bump: spl_interface_pda_data.bump,
            source_spl_token_account: self.source_spl_token_account.to_account_info(),
            destination: destination_token_account.to_account_info(),
            authority: self.source.to_account_info(),
            mint: self.mint.to_account_info(),
            payer: self.payer.to_account_info(),
            spl_interface_pda: spl_interface_pda.to_account_info(),
            spl_token_program: self.token_program.to_account_info(),
            compressed_token_program_authority: self
                .compressed_token_program_authority
                .to_account_info(),
            system_program: self.system_program.to_account_info(),
            decimals: mint.decimals,
        }
        .invoke_signed(&[signer_seeds])?;

        Ok(())
    }

    pub fn ctoken_to_ctoken_transfer(&self, amount: u64, signer_seeds: &[&[u8]]) -> Result<()> {
        let destination_token_account = self
            .destination_ctoken_token_account
            .ok_or(MultisigError::MissingCompressedTokenAccount)?;

        self.create_ctoken_ata(self.destination, destination_token_account)?;

        TransferCpi {
            amount,
            source: self.source_ctoken_token_account.to_account_info(),
            destination: destination_token_account.to_account_info(),
            authority: self.source.to_account_info(),
            system_program: self.system_program.to_account_info(),
            fee_payer: self.payer.to_account_info(),
        }
        .invoke_signed(&[signer_seeds])?;

        Ok(())
    }

    pub fn ctoken_to_spl_transfer(
        &self,
        amount: u64,
        spl_interface_pda_data: &Option<SplInterfacePda>,
        signer_seeds: &[&[u8]],
        destination_token_account: &AccountInfo<'info>,
    ) -> Result<()> {
        let spl_interface_pda = self
            .spl_interface_pda
            .ok_or(MultisigError::MissingSplInterfacePda)?;
        let spl_interface_pda_data = spl_interface_pda_data
            .as_ref()
            .ok_or(MultisigError::MissingSplInterfacePda)?;
        let mint_data = self.mint.data.borrow();
        let mint = Mint::try_deserialize(&mut mint_data.as_ref())?;

        let packed_accounts = vec![
            // Mint (index 0)
            AccountMeta::new_readonly(self.mint.key(), false),
            // Source ctoken account (index 1) - writable
            AccountMeta::new(self.source_ctoken_token_account.key(), false),
            // Destination SPL token account (index 2) - writable
            AccountMeta::new(destination_token_account.key(), false),
            // Authority (index 3) - signer
            AccountMeta::new_readonly(self.source.key(), true),
            // SPL interface PDA (index 4) - writable
            AccountMeta::new(spl_interface_pda.key(), false),
            // SPL Token program (index 5) - needed for CPI
            AccountMeta::new_readonly(self.token_program.key(), false),
            // System program (index 6) - needed for topups
            AccountMeta::new_readonly(self.system_program.key(), false),
        ];

        // First operation: compress from ctoken account to pool using compress_spl
        let compress_to_pool = CTokenAccount2 {
            inputs: vec![],
            output: MultiTokenTransferOutputData::default(),
            compression: Some(Compression::compress(
                amount, 0, // mint index
                1, // source ctoken account index
                3, // authority index
            )),
            delegate_is_set: false,
            method_used: true,
        };

        // Second operation: decompress from pool to SPL token account using decompress_spl
        let decompress_to_spl = CTokenAccount2 {
            inputs: vec![],
            output: MultiTokenTransferOutputData::default(),
            compression: Some(Compression::decompress_spl(
                amount,
                0, // mint index
                2, // destination SPL token account index
                4, // pool_account_index
                0, // pool_index (TODO: make dynamic)
                spl_interface_pda_data.bump,
                mint.decimals,
            )),
            delegate_is_set: false,
            method_used: true,
        };

        let inputs = Transfer2Inputs {
            validity_proof: ValidityProof::new(None),
            transfer_config: Transfer2Config::default().filter_zero_amount_outputs(),
            meta_config: Transfer2AccountsMetaConfig::new_decompressed_accounts_only(
                self.payer.key(),
                packed_accounts,
            ),
            in_lamports: None,
            out_lamports: None,
            token_accounts: vec![compress_to_pool, decompress_to_spl],
            output_queue: 0, // Decompressed accounts only, no output queue needed
            in_tlv: None,
        };

        let ix = create_transfer2_instruction(inputs).map_err(ProgramError::from)?;

        // Account order must match instruction metas: cpi_authority_pda, fee_payer, packed_accounts...
        let account_infos = [
            self.compressed_token_program_authority.to_account_info(), // CPI authority PDA (first)
            self.payer.to_account_info(),                              // Fee payer (second)
            self.mint.to_account_info(),                               // Index 0: Mint
            self.source_ctoken_token_account.to_account_info(), // Index 1: Source ctoken account
            destination_token_account.to_account_info(), // Index 2: Destination SPL token account
            self.source.to_account_info(),               // Index 3: Authority (signer)
            spl_interface_pda.to_account_info(),         // Index 4: SPL interface PDA
            self.token_program.to_account_info(),        // Index 5: SPL Token program
            self.system_program.to_account_info(),
        ];

        invoke_signed(&ix, &account_infos, &[signer_seeds])?;

        Ok(())
    }

    pub fn create_ctoken_ata(
        &self,
        owner: &AccountInfo<'info>,
        ata: &AccountInfo<'info>,
    ) -> Result<()> {
        let rent_sponsor = self
            .rent_sponsor
            .ok_or(MultisigError::MissingCompressedTokenAccount)?;

        CreateTokenAtaCpi {
            owner: owner.to_account_info(),
            mint: self.mint.to_account_info(),
            payer: self.payer.to_account_info(),
            ata: ata.to_account_info(),
        }
        .idempotent()
        .rent_free(
            self.compressible_config.to_account_info(),
            rent_sponsor.to_account_info(),
            self.system_program.to_account_info(),
        )
        .invoke()?;

        Ok(())
    }

    pub fn create_spl_interface_pda_if_needed(
        &self,
        remaining_accounts: &[AccountInfo<'info>],
    ) -> Result<Option<SplInterfacePda>> {
        let Some(spl_interface_pda) = self.spl_interface_pda else {
            return Ok(None);
        };

        let spl_interface_pda_args = self
            .spl_interface_pda_args
            .as_ref()
            .ok_or(MultisigError::MissingSplInterfacePda)?;

        let spl_interface_pda_data = derive_spl_interface_pda(
            self.mint.key,
            spl_interface_pda_args.index,
            spl_interface_pda_args.restricted,
        );

        if spl_interface_pda.data_is_empty() {
            let mint = remaining_accounts
                .iter()
                .find(|f| f.key() == *self.mint.key)
                .ok_or(MultisigError::MissingCompressedTokenAccount)?;
            let ix = CreateSplInterfacePda::new_with_index(
                self.payer.key(),
                self.mint.key(),
                self.token_program.key(),
                spl_interface_pda_args.index,
                spl_interface_pda_args.restricted,
            )
            .instruction();
            invoke(
                &ix,
                &[
                    self.payer.to_account_info(),
                    spl_interface_pda.to_account_info(),
                    self.system_program.to_account_info(),
                    mint.to_account_info(),
                    self.token_program.to_account_info(),
                    self.compressed_token_program_authority.to_account_info(),
                ],
            )?;
        }

        Ok(Some(spl_interface_pda_data))
    }

    fn get_or_insert(
        map: &mut HashMap<Pubkey, PackedAccount<'info>>,
        next_index: &mut u8,
        account_info: AccountInfo<'info>,
        writable: bool,
        signer: bool,
    ) -> u8 {
        let key = *account_info.key;
        if let Some(existing) = map.get_mut(&key) {
            existing.writable |= writable;
            existing.signer |= signer;
            existing.index
        } else {
            let index = *next_index;
            *next_index += 1;
            map.insert(
                key,
                PackedAccount {
                    index,
                    writable,
                    signer,
                    account_info,
                },
            );
            index
        }
    }
}
