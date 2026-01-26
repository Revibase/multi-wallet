use anchor_lang::prelude::*;

#[derive(AnchorDeserialize, AnchorSerialize, PartialEq, Debug)]
pub enum Transports {
    Ble,
    Cable,
    Hybrid,
    Internal,
    Nfc,
    SmartCard,
    Usb,
}
