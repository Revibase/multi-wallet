#[derive(PartialEq)]
pub enum TransactionActionType {
    Create,
    CreateWithPermissionlessExecution,
    Execute,
    Vote,
    Sync,
    Close,
    AddNewMember,
    Compress,
    Decompress,
    TransferIntent,
}

impl TransactionActionType {
    pub fn to_bytes(&self) -> &[u8] {
        match &self {
            TransactionActionType::Create => b"create",
            TransactionActionType::CreateWithPermissionlessExecution => {
                b"create_with_permissionless_execution"
            }
            TransactionActionType::Execute => b"execute",
            TransactionActionType::Vote => b"vote",
            TransactionActionType::Sync => b"sync",
            TransactionActionType::Close => b"close",
            TransactionActionType::AddNewMember => b"add_new_member",
            TransactionActionType::Compress => b"compress",
            TransactionActionType::Decompress => b"decompress",
            TransactionActionType::TransferIntent => b"transfer_intent",
        }
    }
}
