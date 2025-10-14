use crate::{
    error::MultisigError,
    state::{MemberKey, SEED_DELEGATE_EXTENSION},
    ID,
};
use anchor_lang::{
    prelude::*,
    system_program::{create_account, CreateAccount},
};

#[account(zero_copy)]
pub struct DelegateExtensions {
    pub authority: Pubkey,
    pub api_url_len: u16,
    pub api_url: [u8; 512],
    pub _reserved: [u8; 512],
}

impl DelegateExtensions {
    pub fn size() -> usize {
        return 8 + 32 + 2 + 512 + 512;
    }

    pub fn initialize<'a>(
        api_url: String,
        member: &Pubkey,
        remaining_accounts: &'a [AccountInfo<'a>],
        payer: &Signer<'a>,
        system_program: &Program<'a, System>,
    ) -> Result<()> {
        let member_key = MemberKey::convert_ed25519(&member)?;
        let member_key = member_key;
        let member_seed = member_key.get_seed()?;
        let (delegate_extension_key, bump) =
            Pubkey::find_program_address(&[SEED_DELEGATE_EXTENSION, member_seed.as_ref()], &ID);
        let delegate_extension_account = remaining_accounts
            .iter()
            .find(|f| f.key.eq(&delegate_extension_key))
            .ok_or(MultisigError::MissingAccount)?;
        let signer_seed: &[&[u8]] = &[SEED_DELEGATE_EXTENSION, member_seed.as_ref(), &[bump]];

        create_account(
            CpiContext::new_with_signer(
                system_program.to_account_info(),
                CreateAccount {
                    from: payer.to_account_info(),
                    to: delegate_extension_account.to_account_info(),
                },
                &[signer_seed],
            ),
            Rent::get()?.minimum_balance(DelegateExtensions::size()),
            DelegateExtensions::size().try_into().unwrap(),
            &ID,
        )?;
        let mut data = delegate_extension_account.try_borrow_mut_data()?;

        let mut cursor = 0;
        data[cursor..cursor + DelegateExtensions::DISCRIMINATOR.len()]
            .copy_from_slice(DelegateExtensions::DISCRIMINATOR);
        cursor += DelegateExtensions::DISCRIMINATOR.len();

        data[cursor..cursor + 32].copy_from_slice(&member.to_bytes());
        cursor += 32;

        let api_url_bytes = api_url.as_bytes();
        let api_url_len = api_url_bytes.len() as u16;

        data[cursor..cursor + 2].copy_from_slice(&api_url_len.to_le_bytes());
        cursor += 2;

        data[cursor..cursor + api_url_bytes.len()].copy_from_slice(api_url_bytes);

        Ok(())
    }

    pub fn write_api_url(&mut self, api_url: String) -> Result<()> {
        let url_bytes = api_url.as_bytes();
        let url_len = url_bytes.len();

        if url_len > 512 {
            return err!(MultisigError::MaxLengthExceeded);
        }

        self.api_url_len = url_len as u16;

        self.api_url[0..url_len].copy_from_slice(url_bytes);

        for i in url_len..512 {
            self.api_url[i] = 0;
        }

        Ok(())
    }

    pub fn extract_delegate_extension<'a>(
        member_key: MemberKey,
        remaining_accounts: &'a [AccountInfo<'a>],
    ) -> Result<AccountLoader<'a, DelegateExtensions>> {
        let (delegate_extension_key, _) = Pubkey::find_program_address(
            &[SEED_DELEGATE_EXTENSION, member_key.get_seed()?.as_ref()],
            &ID,
        );

        let delegate_extension = remaining_accounts
            .iter()
            .find(|f| f.key.eq(&delegate_extension_key))
            .ok_or(MultisigError::MissingAccount)?;

        let delegate_extension_loader: AccountLoader<'_, DelegateExtensions> =
            AccountLoader::<DelegateExtensions>::try_from(&delegate_extension)?;
        Ok(delegate_extension_loader)
    }
}
