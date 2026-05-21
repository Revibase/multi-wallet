import {
  address,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Decoder,
  getTransactionEncoder,
  getU32Decoder,
  getU32Encoder,
  type Address,
  type ReadonlyUint8Array,
  type SignatureBytes,
  type TransactionSigner,
} from "gill";
import {
  NetworkError,
  NotFoundError,
  PermissionError,
  ValidationError,
} from "../../errors";
import {
  getConfigActionDecoder,
  getConfigActionEncoder,
  UserRole,
  type ConfigAction,
  type MemberKey,
  type Settings,
} from "../../generated";
import {
  KeyType,
  Permission,
  Permissions,
  type TransactionAuthDetails,
} from "../../types";

export function retrieveTransactionManager(
  signer: string,
  settingsData: Settings,
): {
  transactionManagerAddress: Address;
} | null {
  if (settingsData.threshold > 1) {
    throw new ValidationError(
      "Multi-signature transactions with threshold > 1 are not supported yet.",
    );
  }
  const member = settingsData.members.find(
    (m) => convertMemberKeyToString(m.pubkey) === signer,
  );
  if (!member) {
    throw new NotFoundError("Member", `Signer ${signer} not found in settings`);
  }

  const { permissions } = member;
  if (!permissions) {
    throw new NotFoundError(
      "Permissions",
      "No permissions found for the current member",
    );
  }
  const hasInitiate = Permissions.has(
    permissions,
    Permission.InitiateTransaction,
  );
  const hasVote = Permissions.has(permissions, Permission.VoteTransaction);
  const hasExecute = Permissions.has(
    permissions,
    Permission.ExecuteTransaction,
  );
  if (hasInitiate && hasVote && hasExecute) {
    return null;
  }

  if (!hasVote || !hasExecute) {
    throw new PermissionError(
      "Signer lacks the required Vote/Execute permissions.",
      ["VoteTransaction", "ExecuteTransaction"],
      [
        hasVote ? "VoteTransaction" : undefined,
        hasExecute ? "ExecuteTransaction" : undefined,
      ].filter(Boolean) as string[],
    );
  }

  const transactionManager = settingsData.members.find(
    (m) => m.role === UserRole.TransactionManager,
  );
  if (!transactionManager) {
    throw new NotFoundError(
      "Transaction manager",
      "No transaction manager available in wallet",
    );
  }

  return {
    transactionManagerAddress: address(
      convertMemberKeyToString(transactionManager.pubkey),
    ),
  };
}

function toWebSocketUrl(httpUrl: string) {
  const u = new URL(httpUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}

function openWebSocket(url: string, signal: AbortSignal): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);

    const abort = () => {
      try {
        ws.close();
      } catch {}
    };

    signal.addEventListener("abort", abort, { once: true });

    ws.onopen = () => {
      signal.removeEventListener("abort", abort);
      resolve(ws);
    };

    ws.onerror = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("WebSocket connection failed"));
    };
  });
}

async function readEvents(
  ws: WebSocket,
  signal: AbortSignal,
  onEvent: (event: string, data: any) => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;

    const cleanup = () => {
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("close", onClose);
      signal.removeEventListener("abort", onAbort);
    };

    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      cleanup();
      fn();
    };

    const onAbort = () => {
      try {
        ws.close();
      } catch {}
    };

    const onMessage = (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return;

      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }

      const event = msg.event ?? "message";

      try {
        if (onEvent(event, msg.data)) {
          finish(resolve);
        }
      } catch (e) {
        finish(() => reject(e));
      }
    };

    const onError = () =>
      finish(() =>
        reject(
          new NetworkError("Transaction manager request failed", 0, ws.url),
        ),
      );

    const onClose = () => finish(resolve);

    signal.addEventListener("abort", onAbort, { once: true });
    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);
  });
}

const abortErr = () => {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortErr());

    const id = setTimeout(resolve, ms);

    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(abortErr());
      },
      { once: true },
    );
  });

export function createTransactionManagerSigner(args: {
  address: Address;
  url: string;
  authResponses?: TransactionAuthDetails[];
  transactionMessageBytes?: ReadonlyUint8Array;
  onPendingApprovalsCallback?: (validTill: number) => void;
  onPendingApprovalsSuccess?: () => void;
  abortController?: AbortController;
  opts?: { maxAttempts?: number; retryDelayMs?: number };
}): TransactionSigner {
  const {
    address,
    url,
    authResponses,
    transactionMessageBytes,
    onPendingApprovalsCallback,
    onPendingApprovalsSuccess,
    abortController,
    opts,
  } = args;

  const signal = abortController?.signal ?? new AbortController().signal;
  const wsUrl = toWebSocketUrl(url);

  const maxAttempts = opts?.maxAttempts ?? 10;
  const retryDelayMs = opts?.retryDelayMs ?? 400;

  return {
    address,
    async signTransactions(transactions) {
      if (signal.aborted) throw abortErr();

      const payloadItems = new Array(transactions.length);

      for (let i = 0; i < transactions.length; i++) {
        payloadItems[i] = {
          transaction: getBase64Decoder().decode(
            getTransactionEncoder().encode(transactions[i]),
          ),
          transactionMessageBytes: transactionMessageBytes
            ? getBase64Decoder().decode(transactionMessageBytes)
            : undefined,
          authResponses,
        };
      }

      const payload = JSON.stringify({
        type: "transaction",
        data: {
          publicKey: address.toString(),
          payload: payloadItems,
        },
      });

      for (let i = 0; i < maxAttempts; i++) {
        if (signal.aborted) throw abortErr();

        let ws: WebSocket | undefined;
        let signatures: string[] | undefined;

        try {
          ws = await openWebSocket(wsUrl, signal);
          ws.send(payload);

          await readEvents(ws, signal, (event, data) => {
            if (event === "error") {
              const errMsg =
                typeof data === "object" &&
                data &&
                typeof (data as any).error === "string"
                  ? (data as any).error
                  : "Unknown error";

              const err: any = new Error(errMsg);
              err.noRetry = true;
              throw err;
            }

            if (event === "signatures") {
              signatures = (data as any).signatures;
              return true;
            }

            if (event === "pending_transaction_approval") {
              onPendingApprovalsCallback?.((data as any).validTill);
            }

            if (event === "transaction_approved") {
              onPendingApprovalsSuccess?.();
            }

            return false;
          });
        } catch (e: any) {
          if (e?.noRetry) throw new NetworkError(e.message);
          if (e?.name === "AbortError") throw e;
        } finally {
          try {
            ws?.close();
          } catch {}
        }

        if (signatures?.length) {
          return signatures.map((sig) => ({
            [address]: getBase58Encoder().encode(sig) as SignatureBytes,
          }));
        }

        if (i < maxAttempts - 1) {
          await sleep(retryDelayMs, signal);
        }
      }

      throw new NetworkError("Transaction manager: missing signatures");
    },
  };
}

export function convertMemberKeyToString(memberKey: MemberKey): string {
  if (memberKey.keyType === KeyType.Ed25519) {
    return getBase58Decoder().decode(memberKey.key.subarray(1, 33));
  } else {
    return getBase58Decoder().decode(memberKey.key);
  }
}

export function serializeConfigActions(
  configActions: ConfigAction[],
): Uint8Array<ArrayBuffer> {
  const encodedActions = configActions.map((x) =>
    getConfigActionEncoder().encode(x),
  );

  const totalLength = 4 + encodedActions.reduce((sum, a) => sum + a.length, 0);

  const serializedConfigActions = new Uint8Array(totalLength);

  let offset = 0;

  serializedConfigActions.set(
    getU32Encoder().encode(configActions.length),
    offset,
  );
  offset += 4;

  for (const action of encodedActions) {
    serializedConfigActions.set(action, offset);
    offset += action.length;
  }

  return serializedConfigActions;
}

export function deserializeConfigActions(
  bytes: Uint8Array<ArrayBuffer>,
): ConfigAction[] {
  let offset = 0;
  const [count, u32offset] = getU32Decoder().read(bytes, offset);
  offset = u32offset;

  const out: ConfigAction[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const r = getConfigActionDecoder().read(bytes, offset);
    out[i] = r[0];
    offset = r[1];
  }

  if (offset !== bytes.length) {
    throw new ValidationError(
      `Trailing bytes detected: expected ${bytes.length} bytes but consumed ${offset}`,
    );
  }
  return out;
}
