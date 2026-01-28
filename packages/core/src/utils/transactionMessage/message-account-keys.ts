import type { Address, Instruction } from "gill";

export class MessageAccountKeys {
  private staticAccountKeys: Address[];
  private accountKeysFromLookups: {
    writable: Address[];
    readonly: Address[];
  };
  constructor(
    staticAccountKeys: Address[],
    accountKeysFromLookups: {
      writable: Address[];
      readonly: Address[];
    }
  ) {
    this.staticAccountKeys = staticAccountKeys;
    this.accountKeysFromLookups = accountKeysFromLookups;
  }
  /**
   * Returns account key segments in order: static, lookup writable, lookup readonly
   * @returns Array of key segments
   */
  keySegments() {
    const keySegments = [this.staticAccountKeys];
    if (this.accountKeysFromLookups) {
      keySegments.push(this.accountKeysFromLookups.writable);
      keySegments.push(this.accountKeysFromLookups.readonly);
    }
    return keySegments;
  }

  /**
   * Gets an account key by its index across all segments
   * @param index - Account index
   * @returns Account address or undefined if index is out of bounds
   */
  get(index: number) {
    for (const keySegment of this.keySegments()) {
      if (index < keySegment.length) {
        return keySegment[index];
      } else {
        index -= keySegment.length;
      }
    }
    return;
  }

  /** Total number of account keys across all segments */
  get length() {
    return this.keySegments().flat().length;
  }

  /**
   * Compiles instructions by replacing account addresses with indices
   * @param instructions - Instructions to compile
   * @returns Compiled instructions with account indices
   * @throws {Error} If account index would overflow u8 or key is unknown
   */
  compileInstructions(instructions: Instruction[]) {
    // Validate: account indices must fit in u8 (0-255)
    const U8_MAX = 255;
    if (this.length > U8_MAX + 1) {
      throw new Error("Account index overflow encountered during compilation");
    }
    const keyIndexMap = new Map<Address, number>();
    this.keySegments()
      .flat()
      .forEach((key, index) => {
        keyIndexMap.set(key, index);
      });
    const findKeyIndex = (key: Address) => {
      const keyIndex = keyIndexMap.get(key);
      if (keyIndex === undefined)
        throw new Error(
          "Encountered an unknown instruction account key during compilation"
        );
      return keyIndex;
    };
    return instructions.map((instruction) => {
      return {
        programAddressIndex: findKeyIndex(instruction.programAddress),
        accountIndices:
          instruction.accounts?.map((meta) => findKeyIndex(meta.address)) ?? [],
        data: instruction.data,
      };
    });
  }
}
