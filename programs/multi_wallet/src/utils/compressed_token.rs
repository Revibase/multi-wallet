use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::{prelude::*, solana_program::program::invoke};
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TransferChecked};
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
        TransferCTokenToSplCpi, TransferSplToCtokenCpi,
    },
    spl_interface::{derive_spl_interface_pda, CreateSplInterfacePda, SplInterfacePda},
};
use light_sdk::{
    cpi::v2::CpiAccounts,
    instruction::{PackedMerkleContext, ValidityProof},
};

use crate::error::MultisigError;
use crate::state::ProofArgs;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct SourceCompressedTokenArgs {
    pub version: u8,
    pub root_index: u16,
    pub amount: u64,
    pub merkle_context: PackedMerkleContext,
}

#[derive(PartialEq)]
pub enum SourceType {
    CompressedToken,
    CToken,
    Spl,
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
    pub destination_ctoken_bump: Option<u8>,
}

impl<'a, 'info> TokenTransfer<'a, 'info> {
    pub fn load_ata(
        &self,
        amount: u64,
        source_compressed_token_account: &Option<SourceCompressedTokenArgs>,
        light_cpi_accounts: Option<&CpiAccounts<'_, 'info>>,
        compressed_proof_args: Option<&ProofArgs>,
        spl_interface_pda_data: &Option<SplInterfacePda>,
        signer_seeds: &[&[u8]],
    ) -> Result<SourceType> {
        let spl_token_account = TokenAccount::try_deserialize(
            &mut self.source_spl_token_account.data.borrow().as_ref(),
        )
        .map_or(None, |f| Some(f));
        let spl_balance = if spl_token_account.is_some() {
            spl_token_account.as_ref().unwrap().amount
        } else {
            0
        };
        let ctoken_account =
            ctoken::CToken::try_from_slice(&self.source_ctoken_token_account.data.borrow())
                .map_or(None, |f| Some(f));

        let ctoken_balance = if ctoken_account.is_some() {
            ctoken_account.as_ref().unwrap().amount
        } else {
            0
        };

        let compressed_token_balance = source_compressed_token_account
            .as_ref()
            .map_or(0, |f| f.amount);

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
                self.compressed_token_to_spl_transfer(
                    source_compressed_token_account,
                    light_cpi_accounts,
                    compressed_proof_args,
                    signer_seeds,
                    spl_interface_pda_data,
                    compressed_token_balance,
                    &self.source_spl_token_account,
                )?;
            }

            // Move all CToken into SPL (if any)
            if ctoken_balance != 0 {
                self.ctoken_to_spl_transfer(
                    ctoken_balance,
                    spl_interface_pda_data,
                    signer_seeds,
                    &self.source_spl_token_account,
                )?;
            }

            return Ok(SourceType::Spl);
        }

        if ctoken_account.is_some() {
            // Else SPL ATA doesn't exist → ensure enough CToken (decompress into CToken path)
            if ctoken_balance < amount {
                self.compressed_token_to_ctoken_transfer(
                    source_compressed_token_account,
                    light_cpi_accounts,
                    compressed_proof_args,
                    signer_seeds,
                    compressed_token_balance,
                    &self.source_ctoken_token_account,
                )?;
            }
            return Ok(SourceType::CToken);
        }

        Ok(SourceType::CompressedToken)
    }

    pub fn compressed_token_to_spl_transfer(
        &self,
        source_compressed_token_account: &Option<SourceCompressedTokenArgs>,
        light_cpi_accounts: Option<&CpiAccounts<'_, 'info>>,
        compressed_proof_args: Option<&ProofArgs>,
        signer_seeds: &[&[u8]],
        spl_interface_pda_data: &Option<SplInterfacePda>,
        amount: u64,
        destination_spl_token_account: &AccountInfo<'info>,
    ) -> Result<()> {
        let light_cpi_accounts = light_cpi_accounts
            .as_ref()
            .ok_or(MultisigError::InvalidArguments)?;
        let source_compressed_token_account = source_compressed_token_account
            .as_ref()
            .ok_or(MultisigError::InvalidArguments)?;
        let tree_ai = light_cpi_accounts
            .get_tree_account_info(
                source_compressed_token_account
                    .merkle_context
                    .merkle_tree_pubkey_index as usize,
            )
            .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;

        let queue_ai = light_cpi_accounts
            .get_tree_account_info(
                source_compressed_token_account
                    .merkle_context
                    .queue_pubkey_index as usize,
            )
            .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;

        let spl_interface_pda = self
            .spl_interface_pda
            .as_ref()
            .ok_or(MultisigError::MissingAccount)?;
        let spl_interface_pda_data = spl_interface_pda_data
            .as_ref()
            .ok_or(MultisigError::MissingAccount)?;

        let compressed_proof_args = compressed_proof_args
            .as_ref()
            .ok_or(MultisigError::InvalidArguments)?;

        // packed metas
        let mut packed_accounts = Vec::new();
        let tree_index = packed_accounts.len();
        packed_accounts.push(AccountMeta::new(tree_ai.key(), false));
        let queue_index = packed_accounts.len();
        packed_accounts.push(AccountMeta::new(queue_ai.key(), false));
        let mint_index = packed_accounts.len();
        packed_accounts.push(AccountMeta::new_readonly(self.mint.key(), false));
        let owner_index = packed_accounts.len();
        packed_accounts.push(AccountMeta::new_readonly(self.source.key(), true));
        let recipient_index = packed_accounts.len();
        packed_accounts.push(AccountMeta::new(destination_spl_token_account.key(), false));
        let pool_account_index = packed_accounts.len();
        packed_accounts.push(AccountMeta::new(spl_interface_pda.key(), false));
        packed_accounts.push(AccountMeta::new_readonly(self.token_program.key(), false));

        let mut token_accounts = CTokenAccount2::new(vec![MultiInputTokenDataWithContext {
            owner: owner_index as u8,
            amount: source_compressed_token_account.amount,
            has_delegate: false,
            delegate: 0,
            mint: mint_index as u8,
            version: source_compressed_token_account.version,
            merkle_context: PackedMerkleContext {
                merkle_tree_pubkey_index: tree_index as u8,
                queue_pubkey_index: queue_index as u8,
                leaf_index: source_compressed_token_account.merkle_context.leaf_index,
                prove_by_index: source_compressed_token_account
                    .merkle_context
                    .prove_by_index,
            },
            root_index: source_compressed_token_account.root_index,
        }])
        .map_err(|_| MultisigError::InvalidAccount)?;

        token_accounts
            .decompress_spl(
                amount,
                recipient_index as u8,
                pool_account_index as u8,
                spl_interface_pda_data.index,
                spl_interface_pda_data.bump,
            )
            .map_err(|_| MultisigError::InvalidAccount)?;

        // account infos
        let mut account_info = Vec::new();
        account_info.push(light_cpi_accounts.account_infos()[0].to_account_info());
        account_info.push(light_cpi_accounts.fee_payer().to_account_info());
        account_info.push(self.compressed_token_program_authority.to_account_info());
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
        account_info.push(self.mint.to_account_info());
        account_info.push(self.source.to_account_info());
        account_info.push(destination_spl_token_account.to_account_info());
        account_info.push(spl_interface_pda.to_account_info());
        account_info.push(self.token_program.to_account_info());

        let ix = create_transfer2_instruction(Transfer2Inputs {
            token_accounts: vec![token_accounts],
            validity_proof: ValidityProof(compressed_proof_args.proof),
            transfer_config: Transfer2Config::new(),
            meta_config: Transfer2AccountsMetaConfig::new(self.payer.key(), packed_accounts),
            in_lamports: None,
            out_lamports: None,
            output_queue: queue_index as u8,
        })
        .map_err(|_| MultisigError::InvalidAccount)?;

        invoke_signed(&ix, &account_info, &[signer_seeds])?;
        Ok(())
    }

    pub fn compressed_token_to_ctoken_transfer(
        &self,
        source_compressed_token_account: &Option<SourceCompressedTokenArgs>,
        light_cpi_accounts: Option<&CpiAccounts<'_, 'info>>,
        compressed_proof_args: Option<&ProofArgs>,
        signer_seeds: &[&[u8]],
        amount: u64,
        destination_ctoken_token_account: &AccountInfo<'info>,
    ) -> Result<()> {
        let light_cpi_accounts = light_cpi_accounts
            .as_ref()
            .ok_or(MultisigError::InvalidArguments)?;
        let source_compressed_token_account = source_compressed_token_account
            .as_ref()
            .ok_or(MultisigError::InvalidArguments)?;
        let tree_ai = light_cpi_accounts
            .get_tree_account_info(
                source_compressed_token_account
                    .merkle_context
                    .merkle_tree_pubkey_index as usize,
            )
            .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;
        let queue_ai = light_cpi_accounts
            .get_tree_account_info(
                source_compressed_token_account
                    .merkle_context
                    .queue_pubkey_index as usize,
            )
            .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;

        let compressed_proof_args = compressed_proof_args
            .as_ref()
            .ok_or(MultisigError::InvalidArguments)?;

        let mut packed_accounts = Vec::new();
        let tree_index = packed_accounts.len();
        packed_accounts.push(AccountMeta::new(tree_ai.key(), false));
        let queue_index = packed_accounts.len();
        packed_accounts.push(AccountMeta::new(queue_ai.key(), false));
        let mint_index = packed_accounts.len();
        packed_accounts.push(AccountMeta::new_readonly(self.mint.key(), false));
        let owner_index = packed_accounts.len();
        packed_accounts.push(AccountMeta::new_readonly(self.source.key(), true));
        let recipient_index = packed_accounts.len();
        packed_accounts.push(AccountMeta::new(
            destination_ctoken_token_account.key(),
            false,
        ));

        let mut token_accounts = CTokenAccount2::new(vec![MultiInputTokenDataWithContext {
            owner: owner_index as u8,
            amount: source_compressed_token_account.amount,
            has_delegate: false,
            delegate: 0,
            mint: mint_index as u8,
            version: source_compressed_token_account.version,
            merkle_context: PackedMerkleContext {
                merkle_tree_pubkey_index: tree_index as u8,
                queue_pubkey_index: queue_index as u8,
                leaf_index: source_compressed_token_account.merkle_context.leaf_index,
                prove_by_index: source_compressed_token_account
                    .merkle_context
                    .prove_by_index,
            },
            root_index: source_compressed_token_account.root_index,
        }])
        .map_err(|_| MultisigError::InvalidAccount)?;

        token_accounts
            .decompress_ctoken(amount, recipient_index as u8)
            .map_err(|_| MultisigError::InvalidAccount)?;

        let mut account_info = Vec::new();
        account_info.push(light_cpi_accounts.account_infos()[0].to_account_info());
        account_info.push(light_cpi_accounts.fee_payer().to_account_info());
        account_info.push(self.compressed_token_program_authority.to_account_info());
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
        account_info.push(self.mint.to_account_info());
        account_info.push(self.source.to_account_info());
        account_info.push(destination_ctoken_token_account.to_account_info());

        let ix = create_transfer2_instruction(Transfer2Inputs {
            token_accounts: vec![token_accounts],
            validity_proof: ValidityProof(compressed_proof_args.proof),
            transfer_config: Transfer2Config::new(),
            meta_config: Transfer2AccountsMetaConfig::new(self.payer.key(), packed_accounts),
            in_lamports: None,
            out_lamports: None,
            output_queue: queue_index as u8,
        })
        .map_err(|_| MultisigError::InvalidAccount)?;

        invoke_signed(&ix, &account_info, &[signer_seeds])?;
        Ok(())
    }

    pub fn spl_to_spl_transfer(&self, amount: u64, signer_seeds: &[&[u8]]) -> Result<()> {
        let destination_token_account = self
            .destination_spl_token_account
            .as_ref()
            .ok_or(MultisigError::MissingAccount)?;
        let mint = Mint::try_deserialize(&mut self.mint.data.borrow().as_ref())?;
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
        self.create_destination_ctoken_ata()?;

        let destination_token_account = self
            .destination_ctoken_token_account
            .as_ref()
            .ok_or(MultisigError::MissingAccount)?;
        let spl_interface_pda = self
            .spl_interface_pda
            .as_ref()
            .ok_or(MultisigError::MissingAccount)?;
        let spl_interface_pda_data = spl_interface_pda_data
            .as_ref()
            .ok_or(MultisigError::MissingAccount)?;

        TransferSplToCtokenCpi {
            amount,
            spl_interface_pda_bump: spl_interface_pda_data.bump,
            source_spl_token_account: self.source_spl_token_account.to_account_info(),
            destination_ctoken_account: destination_token_account.to_account_info(),
            authority: self.source.to_account_info(),
            mint: self.mint.to_account_info(),
            payer: self.payer.to_account_info(),
            spl_interface_pda: spl_interface_pda.to_account_info(),
            spl_token_program: self.token_program.to_account_info(),
            compressed_token_program_authority: self
                .compressed_token_program_authority
                .to_account_info(),
        }
        .invoke_signed(&[signer_seeds])?;

        Ok(())
    }

    pub fn ctoken_to_ctoken_transfer(&self, amount: u64, signer_seeds: &[&[u8]]) -> Result<()> {
        self.create_destination_ctoken_ata()?;

        let destination_token_account = self
            .destination_ctoken_token_account
            .as_ref()
            .ok_or(MultisigError::MissingAccount)?;

        TransferCTokenCpi {
            amount,
            source: self.source_ctoken_token_account.to_account_info(),
            destination: destination_token_account.to_account_info(),
            authority: self.source.to_account_info(),
            max_top_up: None,
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
            .as_ref()
            .ok_or(MultisigError::MissingAccount)?;
        let spl_interface_pda_data = spl_interface_pda_data
            .as_ref()
            .ok_or(MultisigError::MissingAccount)?;
        TransferCTokenToSplCpi {
            source_ctoken_account: self.source_ctoken_token_account.to_account_info(),
            destination_spl_token_account: destination_token_account.to_account_info(),
            amount,
            authority: self.source.to_account_info(),
            mint: self.mint.to_account_info(),
            payer: self.payer.to_account_info(),
            spl_interface_pda: spl_interface_pda.to_account_info(),
            spl_interface_pda_bump: spl_interface_pda_data.bump,
            spl_token_program: self.token_program.to_account_info(),
            compressed_token_program_authority: self
                .compressed_token_program_authority
                .to_account_info(),
        }
        .invoke_signed(&[signer_seeds])?;

        Ok(())
    }

    pub fn create_destination_ctoken_ata(&self) -> Result<()> {
        let destination_ctoken_token_account = self
            .destination_ctoken_token_account
            .as_ref()
            .ok_or(MultisigError::MissingAccount)?;
        let rent_sponsor = self
            .rent_sponsor
            .as_ref()
            .ok_or(MultisigError::MissingAccount)?;
        let bump = self
            .destination_ctoken_bump
            .ok_or(MultisigError::MissingAccount)?;

        CreateAssociatedCTokenAccountCpi {
            owner: self.destination.to_account_info(),
            mint: self.mint.to_account_info(),
            payer: self.payer.to_account_info(),
            associated_token_account: destination_ctoken_token_account.to_account_info(),
            system_program: self.system_program.to_account_info(),
            bump,
            compressible: Some(CompressibleParamsCpi::new(
                self.compressible_config.to_account_info(),
                rent_sponsor.to_account_info(),
                self.system_program.to_account_info(),
            )),
            idempotent: true,
        }
        .invoke()?;
        Ok(())
    }

    pub fn create_spl_interface_pda_if_needed(
        &self,
        remaining_accounts: &[AccountInfo<'info>],
    ) -> Result<Option<SplInterfacePda>> {
        let mut spl_interface_pda_data = None;
        if let Some(spl_interface_pda) = &self.spl_interface_pda {
            if spl_interface_pda.data_is_empty() {
                let mint = remaining_accounts
                    .iter()
                    .find(|f| f.key().eq(self.mint.key))
                    .ok_or(MultisigError::MissingAccount)?;
                let ix = CreateSplInterfacePda::new(
                    self.payer.key(),
                    self.mint.key(),
                    self.token_program.key(),
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
            spl_interface_pda_data = Some(derive_spl_interface_pda(self.mint.key, 0))
        }
        Ok(spl_interface_pda_data)
    }
}
