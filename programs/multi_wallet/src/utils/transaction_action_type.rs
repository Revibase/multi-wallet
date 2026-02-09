#[derive(PartialEq, Clone, Copy)]
pub enum TransactionActionType {
    Create,
    CreateWithPreauthorizedExecution,
    Execute,
    Vote,
    Sync,
    Close,
    Compress,
    Decompress,
    TransferIntent,
    ChangeDelegate,
    ChangeConfig,
}

impl TransactionActionType {
    pub fn to_bytes(&self) -> &[u8] {
        match &self {
            TransactionActionType::Create => b"create",
            TransactionActionType::CreateWithPreauthorizedExecution => {
                b"create_with_preauthorized_execution"
            }
            TransactionActionType::Execute => b"execute",
            TransactionActionType::Vote => b"vote",
            TransactionActionType::Sync => b"sync",
            TransactionActionType::Close => b"close",
            TransactionActionType::Compress => b"compress",
            TransactionActionType::Decompress => b"decompress",
            TransactionActionType::TransferIntent => b"transfer_intent",
            TransactionActionType::ChangeDelegate => b"change_delegate",
            TransactionActionType::ChangeConfig => b"change_config",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_to_bytes_matches_expected_strings() {
        assert_eq!(TransactionActionType::Create.to_bytes(), b"create");
        assert_eq!(
            TransactionActionType::CreateWithPreauthorizedExecution.to_bytes(),
            b"create_with_preauthorized_execution"
        );
        assert_eq!(TransactionActionType::Execute.to_bytes(), b"execute");
        assert_eq!(TransactionActionType::Vote.to_bytes(), b"vote");
        assert_eq!(TransactionActionType::Sync.to_bytes(), b"sync");
        assert_eq!(TransactionActionType::Close.to_bytes(), b"close");
        assert_eq!(TransactionActionType::Compress.to_bytes(), b"compress");
        assert_eq!(TransactionActionType::Decompress.to_bytes(), b"decompress");
        assert_eq!(
            TransactionActionType::TransferIntent.to_bytes(),
            b"transfer_intent"
        );
        assert_eq!(
            TransactionActionType::ChangeDelegate.to_bytes(),
            b"change_delegate"
        );
        assert_eq!(
            TransactionActionType::ChangeConfig.to_bytes(),
            b"change_config"
        );
    }
}
