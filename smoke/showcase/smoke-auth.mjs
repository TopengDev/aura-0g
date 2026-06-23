import { siweLogin, account } from "./lib.mjs";
console.log("account:", account.address);
const token = await siweLogin();
console.log("SIWE OK, token len:", token.length, "prefix:", token.slice(0, 12) + "...");
