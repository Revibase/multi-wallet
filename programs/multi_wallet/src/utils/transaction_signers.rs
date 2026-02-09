use anchor_lang::prelude::*;

use crate::{
    durable_nonce_check,
    error::MultisigError,
    state::ExpectedSigner,
    utils::{ChallengeArgs, Member, MemberKey, Secp256r1VerifyArgs},
    DomainConfig, Permission, TransactionActionType,
};

#[derive(AnchorDeserialize, AnchorSerialize)]
pub enum TransactionSyncSigners {
    Ed25519(u8),
    Secp256r1(Secp256r1VerifyArgsWithDomainConfigIndex),
}

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct Secp256r1VerifyArgsWithDomainConfigIndex {
    pub verify_args: Secp256r1VerifyArgs,
    pub domain_config_index: u8,
}

impl TransactionSyncSigners {
    pub fn resolve<'a, 'info>(
        signers: &'a [TransactionSyncSigners],
        remaining_accounts: &'info [AccountInfo<'info>],
        instructions_sysvar: &UncheckedAccount<'info>,
    ) -> Result<
        Vec<(
            MemberKey,
            Option<&'a Secp256r1VerifyArgsWithDomainConfigIndex>,
        )>,
    > {
        signers
            .iter()
            .map(|s| {
                Ok(match s {
                    TransactionSyncSigners::Ed25519(index) => {
                        let account = remaining_accounts
                            .get(*index as usize)
                            .ok_or(MultisigError::InvalidNumberOfAccounts)?;
                        require!(account.is_signer, MultisigError::NoSignerFound);
                        let member_key = MemberKey::convert_ed25519(account.key)
                            .map_err(|_| MultisigError::InvalidAccount)?;
                        (member_key, None)
                    }
                    TransactionSyncSigners::Secp256r1(args) => {
                        let pubkey = args
                            .verify_args
                            .extract_public_key_from_instruction(Some(instructions_sysvar))
                            .map_err(|_| MultisigError::InvalidAccount)?;
                        let member_key = MemberKey::convert_secp256r1(&pubkey)
                            .map_err(|_| MultisigError::InvalidAccount)?;
                        (member_key, Some(args))
                    }
                })
            })
            .collect::<Result<Vec<_>>>()
    }

    pub fn collect_slot_numbers(signers: &[TransactionSyncSigners]) -> Vec<u64> {
        signers
            .iter()
            .filter_map(|s| {
                if let TransactionSyncSigners::Secp256r1(args) = s {
                    Some(args.verify_args.slot_number)
                } else {
                    None
                }
            })
            .collect()
    }

    pub fn verify<'info>(
        signers: &[TransactionSyncSigners],
        remaining_accounts: &'info [AccountInfo<'info>],
        instructions_sysvar: &UncheckedAccount<'info>,
        slot_hash_sysvar: &Option<UncheckedAccount<'info>>,
        members: &[Member],
        threshold: u8,
        challenge_account: Pubkey,
        message_hash: [u8; 32],
        action_type: TransactionActionType,
    ) -> Result<()> {
        durable_nonce_check(instructions_sysvar)?;

        let mut initiate = false;
        let mut execute = false;
        let mut vote_count = 0u32;
        let mut are_delegates = true;

        let signer_member_keys = Self::resolve(signers, remaining_accounts, instructions_sysvar)?;

        for (signer, signer_args) in &signer_member_keys {
            let member = members
                .iter()
                .find(|m| m.pubkey.eq(signer))
                .ok_or(MultisigError::UnexpectedSigner)?;

            let has_permission = |perm| member.permissions.has(perm);

            if has_permission(Permission::InitiateTransaction) {
                initiate = true;
            }
            if has_permission(Permission::ExecuteTransaction) {
                execute = true;
            }
            if has_permission(Permission::VoteTransaction) {
                vote_count += 1;
            }
            if signer_args.is_some() && member.is_delegate == 0 {
                are_delegates = false;
            }

            if let Some(secp256r1_verify_data) = signer_args {
                let account_loader = DomainConfig::extract_domain_config_account(
                    remaining_accounts,
                    secp256r1_verify_data.domain_config_index,
                )?;

                secp256r1_verify_data.verify_args.verify_webauthn(
                    slot_hash_sysvar,
                    &Some(account_loader),
                    instructions_sysvar,
                    ChallengeArgs {
                        account: challenge_account,
                        message_hash,
                        action_type,
                    },
                    &[],
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
            vote_count >= threshold as u32,
            MultisigError::InsufficientSignersWithVotePermission
        );

        if action_type.eq(&TransactionActionType::TransferIntent) {
            require!(are_delegates, MultisigError::InvalidNonDelegatedSigners);
        }

        Ok(())
    }
}

pub struct TransactionBufferSigners;

impl TransactionBufferSigners {
    pub fn verify_create<'info>(
        signer: &Option<Signer<'info>>,
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
        instructions_sysvar: &UncheckedAccount<'info>,
        slot_hash_sysvar: &Option<UncheckedAccount<'info>>,
        domain_config: &Option<AccountLoader<'info, DomainConfig>>,
        members: &[Member],
        settings_key: Pubkey,
        message_hash: [u8; 32],
        preauthorize_execution: bool,
    ) -> Result<()> {
        durable_nonce_check(instructions_sysvar)?;
        let member_key =
            MemberKey::get_signer(signer, secp256r1_verify_args, Some(instructions_sysvar))?;

        let member = members
            .iter()
            .find(|m| m.pubkey.eq(&member_key))
            .ok_or(MultisigError::MemberNotFound)?;

        require!(
            member.permissions.has(Permission::InitiateTransaction),
            MultisigError::InsufficientSignerWithInitiatePermission
        );

        if preauthorize_execution {
            require!(
                member.permissions.has(Permission::ExecuteTransaction),
                MultisigError::InsufficientSignerWithExecutePermission
            );
        }

        if let Some(secp256r1_verify_data) = secp256r1_verify_args {
            secp256r1_verify_data.verify_webauthn(
                slot_hash_sysvar,
                domain_config,
                instructions_sysvar,
                ChallengeArgs {
                    account: settings_key,
                    message_hash,
                    action_type: if preauthorize_execution {
                        TransactionActionType::CreateWithPreauthorizedExecution
                    } else {
                        TransactionActionType::Create
                    },
                },
                &[],
            )?;
        }

        Ok(())
    }

    pub fn verify_vote<'info>(
        signer: &Option<Signer<'info>>,
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
        instructions_sysvar: &Option<UncheckedAccount<'info>>,
        slot_hash_sysvar: &Option<UncheckedAccount<'info>>,
        domain_config: &Option<AccountLoader<'info, DomainConfig>>,
        members: &[Member],
        settings_key: Pubkey,
        message_hash: [u8; 32],
        expected_signers: &[ExpectedSigner],
    ) -> Result<()> {
        let instructions_sysvar = instructions_sysvar
            .as_ref()
            .ok_or(MultisigError::MissingInstructionsSysvar)?;

        let member_key =
            MemberKey::get_signer(signer, secp256r1_verify_args, Some(instructions_sysvar))?;

        let member = members
            .iter()
            .find(|m| m.pubkey.eq(&member_key))
            .ok_or(MultisigError::MemberNotFound)?;

        require!(
            member.permissions.has(Permission::VoteTransaction),
            MultisigError::InsufficientSignersWithVotePermission
        );

        if let Some(secp256r1_verify_data) = secp256r1_verify_args {
            secp256r1_verify_data.verify_webauthn(
                slot_hash_sysvar,
                domain_config,
                instructions_sysvar,
                ChallengeArgs {
                    account: settings_key,
                    message_hash,
                    action_type: TransactionActionType::Vote,
                },
                expected_signers,
            )?;
        } else {
            require!(
                expected_signers
                    .iter()
                    .any(|f| f.member_key.eq(&member_key)),
                MultisigError::UnexpectedSigner
            );
        }

        Ok(())
    }

    pub fn verify_execute<'info>(
        signer: &Option<Signer<'info>>,
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
        instructions_sysvar: &Option<UncheckedAccount<'info>>,
        slot_hash_sysvar: &Option<UncheckedAccount<'info>>,
        domain_config: &Option<AccountLoader<'info, DomainConfig>>,
        members: &[Member],
        threshold: u8,
        settings_key: Pubkey,
        message_hash: [u8; 32],
        voters: &[MemberKey],
        expected_signers: &[ExpectedSigner],
    ) -> Result<()> {
        let instructions_sysvar = instructions_sysvar
            .as_ref()
            .ok_or(MultisigError::MissingInstructionsSysvar)?;

        let member_key =
            MemberKey::get_signer(signer, secp256r1_verify_args, Some(instructions_sysvar))?;

        let member = members
            .iter()
            .find(|m| m.pubkey.eq(&member_key))
            .ok_or(MultisigError::MemberNotFound)?;

        require!(
            member.permissions.has(Permission::ExecuteTransaction),
            MultisigError::InsufficientSignerWithExecutePermission
        );

        let vote_count = members
            .iter()
            .filter(|m| {
                m.permissions.has(Permission::VoteTransaction)
                    && (voters.contains(&m.pubkey) || member_key.eq(&m.pubkey))
            })
            .count();

        require!(
            vote_count >= threshold as usize,
            MultisigError::InsufficientSignersWithVotePermission
        );

        if let Some(secp256r1_verify_data) = secp256r1_verify_args {
            secp256r1_verify_data.verify_webauthn(
                slot_hash_sysvar,
                domain_config,
                instructions_sysvar,
                ChallengeArgs {
                    account: settings_key,
                    message_hash,
                    action_type: TransactionActionType::Execute,
                },
                expected_signers,
            )?;
        } else {
            require!(
                expected_signers
                    .iter()
                    .any(|f| f.member_key.eq(&member_key)),
                MultisigError::UnexpectedSigner
            );
        };

        Ok(())
    }

    pub fn verify_close<'info>(
        signer: &Option<Signer<'info>>,
        secp256r1_verify_args: &Option<Secp256r1VerifyArgs>,
        instructions_sysvar: &Option<UncheckedAccount<'info>>,
        slot_hash_sysvar: &Option<UncheckedAccount<'info>>,
        domain_config: &Option<AccountLoader<'info, DomainConfig>>,
        creator: &MemberKey,
        payer: &Pubkey,
        settings_key: Pubkey,
        message_hash: [u8; 32],
        valid_till: u64,
    ) -> Result<()> {
        let instructions_sysvar = instructions_sysvar
            .as_ref()
            .ok_or(MultisigError::MissingInstructionsSysvar)?;

        let member_key =
            MemberKey::get_signer(signer, secp256r1_verify_args, Some(instructions_sysvar))?;

        // Allow rent payer to become the closer after transaction has expired
        let is_rent_payer_after_expiry = Clock::get()?.unix_timestamp as u64 > valid_till
            && signer.is_some()
            && MemberKey::convert_ed25519(payer)?.eq(&member_key);

        if !is_rent_payer_after_expiry {
            require!(
                creator.eq(&member_key),
                MultisigError::UnauthorisedToCloseTransactionBuffer
            );

            if let Some(secp256r1_verify_data) = secp256r1_verify_args {
                secp256r1_verify_data.verify_webauthn(
                    slot_hash_sysvar,
                    domain_config,
                    instructions_sysvar,
                    ChallengeArgs {
                        account: settings_key,
                        message_hash,
                        action_type: TransactionActionType::Close,
                    },
                    &[],
                )?;
            }
        }
        Ok(())
    }

    pub fn collect_slot_numbers(secp256r1_verify_args: &Option<Secp256r1VerifyArgs>) -> Vec<u64> {
        if let Some(args) = secp256r1_verify_args {
            vec![args.slot_number]
        } else {
            vec![]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_secp256r1_args(slot_number: u64) -> Secp256r1VerifyArgs {
        Secp256r1VerifyArgs {
            signed_message_index: 0,
            slot_number,
            origin_index: 0,
            cross_origin: false,
            truncated_client_data_json: vec![],
            client_and_device_hash: [0u8; 32],
        }
    }

    #[test]
    fn test_transaction_buffer_signers_collect_slot_numbers_none() {
        let result = TransactionBufferSigners::collect_slot_numbers(&None);
        assert!(result.is_empty());
    }

    #[test]
    fn test_transaction_buffer_signers_collect_slot_numbers_some() {
        let args = make_secp256r1_args(12345);
        let result = TransactionBufferSigners::collect_slot_numbers(&Some(args));
        assert_eq!(result, vec![12345]);
    }

    #[test]
    fn test_transaction_sync_signers_collect_slot_numbers_ed25519_only() {
        let signers = vec![
            TransactionSyncSigners::Ed25519(0),
            TransactionSyncSigners::Ed25519(1),
        ];
        let result = TransactionSyncSigners::collect_slot_numbers(&signers);
        assert!(result.is_empty());
    }

    #[test]
    fn test_transaction_sync_signers_collect_slot_numbers_mixed() {
        let signers = vec![
            TransactionSyncSigners::Ed25519(0),
            TransactionSyncSigners::Secp256r1(Secp256r1VerifyArgsWithDomainConfigIndex {
                verify_args: make_secp256r1_args(100),
                domain_config_index: 0,
            }),
            TransactionSyncSigners::Secp256r1(Secp256r1VerifyArgsWithDomainConfigIndex {
                verify_args: make_secp256r1_args(200),
                domain_config_index: 1,
            }),
        ];
        let result = TransactionSyncSigners::collect_slot_numbers(&signers);
        assert_eq!(result, vec![100, 200]);
    }
}
