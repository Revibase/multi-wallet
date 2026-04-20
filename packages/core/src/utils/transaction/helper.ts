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
  type CompressedSettingsData,
  type ConfigAction,
  type MemberKey,
} from "../../generated";
import {
  KeyType,
  Permission,
  Permissions,
  type TransactionAuthDetails,
} from "../../types";

export function retrieveTransactionManager(
  signer: string,
  settingsData: CompressedSettingsData & {
    isCompressed: boolean;
  },
): {
  transactionManagerAddress: Address;
  userAddressTreeIndex: number;
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
    userAddressTreeIndex: transactionManager.userAddressTreeIndex,
  };
}

function toWebSocketUrl(httpUrl: string): string {
  const u = new URL(httpUrl);
  if (u.protocol === "https:") u.protocol = "wss:";
  else if (u.protocol === "http:") u.protocol = "ws:";
  return u.toString();
}

function openWebSocket(url: string, signal: AbortSignal): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);

    const onAbort = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });

    ws.onopen = () => {
      signal.removeEventListener("abort", onAbort);
      resolve(ws);
    };
    ws.onerror = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error("WebSocket connection failed"));
    };
  });
}

async function readWebSocketJsonEvents(
  ws: WebSocket,
  signal: AbortSignal,
  onEvent: (event: string, data: any) => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("close", onClose);
    };

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const onAbort = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
    signal.addEventListener("abort", onAbort);

    const onMessage = (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return;
      let parsed: { event?: string; data?: unknown };
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        return;
      }
      const event = typeof parsed.event === "string" ? parsed.event : "message";
      const data = parsed.data;
      try {
        if (onEvent(event, data)) {
          finish(() => resolve());
        }
      } catch (e) {
        finish(() => reject(e));
      }
    };

    const onError = () => {
      finish(() =>
        reject(
          new NetworkError("Transaction manager request failed", 0, ws.url),
        ),
      );
    };

    const onClose = () => {
      finish(() => resolve());
    };

    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);
  });
}

function createAbortError(message = "Aborted"): Error {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

const sleep = (ms: number, s: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (s.aborted) return reject(createAbortError());
    const id = setTimeout(resolve, ms);
    s.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(createAbortError());
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
  const controller = abortController ?? new AbortController();
  const maxAttempts = opts?.maxAttempts ?? 10;
  const retryDelayMs = opts?.retryDelayMs ?? 400;
  return {
    address,
    async signTransactions(transactions) {
      const { signal } = controller;
      const wsUrl = toWebSocketUrl(url);
      const payload = JSON.stringify({
        publicKey: address.toString(),
        payload: transactions.map((x) => ({
          transaction: getBase64Decoder().decode(
            getTransactionEncoder().encode(x),
          ),
          transactionMessageBytes: transactionMessageBytes
            ? getBase64Decoder().decode(transactionMessageBytes)
            : undefined,
          authResponses,
        })),
      });
      for (let i = 0; i < maxAttempts; i++) {
        if (signal.aborted) throw createAbortError();
        let signatures: string[] | undefined;
        let ws: WebSocket | undefined;
        try {
          ws = await openWebSocket(wsUrl, signal);
          ws.send(payload);
          await readWebSocketJsonEvents(ws, signal, (event, data) => {
            if (event === "error") {
              const err =
                data &&
                typeof data === "object" &&
                typeof (data as { error?: string }).error === "string"
                  ? (data as { error: string }).error
                  : "Unknown error";
              const e = new Error(err) as Error & { noRetry: true };
              e.noRetry = true;
              throw e;
            }
            if (event === "signatures") {
              signatures = (data as { signatures?: string[] }).signatures;
              return true;
            }
            if (event === "pending_transaction_approval") {
              onPendingApprovalsCallback?.(
                (data as { validTill: number }).validTill,
              );
            } else if (event === "transaction_approved") {
              onPendingApprovalsSuccess?.();
            }
            return false;
          });
        } catch (e: unknown) {
          if (e && typeof e === "object" && (e as { noRetry?: true }).noRetry) {
            throw new NetworkError(`${(e as Error).message}`);
          }
          if (
            e &&
            typeof e === "object" &&
            (e as { name?: string }).name === "AbortError"
          )
            throw e;
        } finally {
          try {
            ws?.close();
          } catch {
            /* ignore */
          }
        }
        if (signatures?.length) {
          return signatures.map((sig) => ({
            [address]: getBase58Encoder().encode(sig) as SignatureBytes,
          }));
        }
        if (i < maxAttempts - 1) await sleep(retryDelayMs, signal);
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
