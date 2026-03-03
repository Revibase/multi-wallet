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
use light_sdk::instruction::{PackedMerkleContext, PackedStateTreeInfo};
use light_token::compat::AccountState;
use light_token::instruction::{
    CreateTokenAtaCpi, TransferCpi, TransferFromSplCpi, TransferToSplCpi,
};
use light_token::spl_interface::derive_spl_interface_pda;
use light_token::spl_interface::{CreateSplInterfacePda, SplInterfacePda};
use light_token::utils::get_associated_token_address_and_bump;
use light_token::ExtensionInstructionData;
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
    pub state: AccountState,
}

#[derive(PartialEq)]
pub enum SourceType {
    CToken,
    Spl,
}

pub struct TokenTransfer<'a, 'info> {
    pub source: &'a AccountInfo<'info>,
    pub destination: &'a AccountInfo<'info>,
    pub mint: &'a AccountInfo<'info>,
    pub payer: &'a AccountInfo<'info>,
    pub delegate: Option<&'a AccountInfo<'info>>,
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
        source_compressed_token: &Option<CompressedTokenArgs>,
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

        let compressed_token_balance = source_compressed_token
            .as_ref()
            .map(|acc| acc.amount)
            .unwrap_or(0);

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
        source_compressed_token_account: &Option<CompressedTokenArgs>,
        light_cpi_accounts: Option<&CpiAccounts<'_, 'info>>,
        compressed_proof_args: Option<&ProofArgs>,
        signer_seeds: &[&[u8]],
    ) -> Result<()> {
        self.create_ctoken_ata(self.source, self.source_ctoken_token_account)?;

        let light_cpi_accounts = light_cpi_accounts
            .as_ref()
            .ok_or(MultisigError::MissingLightCpiAccounts)?;
        let source_compressed_token_account = source_compressed_token_account
            .as_ref()
            .ok_or(MultisigError::MissingCompressedTokenAccount)?;
        let compressed_proof_args = compressed_proof_args
            .as_ref()
            .ok_or(MultisigError::MissingCompressedProofArgs)?;

        let merkle_tree = light_cpi_accounts
            .get_tree_account_info(
                source_compressed_token_account
                    .merkle_context
                    .merkle_tree_pubkey_index as usize,
            )
            .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;

        let queue = light_cpi_accounts
            .get_tree_account_info(
                source_compressed_token_account
                    .merkle_context
                    .queue_pubkey_index as usize,
            )
            .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;

        // Build packed accounts
        // Note: Don't add system accounts here - Transfer2AccountsMetaConfig adds them
        let mut packed_accounts = Vec::new();

        // Insert merkle tree and queue to get their indices
        let merkle_tree_pubkey_index = packed_accounts.len() as u8;
        packed_accounts.push(AccountMeta::new(merkle_tree.key(), false));

        let queue_pubkey_index = packed_accounts.len() as u8;
        packed_accounts.push(AccountMeta::new(queue.key(), false));

        // Build PackedStateTreeInfo
        // prove_by_index is true if validity proof is None (no ZK proof)
        let prove_by_index = source_compressed_token_account
            .merkle_context
            .prove_by_index;
        let tree_info = PackedStateTreeInfo {
            merkle_tree_pubkey_index,
            queue_pubkey_index,
            leaf_index: source_compressed_token_account.merkle_context.leaf_index,
            root_index: source_compressed_token_account.root_index,
            prove_by_index,
        };
        // Check if this is an ATA decompress (is_ata flag in stored TLV)
        let is_ata = source_compressed_token_account
            .tlv
            .as_ref()
            .is_some_and(|exts| {
                exts.iter()
                    .any(|e| matches!(e, ExtensionStruct::CompressedOnly(co) if co.is_ata != 0))
            });

        // For ATA decompress, derive the bump from wallet owner + mint
        // The signer is the wallet owner for ATAs
        let ata_bump = if is_ata {
            let (_, bump) = get_associated_token_address_and_bump(self.source.key, self.mint.key);
            bump
        } else {
            0
        };

        let owner_index = packed_accounts.len() as u8;
        packed_accounts.push(AccountMeta::new_readonly(self.source.key(), true));
        let delegate_index = if let Some(delegate) = self.delegate {
            let delegate_index = packed_accounts.len() as u8;
            packed_accounts.push(AccountMeta::new(delegate.key(), false));
            delegate_index
        } else {
            0
        };
        let mint_index = packed_accounts.len() as u8;
        packed_accounts.push(AccountMeta::new(self.source.key(), false));
        let destination_index = packed_accounts.len() as u8;
        packed_accounts.push(AccountMeta::new(
            self.source_ctoken_token_account.key(),
            false,
        ));

        // Convert TLV extensions from state format to instruction format
        let is_frozen = source_compressed_token_account.state == AccountState::Frozen;
        let tlv: Option<Vec<ExtensionInstructionData>> = source_compressed_token_account
            .tlv
            .as_ref()
            .map(|extensions| {
                extensions
                    .iter()
                    .filter_map(|ext| match ext {
                        ExtensionStruct::CompressedOnly(compressed_only) => {
                            Some(ExtensionInstructionData::CompressedOnly(
                                CompressedOnlyExtensionInstructionData {
                                    delegated_amount: compressed_only.delegated_amount,
                                    withheld_transfer_fee: compressed_only.withheld_transfer_fee,
                                    is_frozen,
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
            });

        // Clone tlv for passing to Transfer2Inputs.in_tlv
        let in_tlv = tlv.clone().map(|t| vec![t]);
        let source = MultiInputTokenDataWithContext {
            owner: owner_index,
            amount: source_compressed_token_account.amount,
            has_delegate: self.delegate.is_some(),
            delegate: delegate_index,
            mint: mint_index,
            version: source_compressed_token_account.version,
            merkle_context: PackedMerkleContext {
                merkle_tree_pubkey_index: tree_info.merkle_tree_pubkey_index,
                queue_pubkey_index: tree_info.queue_pubkey_index,
                prove_by_index: tree_info.prove_by_index,
                leaf_index: tree_info.leaf_index,
            },
            root_index: tree_info.root_index,
        };

        // Build CTokenAccount2 with decompress operation
        let mut token_account =
            CTokenAccount2::new(vec![source]).map_err(|_| ProgramError::InvalidAccountData)?;
        token_account
            .decompress(source_compressed_token_account.amount, destination_index)
            .map_err(|_| ProgramError::InvalidAccountData)?;

        // Build instruction inputs
        let meta_config = Transfer2AccountsMetaConfig::new(self.payer.key(), packed_accounts);
        let transfer_config = Transfer2Config::default().filter_zero_amount_outputs();

        let inputs = Transfer2Inputs {
            meta_config,
            token_accounts: vec![token_account],
            transfer_config,
            validity_proof: light_token::ValidityProof(compressed_proof_args.proof),
            in_tlv,
            ..Default::default()
        };

        let ix = create_transfer2_instruction(inputs).map_err(ProgramError::from)?;

        let mut account_info = Vec::new();
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

        account_info.push(merkle_tree.to_account_info());
        account_info.push(queue.to_account_info());
        account_info.push(self.source.to_account_info());
        if self.delegate.is_some() {
            account_info.push(self.delegate.unwrap().to_account_info());
        }
        account_info.push(self.mint.to_account_info());
        account_info.push(self.source_ctoken_token_account.to_account_info());

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
}
