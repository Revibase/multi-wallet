use crate::error::MultisigError;
use crate::state::ProofArgs;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::{prelude::*, solana_program::program::invoke};
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TransferChecked};
use light_sdk::{
    cpi::v2::CpiAccounts,
    instruction::{PackedMerkleContext, ValidityProof},
};
use light_token::anchor::derive_token_ata;
use light_token::instruction::{
    CreateTokenAtaCpi, TransferCpi, TransferFromSplCpi, TransferToSplCpi,
};
use light_token::spl_interface::derive_spl_interface_pda;
use light_token::ExtensionInstructionData;
use light_token::{
    compressed_token::{
        transfer2::{
            create_transfer2_instruction, Transfer2AccountsMetaConfig, Transfer2Config,
            Transfer2Inputs,
        },
        CTokenAccount2,
    },
    spl_interface::{CreateSplInterfacePda, SplInterfacePda},
};
use light_token_interface::instructions::extensions::CompressedOnlyExtensionInstructionData;
use light_token_interface::instructions::transfer2::MultiInputTokenDataWithContext;
use light_token_interface::state::ExtensionStruct;

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
    pub has_delegate: bool,
    pub is_frozen: bool,
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
    pub spl_interface_pda_args: Option<SplInterfacePdaArgs>,
}

impl<'a, 'info> TokenTransfer<'a, 'info> {
    /// Helper: Extract and deduplicate tree and queue account infos from compressed token accounts
    /// Returns (tree_accounts, queue_accounts, tree_indices, queue_indices)
    /// where tree_indices[i] is the index of the tree for compressed_token_accounts[i]
    fn extract_tree_and_queue_accounts(
        source_compressed_token_accounts: &[CompressedTokenArgs],
        light_cpi_accounts: &CpiAccounts<'_, 'info>,
    ) -> Result<(
        Vec<AccountInfo<'info>>,
        Vec<AccountInfo<'info>>,
        Vec<u8>,
        Vec<u8>,
    )> {
        let mut tree_account_infos = Vec::new();
        let mut queue_accounts_infos = Vec::new();
        let mut tree_indices = Vec::with_capacity(source_compressed_token_accounts.len());
        let mut queue_indices = Vec::with_capacity(source_compressed_token_accounts.len());

        for account in source_compressed_token_accounts {
            let tree_account = light_cpi_accounts
                .get_tree_account_info(account.merkle_context.merkle_tree_pubkey_index as usize)
                .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;
            let tree_key = tree_account.key();

            // Deduplicate tree accounts
            let tree_idx = if let Some(pos) = tree_account_infos
                .iter()
                .position(|info: &AccountInfo| info.key() == tree_key)
            {
                pos as u8
            } else {
                let idx = tree_account_infos.len() as u8;
                tree_account_infos.push(tree_account.to_account_info());
                idx
            };
            tree_indices.push(tree_idx);

            let queue_account = light_cpi_accounts
                .get_tree_account_info(account.merkle_context.queue_pubkey_index as usize)
                .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;
            let queue_key = queue_account.key();

            // Deduplicate queue accounts
            let queue_idx = if let Some(pos) = queue_accounts_infos
                .iter()
                .position(|info: &AccountInfo| info.key() == queue_key)
            {
                pos as u8
            } else {
                let idx = queue_accounts_infos.len() as u8;
                queue_accounts_infos.push(queue_account.to_account_info());
                idx
            };
            queue_indices.push(queue_idx);
        }

        Ok((
            tree_account_infos,
            queue_accounts_infos,
            tree_indices,
            queue_indices,
        ))
    }

    fn collect_tlv_data(
        &self,
        source_compressed_token_accounts: &[CompressedTokenArgs],
        owner_index: u8,
        destination_token_account: &Pubkey,
    ) -> Vec<Vec<ExtensionInstructionData>> {
        let (_, ata_bump) = derive_token_ata(destination_token_account, self.mint.key);
        source_compressed_token_accounts
            .iter()
            .filter_map(|account| {
                account.tlv.as_ref().map(|extensions| {
                    extensions
                        .iter()
                        .filter_map(|ext| match ext {
                            ExtensionStruct::CompressedOnly(compressed_only) => {
                                Some(ExtensionInstructionData::CompressedOnly(
                                    CompressedOnlyExtensionInstructionData {
                                        delegated_amount: compressed_only.delegated_amount,
                                        withheld_transfer_fee: compressed_only
                                            .withheld_transfer_fee,
                                        is_frozen: account.is_frozen,
                                        compression_index: 0,
                                        is_ata: compressed_only.is_ata != 0,
                                        bump: ata_bump,
                                        owner_index,
                                    },
                                ))
                            }
                            _ => None,
                        })
                        .collect()
                })
            })
            .collect()
    }

    fn build_base_account_infos(
        &self,
        light_cpi_accounts: &CpiAccounts<'_, 'info>,
        tree_account_infos: Vec<AccountInfo<'info>>,
        queue_accounts_infos: Vec<AccountInfo<'info>>,
    ) -> Result<Vec<AccountInfo<'info>>> {
        let capacity = 7 + tree_account_infos.len() + queue_accounts_infos.len();
        let mut account_info = Vec::with_capacity(capacity);

        account_info.push(light_cpi_accounts.account_infos()[0].to_account_info());
        account_info.push(light_cpi_accounts.fee_payer().to_account_info());
        account_info.push(self.compressed_token_program_authority.to_account_info());
        account_info.push(
            light_cpi_accounts
                .registered_program_pda()
                .map_err(|_| MultisigError::LightCpiAccountError)?
                .to_account_info(),
        );
        account_info.push(
            light_cpi_accounts
                .account_compression_authority()
                .map_err(|_| MultisigError::LightCpiAccountError)?
                .to_account_info(),
        );
        account_info.push(
            light_cpi_accounts
                .account_compression_program()
                .map_err(|_| MultisigError::LightCpiAccountError)?
                .to_account_info(),
        );
        account_info.push(
            light_cpi_accounts
                .system_program()
                .map_err(|_| MultisigError::LightCpiAccountError)?
                .to_account_info(),
        );

        account_info.extend(tree_account_infos);
        account_info.extend(queue_accounts_infos);

        Ok(account_info)
    }

    fn create_ctoken_accounts(
        source_compressed_token_accounts: &[CompressedTokenArgs],
        tree_indices: &[u8],
        queue_indices: &[u8],
        tree_index_offset: usize,
        queue_index_offset: usize,
        mint_index: usize,
        owner_index: usize,
    ) -> Result<CTokenAccount2> {
        Ok(CTokenAccount2::new(
            source_compressed_token_accounts
                .iter()
                .enumerate()
                .map(|(index, f)| MultiInputTokenDataWithContext {
                    owner: owner_index as u8,
                    amount: f.amount,
                    has_delegate: f.has_delegate,
                    delegate: 0,
                    mint: mint_index as u8,
                    version: f.version,
                    merkle_context: PackedMerkleContext {
                        merkle_tree_pubkey_index: (tree_index_offset + tree_indices[index] as usize)
                            as u8,
                        queue_pubkey_index: (queue_index_offset + queue_indices[index] as usize)
                            as u8,
                        leaf_index: f.merkle_context.leaf_index,
                        prove_by_index: f.merkle_context.prove_by_index,
                    },
                    root_index: f.root_index,
                })
                .collect(),
        )
        .map_err(|_| MultisigError::LightCpiAccountError)?)
    }

    pub fn load_ata(
        &self,
        amount: u64,
        source_compressed_token_accounts: &Option<Vec<CompressedTokenArgs>>,
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

        let compressed_token_balance = source_compressed_token_accounts
            .as_ref()
            .map_or(0, |f| f.iter().map(|x| x.amount).sum());

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
            // If SPL+CToken still insufficient, decompress compressed into SPL
            if spl_balance.saturating_add(ctoken_balance) < amount {
                self.compressed_token_to_spl_transfer(
                    source_compressed_token_accounts,
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
                    source_compressed_token_accounts,
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
        source_compressed_token_accounts: &Option<Vec<CompressedTokenArgs>>,
        light_cpi_accounts: Option<&CpiAccounts<'_, 'info>>,
        compressed_proof_args: Option<&ProofArgs>,
        signer_seeds: &[&[u8]],
        spl_interface_pda_data: &Option<SplInterfacePda>,
        amount: u64,
        destination_spl_token_account: &AccountInfo<'info>,
    ) -> Result<()> {
        let light_cpi_accounts = light_cpi_accounts
            .as_ref()
            .ok_or(MultisigError::MissingLightCpiAccounts)?;
        let source_compressed_token_accounts = source_compressed_token_accounts
            .as_ref()
            .ok_or(MultisigError::MissingCompressedTokenAccount)?;

        let (tree_account_infos, queue_accounts_infos, tree_indices, queue_indices) =
            Self::extract_tree_and_queue_accounts(
                source_compressed_token_accounts,
                light_cpi_accounts,
            )?;

        let spl_interface_pda = self
            .spl_interface_pda
            .as_ref()
            .ok_or(MultisigError::MissingSplInterfacePda)?;
        let spl_interface_pda_data = spl_interface_pda_data
            .as_ref()
            .ok_or(MultisigError::MissingSplInterfacePda)?;

        let compressed_proof_args = compressed_proof_args
            .as_ref()
            .ok_or(MultisigError::MissingCompressedProofArgs)?;

        let mint_data = self.mint.data.borrow();
        let mint = Mint::try_deserialize(&mut mint_data.as_ref())?;

        // tree_count + queue_count + mint + owner + recipient + pool + token_program
        let capacity = tree_account_infos.len() + queue_accounts_infos.len() + 5;
        let mut packed_accounts = Vec::with_capacity(capacity);
        let tree_index_offset = packed_accounts.len();
        packed_accounts.extend(
            tree_account_infos
                .iter()
                .map(|f| AccountMeta::new(f.key(), false)),
        );
        let queue_index_offset = packed_accounts.len();
        packed_accounts.extend(
            queue_accounts_infos
                .iter()
                .map(|f| AccountMeta::new(f.key(), false)),
        );
        let mint_index = packed_accounts.len();
        packed_accounts.push(AccountMeta::new_readonly(self.mint.key(), false));
        let owner_index = packed_accounts.len();
        packed_accounts.push(AccountMeta::new_readonly(self.source.key(), true));
        let recipient_index = packed_accounts.len();
        packed_accounts.push(AccountMeta::new(destination_spl_token_account.key(), false));
        let pool_account_index = packed_accounts.len();
        packed_accounts.push(AccountMeta::new(spl_interface_pda.key(), false));
        packed_accounts.push(AccountMeta::new_readonly(self.token_program.key(), false));

        let mut token_accounts = Self::create_ctoken_accounts(
            source_compressed_token_accounts,
            &tree_indices,
            &queue_indices,
            tree_index_offset,
            queue_index_offset,
            mint_index,
            owner_index,
        )?;

        token_accounts
            .decompress_spl(
                amount,
                recipient_index as u8,
                pool_account_index as u8,
                spl_interface_pda_data.index,
                spl_interface_pda_data.bump,
                mint.decimals,
            )
            .map_err(|_| MultisigError::LightCpiAccountError)?;

        // Build account infos using helper
        let mut account_info = self.build_base_account_infos(
            light_cpi_accounts,
            tree_account_infos,
            queue_accounts_infos,
        )?;
        account_info.push(self.mint.to_account_info());
        account_info.push(self.source.to_account_info());
        account_info.push(destination_spl_token_account.to_account_info());
        account_info.push(spl_interface_pda.to_account_info());
        account_info.push(self.token_program.to_account_info());

        let in_tlv = self.collect_tlv_data(
            source_compressed_token_accounts,
            owner_index as u8,
            destination_spl_token_account.key,
        );

        let ix = create_transfer2_instruction(Transfer2Inputs {
            token_accounts: vec![token_accounts],
            validity_proof: ValidityProof(compressed_proof_args.proof),
            transfer_config: Transfer2Config::new(),
            meta_config: Transfer2AccountsMetaConfig::new(self.payer.key(), packed_accounts),
            in_lamports: None,
            out_lamports: None,
            output_queue: queue_index_offset as u8,
            in_tlv: if in_tlv.is_empty() {
                None
            } else {
                Some(in_tlv)
            },
        })
        .map_err(|_| MultisigError::LightCpiAccountError)?;

        invoke_signed(&ix, &account_info, &[signer_seeds])?;
        Ok(())
    }

    pub fn compressed_token_to_ctoken_transfer(
        &self,
        source_compressed_token_accounts: &Option<Vec<CompressedTokenArgs>>,
        light_cpi_accounts: Option<&CpiAccounts<'_, 'info>>,
        compressed_proof_args: Option<&ProofArgs>,
        signer_seeds: &[&[u8]],
        amount: u64,
        destination_ctoken_token_account: &AccountInfo<'info>,
    ) -> Result<()> {
        let light_cpi_accounts = light_cpi_accounts
            .as_ref()
            .ok_or(MultisigError::MissingLightCpiAccounts)?;
        let source_compressed_token_accounts = source_compressed_token_accounts
            .as_ref()
            .ok_or(MultisigError::MissingCompressedTokenAccount)?;

        let (tree_account_infos, queue_accounts_infos, tree_indices, queue_indices) =
            Self::extract_tree_and_queue_accounts(
                source_compressed_token_accounts,
                light_cpi_accounts,
            )?;

        let compressed_proof_args = compressed_proof_args
            .as_ref()
            .ok_or(MultisigError::MissingCompressedProofArgs)?;

        // tree_count + queue_count + mint + owner + recipient
        let capacity = tree_account_infos.len() + queue_accounts_infos.len() + 3;
        let mut packed_accounts = Vec::with_capacity(capacity);
        let tree_index_offset = packed_accounts.len();
        packed_accounts.extend(
            tree_account_infos
                .iter()
                .map(|f| AccountMeta::new(f.key(), false)),
        );
        let queue_index_offset = packed_accounts.len();
        packed_accounts.extend(
            queue_accounts_infos
                .iter()
                .map(|f| AccountMeta::new(f.key(), false)),
        );
        let mint_index = packed_accounts.len();
        packed_accounts.push(AccountMeta::new_readonly(self.mint.key(), false));
        let owner_index = packed_accounts.len();
        packed_accounts.push(AccountMeta::new_readonly(self.source.key(), true));
        let recipient_index = packed_accounts.len();
        packed_accounts.push(AccountMeta::new(
            destination_ctoken_token_account.key(),
            false,
        ));

        let mut token_accounts = Self::create_ctoken_accounts(
            source_compressed_token_accounts,
            &tree_indices,
            &queue_indices,
            tree_index_offset,
            queue_index_offset,
            mint_index,
            owner_index,
        )?;

        token_accounts
            .decompress(amount, recipient_index as u8)
            .map_err(|_| MultisigError::LightCpiAccountError)?;

        let mut account_info = self.build_base_account_infos(
            light_cpi_accounts,
            tree_account_infos,
            queue_accounts_infos,
        )?;
        account_info.push(self.mint.to_account_info());
        account_info.push(self.source.to_account_info());
        account_info.push(destination_ctoken_token_account.to_account_info());

        let in_tlv = self.collect_tlv_data(
            source_compressed_token_accounts,
            owner_index as u8,
            destination_ctoken_token_account.key,
        );

        let ix = create_transfer2_instruction(Transfer2Inputs {
            token_accounts: vec![token_accounts],
            validity_proof: ValidityProof(compressed_proof_args.proof),
            transfer_config: Transfer2Config::new(),
            meta_config: Transfer2AccountsMetaConfig::new(self.payer.key(), packed_accounts),
            in_lamports: None,
            out_lamports: None,
            output_queue: queue_index_offset as u8,
            in_tlv: if in_tlv.is_empty() {
                None
            } else {
                Some(in_tlv)
            },
        })
        .map_err(|_| MultisigError::LightCpiAccountError)?;

        invoke_signed(&ix, &account_info, &[signer_seeds])?;
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
        self.create_destination_ctoken_ata()?;

        let destination_token_account = self
            .destination_ctoken_token_account
            .ok_or(MultisigError::MissingCompressedTokenAccount)?;
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
        self.create_destination_ctoken_ata()?;

        let destination_token_account = self
            .destination_ctoken_token_account
            .ok_or(MultisigError::MissingCompressedTokenAccount)?;

        TransferCpi {
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
            .ok_or(MultisigError::MissingSplInterfacePda)?;
        let spl_interface_pda_data = spl_interface_pda_data
            .as_ref()
            .ok_or(MultisigError::MissingSplInterfacePda)?;
        let mint_data = self.mint.data.borrow();
        let mint = Mint::try_deserialize(&mut mint_data.as_ref())?;
        TransferToSplCpi {
            source: self.source_ctoken_token_account.to_account_info(),
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
            decimals: mint.decimals,
        }
        .invoke_signed(&[signer_seeds])?;

        Ok(())
    }

    pub fn create_destination_ctoken_ata(&self) -> Result<()> {
        let destination_ctoken_token_account = self
            .destination_ctoken_token_account
            .ok_or(MultisigError::MissingCompressedTokenAccount)?;
        let rent_sponsor = self
            .rent_sponsor
            .ok_or(MultisigError::MissingCompressedTokenAccount)?;
        let bump = self
            .destination_ctoken_bump
            .ok_or(MultisigError::MissingCompressedTokenAccount)?;

        CreateTokenAtaCpi {
            owner: self.destination.to_account_info(),
            mint: self.mint.to_account_info(),
            payer: self.payer.to_account_info(),
            ata: destination_ctoken_token_account.to_account_info(),
            bump,
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
}
