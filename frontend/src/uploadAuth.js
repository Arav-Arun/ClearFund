// Both sides reconstruct this exact message. File bytes, deployment, chain and upload purpose are bound.
export function uploadMessage(a) {
  return ["ClearFund upload authorization", `Host: ${a.host}`, "Chain: 11155111",
    `Factory: ${a.factory.toLowerCase()}`, `Wallet: ${a.wallet.toLowerCase()}`,
    `Purpose: ${a.purpose}`, `Campaign: ${(a.campaign || "").toLowerCase()}`,
    `Milestone: ${a.milestone ?? ""}`, `File: ${a.hash.toLowerCase()}`,
    `Type: ${a.type}`, `Name: ${a.name}`, `Issued: ${a.issued}`, `Nonce: ${a.nonce}`].join("\n");
}
