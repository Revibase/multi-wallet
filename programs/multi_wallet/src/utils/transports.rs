use anchor_lang::prelude::*;

#[derive(AnchorDeserialize, AnchorSerialize, PartialEq, Debug, Clone)]
pub enum Transports {
    Ble,
    Cable,
    Hybrid,
    Internal,
    Nfc,
    SmartCard,
    Usb,
}
