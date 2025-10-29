import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";
import { createFromRoot } from "codama";
import { readFileSync } from "fs";

const anchorIdl = JSON.parse(
  readFileSync("./src/idl/multi_wallet.json", "utf8")
);
const rootNode = rootNodeFromAnchor(anchorIdl);
const codama = createFromRoot({
  ...rootNode,
  program: {
    ...rootNode.program,
    instructions: rootNode.program.instructions.map((x) => ({
      ...x,
      extraArguments: [
        {
          kind: "instructionArgumentNode",
          name: "remainingAccounts" as any,
          type: {
            kind: "arrayTypeNode",
            count: { kind: "remainderCountNode" },
            item: {
              kind: "structTypeNode",
              fields: [
                {
                  kind: "structFieldTypeNode",
                  name: "address" as any,
                  type: { kind: "publicKeyTypeNode" },
                },
                {
                  kind: "structFieldTypeNode",
                  name: "role" as any,
                  type: { kind: "numberTypeNode", format: "u8", endian: "be" },
                },
              ],
            },
          },
        },
      ],
      remainingAccounts: [
        {
          isOptional: true,
          kind: "instructionRemainingAccountsNode",
          value: {
            name: "parseRemainingAccounts" as any,
            kind: "resolverValueNode",
            dependsOn: [
              { kind: "argumentValueNode", name: "remainingAccounts" as any },
            ],
          },
        },
      ],
    })),
  },
});

const visitor = renderVisitor("./src/generated", {});

codama.accept(visitor);
