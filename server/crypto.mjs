import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
function key() {
  const value = process.env.CLAIM_ENCRYPTION_KEY;
  if (!/^[a-f\d]{64}$/i.test(value || ""))
    throw new Error("Set CLAIM_ENCRYPTION_KEY to a 32-byte hex key.");
  return Buffer.from(value, "hex");
}
export function seal(record, identity) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from("yukon-qsb-reward-v1:" + identity));
  const body = Buffer.concat([
    cipher.update(JSON.stringify(record), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), body]
    .map((v) => v.toString("base64"))
    .join(".");
}
export function unseal(value, identity) {
  const [iv, tag, body] = value.split(".").map((v) => Buffer.from(v, "base64"));
  const cipher = createDecipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from("yukon-qsb-reward-v1:" + identity));
  cipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([cipher.update(body), cipher.final()]).toString("utf8"),
  );
}
