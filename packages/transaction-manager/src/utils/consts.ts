import { MULTI_WALLET_PROGRAM_ADDRESS } from "@revibase/core";
import { address, type AddressesByLookupTableAddress } from "gill";
import {
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  MEMO_PROGRAM_ADDRESS,
} from "gill/programs";

export const SECP256R1_VERIFY_PROGRAM =
  "Secp256r1SigVerify1111111111111111111111111";

export const WHITELISTED_PROGRAMS = new Set([
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  MULTI_WALLET_PROGRAM_ADDRESS,
  SECP256R1_VERIFY_PROGRAM,
  MEMO_PROGRAM_ADDRESS,
]);

export const REVIBASE_LOOKUP_TABLE_ADDRESS =
  "2c1LgZfCun82niPCgfg2cTMZmAiahraTjY4KNb1BSU4Z";

export function getRevibaseLookupTableAddresses(): AddressesByLookupTableAddress {
  return {
    [address(REVIBASE_LOOKUP_TABLE_ADDRESS)]: [
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      "11111111111111111111111111111111",
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
      "Sysvar1nstructions1111111111111111111111111",
      "auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg",
      "SysvarS1otHashes111111111111111111111111111",
      "3C6AdJiD9qxMqZTmB53b5HC5Yfq2Bb57XAzYDzu4YDcj",
      "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY",
      "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV",
      "cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK",
      "GXtd2izAiMJPwMEjfgTRH3d7k9mjn4Jq3JrWFv9gySYy",
      "SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7",
      "35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh",
      "HwXnGK3tPkkVY6P439H2p68AxpeuWXd5PcrAxFpbmfbA",
      "compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq",
      "bmt1LryLZUMmF7ZtqESaw7wifBXLfXHQYoE4GAmrahU",
      "oq1na8gojfdUhsfCpyjNt6h4JaDWtHf1yQj4koBWfto",
      "cpi15BoVPKgEPw5o8wc2T816GE7b378nMXnhH3Xbq4y",
      "bmt2UxoBxB9xWev4BkLvkGdapsz6sZGkzViPNph7VFi",
      "oq2UkeMsJLfXt2QHzim242SUi3nvjJs8Pn7Eac9H9vg",
      "cpi2yGapXUR3As5SjnHBAVvmApNiLsbeZpF3euWnW6B",
      "bmt3ccLd4bqSVZVeCJnH1F6C8jNygAhaDfxDwePyyGb",
      "oq3AxjekBWgo64gpauB6QtuZNesuv19xrhaC1ZM1THQ",
      "cpi3mbwMpSX8FAGMZVP85AwxqCaQMfEk9Em1v8QK9Rf",
      "bmt4d3p1a4YQgk9PeZv5s4DBUmbF5NxqYpk9HGjQsd8",
      "oq4ypwvVGzCUMoiKKHWh4S1SgZJ9vCvKpcz6RT6A8dq",
      "cpi4yyPDc4bCgHAnsenunGA8Y77j3XEDyjgfyCKgcoc",
      "bmt5yU97jC88YXTuSukYHa8Z5Bi2ZDUtmzfkDTA2mG2",
      "oq5oh5ZR3yGomuQgFduNDzjtGvVWfDRGLuDVjv9a96P",
      "cpi5ZTjdgYpZ1Xr7B1cMLLUE81oTtJbNNAyKary2nV6",
      "amt2kaJA14v3urZbZvnc5v2np8jqvc4Z8zDep5wbtzx",
      "ACXg8a7VaqecBWrSbdu73W4Pg9gsqXJ3EXAqkHyhvVXg",
      "r18WwUxfG8kQ69bQPAB2jV6zGNKy3GosFGctjQoV4ti",
      "cTokenmWW8bLPjZEBAUgYy3zKxQZW6VKi7bqNFEVv3m",
      "2cLqZJrYMuCzKdSZBoWxZ3tXoeCMmMyDiuy6UBaKnbmK",
      "5tgzUZaVtfnnSEBgmBDtJj6PdgYCnA1uaEGEUi3y5Njg",
      "2yaSthpW4U4VZvBhwPfGA7HwC9v9Rfq3SNRZvJkKcrNe",
    ].map(address),
  };
}
