use anchor_lang::{
    prelude::*,
    solana_program::{instruction::Instruction, program::invoke_signed},
};
use light_sdk::constants::C_TOKEN_PROGRAM_ID;

pub struct TransferCToken {
    pub source: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
    pub authority: Pubkey,
    pub system_program: Pubkey,
    /// Maximum lamports for rent and top-up combined. Transaction fails if exceeded. (0 = no limit)
    /// When set to a non-zero value, includes max_top_up in instruction data
    pub max_top_up: Option<u16>,
}

pub struct TransferCTokenCpi<'info> {
    pub source: AccountInfo<'info>,
    pub destination: AccountInfo<'info>,
    pub amount: u64,
    pub authority: AccountInfo<'info>,
    pub system_program: AccountInfo<'info>,
    /// Maximum lamports for rent and top-up combined. Transaction fails if exceeded. (0 = no limit)
    pub max_top_up: Option<u16>,
}

impl<'info> TransferCTokenCpi<'info> {
    pub fn invoke_signed(self, signer_seeds: &[&[&[u8]]]) -> Result<()> {
        let instruction = TransferCToken::from(&self).instruction()?;
        let account_infos = [
            self.source,
            self.destination,
            self.authority,
            self.system_program,
        ];
        invoke_signed(&instruction, &account_infos, signer_seeds)?;
        Ok(())
    }
}

impl<'info> From<&TransferCTokenCpi<'info>> for TransferCToken {
    fn from(account_infos: &TransferCTokenCpi<'info>) -> Self {
        Self {
            source: *account_infos.source.key,
            destination: *account_infos.destination.key,
            amount: account_infos.amount,
            authority: *account_infos.authority.key,
            system_program: *account_infos.system_program.key,
            max_top_up: account_infos.max_top_up,
        }
    }
}

impl TransferCToken {
    pub fn instruction(self) -> Result<Instruction> {
        Ok(Instruction {
            program_id: Pubkey::from(C_TOKEN_PROGRAM_ID),
            accounts: vec![
                AccountMeta::new(self.source, false),
                AccountMeta::new(self.destination, false),
                AccountMeta::new_readonly(self.authority, true),
                AccountMeta::new_readonly(self.system_program, false),
            ],
            data: {
                let mut data = vec![3u8];
                data.extend_from_slice(&self.amount.to_le_bytes());
                // Include max_top_up if set (10-byte format)
                if let Some(max_top_up) = self.max_top_up {
                    data.extend_from_slice(&max_top_up.to_le_bytes());
                }
                data
            },
        })
    }
}
