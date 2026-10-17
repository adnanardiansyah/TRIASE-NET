import "server-only";
import { randomBytes } from "node:crypto";
import { tokenHash } from "./real-accounts";
export function normalizeRecoveryCode(value:string):string { return value.replace(/-/g,"").toLowerCase(); }
export function recoveryHash(value:string):string { return tokenHash(`recovery-v1:${normalizeRecoveryCode(value)}`); }
export function newRecoveryCodes(){
 const codes=Array.from({length:10},()=>randomBytes(16).toString("hex").match(/.{8}/g)!.join("-"));
 return { codes, hashes:codes.map(recoveryHash) };
}
