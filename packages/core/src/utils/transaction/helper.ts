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
} from "@solana/kit";
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

/** When false, signing should not be retried (e.g. TM policy rejection). */
type TransactionManagerNetworkError = NetworkError & { retryable?: boolean };

function terminalNetworkError(message: string, url?: string): NetworkError {
  const err = new NetworkError(message, undefined, url) as TransactionManagerNetworkError;
  err.retryable = false;
  return err;
}

function isRetryableTransactionManagerError(error: unknown): boolean {
  if (error instanceof NetworkError) {
    return (error as TransactionManagerNetworkError).retryable !== false;
  }
  return (
    error instanceof Error &&
    (error.message === "WebSocket connection failed" ||
      error.message === "WebSocket connection timed out")
  );
}

const abortErr = () => {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
};

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "AbortError"
  );
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortErr();
  }
  signal.throwIfAborted?.();
}

function combineAbortSignals(
  ...signals: (AbortSignal | undefined)[]
): AbortSignal {
  const defined = signals.filter((s): s is AbortSignal => s != null);
  if (defined.length === 0) {
    return new AbortController().signal;
  }
  if (defined.length === 1) {
    return defined[0];
  }
  if (typeof AbortSignal !== "undefined" && "any" in AbortSignal) {
    return AbortSignal.any(defined);
  }
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  for (const s of defined) {
    if (s.aborted) {
      forwardAbort();
      break;
    }
    s.addEventListener("abort", forwardAbort, { once: true });
  }
  return controller.signal;
}

/** Unix seconds (~1e9) vs milliseconds (~1e12+). */
function normalizeApprovalValidTill(validTill: number): number {
  return validTill < 1_000_000_000_000 ? validTill * 1000 : validTill;
}

function resolveApprovalValidTill(
  rawValidTill: number | undefined,
  current: number | null,
  defaultTimeoutMs: number,
): number {
  if (typeof rawValidTill === "number" && Number.isFinite(rawValidTill)) {
    return normalizeApprovalValidTill(rawValidTill);
  }
  if (current !== null) {
    return current;
  }
  return Date.now() + defaultTimeoutMs;
}

function rethrowTransactionManagerError(
  error: unknown,
  url: string,
): never {
  if (error instanceof NetworkError) throw error;
  throw new NetworkError(
    error instanceof Error ? error.message : "Transaction manager request failed",
    undefined,
    url,
  );
}

function openWebSocket(
  url: string,
  signal: AbortSignal,
  connectionTimeoutMs?: number,
): Promise<WebSocket> {
  if (signal.aborted) {
    return Promise.reject(abortErr());
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      signal.removeEventListener("abort", abort);
      fn();
    };

    const timeoutId =
      connectionTimeoutMs !== undefined
        ? setTimeout(() => {
            try {
              ws.close();
            } catch {}
            settle(() =>
              reject(new Error("WebSocket connection timed out")),
            );
          }, connectionTimeoutMs)
        : undefined;

    const abort = () => {
      try {
        ws.close();
      } catch {}
      settle(() => reject(abortErr()));
    };

    signal.addEventListener("abort", abort, { once: true });

    ws.onopen = () => {
      if (signal.aborted) {
        try {
          ws.close();
        } catch {}
        settle(() => reject(abortErr()));
        return;
      }
      settle(() => resolve(ws));
    };

    ws.onerror = () => {
      settle(() => reject(new Error("WebSocket connection failed")));
    };

    ws.onclose = () => {
      settle(() => reject(new Error("WebSocket connection failed")));
    };
  });
}

/**
 * Reads WebSocket events until `onEvent` returns true (success) or the socket closes/errors.
 * @returns true if `onEvent` signaled completion (e.g. signatures received).
 */
async function readEvents(
  ws: WebSocket,
  signal: AbortSignal,
  onEvent: (event: string, data: any) => boolean,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let done = false;
    let completed = false;

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
      finish(() => reject(abortErr()));
    };

    const onMessage = (ev: MessageEvent) => {
      if (signal.aborted) {
        finish(() => reject(abortErr()));
        return;
      }
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
          completed = true;
          finish(() => resolve(true));
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

    const onClose = () => finish(() => resolve(completed));

    signal.addEventListener("abort", onAbort, { once: true });
    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);
  });
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortErr());

    const onAbort = () => {
      clearTimeout(id);
      reject(abortErr());
    };

    const id = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal.addEventListener("abort", onAbort, { once: true });
  });

/** Callbacks for optional out-of-band transaction-manager approval UX. */
export type TransactionManagerApprovalCallbacks = {
  onPendingApprovalsCallback?: (validTill: number) => void;
  onPendingApprovalsSuccess?: () => void;
};

/** Retry, approval polling, and connection options for TM WebSocket signing. */
export type TransactionManagerWebSocketSignOptions = {
  maxAttempts?: number;
  retryDelayMs?: number;
  /** Poll interval while waiting for out-of-band approval (ms). */
  approvalPollMs?: number;
  /** Used when `pending_transaction_approval` omits `validTill` (ms). */
  defaultApprovalTimeoutMs?: number;
  /** Max wait for the WebSocket handshake (ms). */
  connectionTimeoutMs?: number;
};

/**
 * Signs via the transaction-manager WebSocket API (`/sign`).
 * Sends `payload` (JSON) after connect and resolves when a `signatures` event arrives.
 *
 * Used by {@link createTransactionManagerSigner} (`type: "transaction"`) and by
 * message signing (`type: "message"`).
 */
export async function fetchSignaturesFromTransactionManager(args: {
  url: string;
  /** JSON string sent on the WebSocket after connect (e.g. `{ type, data }`). */
  payload: string;
  /** Required length of the `signatures` array in the TM response. */
  expectedSignatureCount: number;
  callbacks?: TransactionManagerApprovalCallbacks;
  abortSignal?: AbortSignal;
  opts?: TransactionManagerWebSocketSignOptions;
}): Promise<string[]> {
  const {
    url,
    payload,
    expectedSignatureCount,
    callbacks,
    abortSignal: abortSignalArg,
    opts,
  } = args;

  const signal = combineAbortSignals(abortSignalArg);
  const wsUrl = toWebSocketUrl(url);

  const maxAttempts = opts?.maxAttempts ?? 10;
  const retryDelayMs = opts?.retryDelayMs ?? 400;
  const approvalPollMs = opts?.approvalPollMs ?? 2_000;
  const defaultApprovalTimeoutMs = opts?.defaultApprovalTimeoutMs ?? 300_000;
  const connectionTimeoutMs = opts?.connectionTimeoutMs ?? 30_000;

  if (expectedSignatureCount === 0) {
    throw terminalNetworkError(
      "Transaction manager: no signatures requested",
      wsUrl,
    );
  }

  let approvalValidTill: number | null = null;
  let transientFailures = 0;

  const isWaitingForApproval = () =>
    approvalValidTill !== null && Date.now() < approvalValidTill;

  while (true) {
    throwIfAborted(signal);

    if (approvalValidTill !== null && Date.now() >= approvalValidTill) {
      throw terminalNetworkError(
        "Transaction manager approval timed out",
        wsUrl,
      );
    }

    let ws: WebSocket | undefined;
    let signatures: string[] | undefined;

    try {
      ws = await openWebSocket(wsUrl, signal, connectionTimeoutMs);
      throwIfAborted(signal);
      ws.send(payload);

      const receivedSignatures = await readEvents(ws, signal, (event, data) => {
        if (event === "error") {
          const errMsg =
            typeof data === "object" &&
            data &&
            typeof (data as { error?: string }).error === "string"
              ? (data as { error: string }).error
              : "Unknown error";

          throw terminalNetworkError(errMsg, wsUrl);
        }

        if (event === "signatures") {
          const sigs = (data as { signatures?: string[] }).signatures;
          if (!sigs?.length) {
            return false;
          }
          if (sigs.length !== expectedSignatureCount) {
            throw terminalNetworkError(
              `Transaction manager returned ${sigs.length} signature(s) but ${expectedSignatureCount} were expected`,
              wsUrl,
            );
          }
          signatures = sigs;
          return true;
        }

        if (event === "pending_transaction_approval") {
          const rawValidTill = (data as { validTill?: number }).validTill;
          approvalValidTill = resolveApprovalValidTill(
            rawValidTill,
            approvalValidTill,
            defaultApprovalTimeoutMs,
          );
          callbacks?.onPendingApprovalsCallback?.(approvalValidTill);
        }

        if (event === "transaction_approved") {
          callbacks?.onPendingApprovalsSuccess?.();
        }

        return false;
      });

      if (receivedSignatures) {
        if (!signatures || signatures.length !== expectedSignatureCount) {
          throw terminalNetworkError(
            "Transaction manager sent an invalid signatures event",
            wsUrl,
          );
        }
        return signatures;
      }

      throwIfAborted(signal);

      if (!isWaitingForApproval()) {
        throw new NetworkError(
          "Transaction manager closed the connection before returning signatures",
          undefined,
          wsUrl,
        );
      }
    } catch (e) {
      if (isAbortError(e)) throw e;
      throwIfAborted(signal);
      if (!isRetryableTransactionManagerError(e)) {
        rethrowTransactionManagerError(e, wsUrl);
      }

      if (!isWaitingForApproval()) {
        transientFailures++;
        if (transientFailures >= maxAttempts) {
          rethrowTransactionManagerError(e, wsUrl);
        }
      }
    } finally {
      try {
        ws?.close();
      } catch {}
    }

    throwIfAborted(signal);

    if (isWaitingForApproval()) {
      const waitMs = Math.min(approvalPollMs, approvalValidTill! - Date.now());
      await sleep(waitMs > 0 ? waitMs : 1, signal);
      continue;
    }

    if (transientFailures > 0) {
      await sleep(retryDelayMs, signal);
      continue;
    }

    throw new NetworkError(
      "Transaction manager: missing signatures",
      undefined,
      wsUrl,
    );
  }
}

export function createTransactionManagerSigner(args: {
  address: Address;
  url: string;
  authResponses?: TransactionAuthDetails[];
  transactionMessageBytes?: ReadonlyUint8Array;
  onPendingApprovalsCallback?: (validTill: number) => void;
  onPendingApprovalsSuccess?: () => void;
  abortSignal?: AbortSignal;
  opts?: TransactionManagerWebSocketSignOptions;
}): TransactionSigner {
  const {
    address,
    url,
    authResponses,
    transactionMessageBytes,
    onPendingApprovalsCallback,
    onPendingApprovalsSuccess,
    abortSignal: abortSignalArg,
    opts,
  } = args;

  const wiredSignal = combineAbortSignals(abortSignalArg);
  const wsUrl = toWebSocketUrl(url);

  let signQueue: Promise<unknown> = Promise.resolve();

  if (wiredSignal.aborted) {
    signQueue = Promise.reject(abortErr());
  }

  wiredSignal.addEventListener(
    "abort",
    () => {
      signQueue = Promise.reject(abortErr());
    },
    { once: true },
  );

  return {
    address,
    async signTransactions(
      transactions,
      config?: { abortSignal?: AbortSignal },
    ) {
      const signal = combineAbortSignals(wiredSignal, config?.abortSignal);
      throwIfAborted(signal);

      const result = signQueue.then(async () => {
        throwIfAborted(signal);

        if (transactions.length === 0) {
          throw terminalNetworkError(
            "Transaction manager: no transactions to sign",
            wsUrl,
          );
        }

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

        const signatures = await fetchSignaturesFromTransactionManager({
          url,
          payload,
          expectedSignatureCount: transactions.length,
          callbacks: {
            onPendingApprovalsCallback,
            onPendingApprovalsSuccess,
          },
          abortSignal: signal,
          opts,
        });

        return signatures.map((sig) => ({
          [address]: getBase58Encoder().encode(sig) as SignatureBytes,
        }));
      });

      signQueue = result.catch((err) => {
        if (isAbortError(err)) {
          return Promise.reject(err);
        }
        return undefined;
      });
      return result;
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
