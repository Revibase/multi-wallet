#[derive(PartialEq)]
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
