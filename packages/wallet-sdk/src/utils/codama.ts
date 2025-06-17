import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";
import { createFromRoot } from "codama";
import { readFileSync } from "fs";

const anchorIdl = JSON.parse(
  readFileSync("./src/idl/multi_wallet.json", "utf8")
);

const codama = createFromRoot(rootNodeFromAnchor(anchorIdl));

const visitor = renderVisitor("./src/generated2", {});

codama.accept(visitor);
